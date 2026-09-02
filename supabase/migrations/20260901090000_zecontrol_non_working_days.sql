-- Calendar exceptions let managers mark one civil date as non-working for the
-- organisation, one service or one collaborator. They complement recurring
-- weekly schedules without creating a new policy version for a one-off date.

create table if not exists zecontrol.work_calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete cascade,
  work_date date not null,
  target_type text not null,
  service_name text,
  profile_id uuid references zecontrol.profiles_configs(id) on delete cascade,
  label text not null default 'Journée non travaillée',
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_calendar_exceptions_target_type
    check (target_type in ('organisation', 'service', 'profile')),
  constraint work_calendar_exceptions_target_shape
    check (
      (target_type = 'organisation' and service_name is null and profile_id is null)
      or (target_type = 'service' and nullif(btrim(service_name), '') is not null and profile_id is null)
      or (target_type = 'profile' and service_name is null and profile_id is not null)
    ),
  constraint work_calendar_exceptions_label_length
    check (char_length(btrim(label)) between 2 and 120)
);

create unique index if not exists work_calendar_exceptions_organisation_unique
  on zecontrol.work_calendar_exceptions (organisation_id, work_date)
  where target_type = 'organisation';
create unique index if not exists work_calendar_exceptions_service_unique
  on zecontrol.work_calendar_exceptions (organisation_id, work_date, lower(btrim(service_name)))
  where target_type = 'service';
create unique index if not exists work_calendar_exceptions_profile_unique
  on zecontrol.work_calendar_exceptions (organisation_id, work_date, profile_id)
  where target_type = 'profile';
create index if not exists work_calendar_exceptions_date_lookup
  on zecontrol.work_calendar_exceptions (organisation_id, work_date, target_type);

alter table zecontrol.work_calendar_exceptions enable row level security;

create or replace function zecontrol.can_target_calendar_profile(
  target_profile_id uuid,
  target_organisation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
  select
    zecontrol.can_manage_organisation(target_organisation_id)
    and exists (
      select 1
      from public.profiles as profile
      join zecontrol.profiles_configs as product_profile
        on product_profile.id = profile.id
      where profile.id = target_profile_id
        and profile.organisation_id = target_organisation_id
        and profile.is_active = true
        and product_profile.is_active = true
    );
$$;

revoke all on function zecontrol.can_target_calendar_profile(uuid, uuid) from public;
revoke all on function zecontrol.can_target_calendar_profile(uuid, uuid) from anon;
grant execute on function zecontrol.can_target_calendar_profile(uuid, uuid) to authenticated;

drop policy if exists "zecontrol members read calendar exceptions"
  on zecontrol.work_calendar_exceptions;
create policy "zecontrol members read calendar exceptions"
on zecontrol.work_calendar_exceptions for select
to authenticated
using (zecontrol.can_read_organisation(organisation_id));

drop policy if exists "zecontrol owners create calendar exceptions"
  on zecontrol.work_calendar_exceptions;
create policy "zecontrol owners create calendar exceptions"
on zecontrol.work_calendar_exceptions for insert
to authenticated
with check (
  zecontrol.can_manage_organisation(organisation_id)
  and created_by = auth.uid()
  and (
    target_type <> 'profile'
    or zecontrol.can_target_calendar_profile(
      profile_id,
      organisation_id
    )
  )
);

drop policy if exists "zecontrol owners delete calendar exceptions"
  on zecontrol.work_calendar_exceptions;
create policy "zecontrol owners delete calendar exceptions"
on zecontrol.work_calendar_exceptions for delete
to authenticated
using (zecontrol.can_manage_organisation(organisation_id));

grant select, delete on zecontrol.work_calendar_exceptions to authenticated;
grant insert (organisation_id, work_date, target_type, service_name, profile_id, label, created_by)
  on zecontrol.work_calendar_exceptions to authenticated;

create or replace function zecontrol.resolve_work_policy(
  target_profile_id uuid,
  target_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  target_organisation_id uuid;
  target_service text;
  selected_policy_id uuid;
  selected_scope text := 'organisation';
  selected_version record;
  selected_definition jsonb;
  selected_exception_id uuid;
  selected_exception_scope text;
  selected_exception_label text;
  target_weekday integer := extract(isodow from target_work_date)::integer;
begin
  select profile.organisation_id, config.service
  into target_organisation_id, target_service
  from public.profiles as profile
  join zecontrol.profiles_configs as config on config.id = profile.id
  where profile.id = target_profile_id
    and profile.is_active = true
    and config.is_active = true;

  if target_organisation_id is null then
    return null;
  end if;

  if auth.uid() is null
    or not zecontrol.can_read_organisation(target_organisation_id) then
    raise exception 'work_policy_read_access_denied';
  end if;

  select candidate.policy_id, candidate.scope
  into selected_policy_id, selected_scope
  from (
    select
      assignment.policy_id,
      assignment.target_type as scope,
      (
        case assignment.target_type
          when 'profile' then 400
          when 'team' then 300
          when 'service' then 200
          else 100
        end
        + assignment.priority
      ) as resolution_priority,
      assignment.valid_from,
      assignment.created_at
    from zecontrol.work_policy_assignments as assignment
    join zecontrol.work_policies as policy on policy.id = assignment.policy_id
    where assignment.organisation_id = target_organisation_id
      and policy.is_enabled = true
      and assignment.valid_from <= target_work_date
      and (assignment.valid_until is null or assignment.valid_until >= target_work_date)
      and (
        (assignment.target_type = 'profile' and assignment.profile_id = target_profile_id)
        or (
          assignment.target_type = 'team'
          and exists (
            select 1
            from zecontrol.work_team_members as member
            join zecontrol.work_teams as team on team.id = member.team_id
            where member.team_id = assignment.team_id
              and member.profile_id = target_profile_id
              and member.is_active = true
              and team.is_active = true
          )
        )
        or (
          assignment.target_type = 'service'
          and lower(btrim(assignment.service_name)) = lower(btrim(target_service))
        )
        or assignment.target_type = 'organisation'
      )
  ) as candidate
  order by candidate.resolution_priority desc, candidate.valid_from desc, candidate.created_at desc
  limit 1;

  if selected_policy_id is null then
    select policy.id
    into selected_policy_id
    from zecontrol.work_policies as policy
    where policy.organisation_id = target_organisation_id
      and policy.is_default = true
      and policy.is_enabled = true
    order by policy.updated_at desc
    limit 1;
    selected_scope := 'organisation';
  end if;

  if selected_policy_id is null then
    return null;
  end if;

  select version.id, version.version_number, version.definition, version.effective_from
  into selected_version
  from zecontrol.work_policy_versions as version
  where version.policy_id = selected_policy_id
    and version.effective_from <= target_work_date
  order by version.effective_from desc, version.version_number desc
  limit 1;

  if selected_version.id is null then
    return null;
  end if;

  selected_definition := selected_version.definition;

  select calendar_exception.id, calendar_exception.target_type, calendar_exception.label
  into selected_exception_id, selected_exception_scope, selected_exception_label
  from zecontrol.work_calendar_exceptions as calendar_exception
  where calendar_exception.organisation_id = target_organisation_id
    and calendar_exception.work_date = target_work_date
    and (
      (calendar_exception.target_type = 'profile' and calendar_exception.profile_id = target_profile_id)
      or (
        calendar_exception.target_type = 'service'
        and lower(btrim(calendar_exception.service_name)) = lower(btrim(target_service))
      )
      or calendar_exception.target_type = 'organisation'
    )
  order by case calendar_exception.target_type when 'profile' then 3 when 'service' then 2 else 1 end desc
  limit 1;

  if selected_exception_id is not null then
    selected_definition := jsonb_set(
      selected_definition,
      '{days}',
      coalesce(
        (
          select jsonb_agg(day_value order by day_value)
          from jsonb_array_elements(selected_definition -> 'days') as day(day_value)
          where (day_value #>> '{}')::integer <> target_weekday
        ),
        '[]'::jsonb
      ),
      true
    );
  end if;

  return jsonb_build_object(
    'policyId', selected_policy_id,
    'versionId', selected_version.id,
    'version', selected_version.version_number,
    'effectiveFrom', selected_version.effective_from,
    'scope', selected_scope,
    'definition', selected_definition,
    'calendarException', case
      when selected_exception_id is null then null
      else jsonb_build_object(
        'id', selected_exception_id,
        'scope', selected_exception_scope,
        'label', selected_exception_label
      )
    end
  );
end;
$$;

revoke all on function zecontrol.resolve_work_policy(uuid, date) from public;
revoke all on function zecontrol.resolve_work_policy(uuid, date) from anon;
grant execute on function zecontrol.resolve_work_policy(uuid, date) to authenticated;

notify pgrst, 'reload schema';
