-- Teams, per-day schedules and deterministic policy resolution.
-- Policy resolution is read-only and never participates in accepting or
-- rejecting a clocking event.

create table if not exists zecontrol.work_teams (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_teams_name_length check (char_length(btrim(name)) between 2 and 80),
  unique (organisation_id, name)
);

create table if not exists zecontrol.work_team_members (
  team_id uuid not null references zecontrol.work_teams(id) on delete cascade,
  profile_id uuid not null references zecontrol.profiles_configs(id) on delete cascade,
  is_active boolean not null default true,
  added_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);

alter table zecontrol.work_policy_assignments
  add column if not exists team_id uuid references zecontrol.work_teams(id) on delete cascade,
  add column if not exists priority integer not null default 0;

alter table zecontrol.work_policy_assignments
  drop constraint if exists work_policy_assignments_target_type,
  drop constraint if exists work_policy_assignments_target_shape;

alter table zecontrol.work_policy_assignments
  add constraint work_policy_assignments_target_type
    check (target_type in ('organisation', 'service', 'team', 'profile')),
  add constraint work_policy_assignments_target_shape
    check (
      (target_type = 'organisation' and service_name is null and team_id is null and profile_id is null)
      or (target_type = 'service' and nullif(btrim(service_name), '') is not null and team_id is null and profile_id is null)
      or (target_type = 'team' and service_name is null and team_id is not null and profile_id is null)
      or (target_type = 'profile' and service_name is null and team_id is null and profile_id is not null)
    );

create index if not exists work_team_members_profile
  on zecontrol.work_team_members (profile_id)
  where is_active = true;
create index if not exists work_policy_assignments_team
  on zecontrol.work_policy_assignments (team_id, valid_from)
  where target_type = 'team';

create or replace function zecontrol.is_valid_work_policy_definition(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, zecontrol
as $$
declare
  candidate_mode text;
  candidate_day jsonb;
  candidate_day_key text;
  candidate_schedule jsonb;
  candidate_rounding integer;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then
    return false;
  end if;

  candidate_mode := candidate ->> 'mode';
  if candidate_mode is null
    or candidate_mode not in ('fixed', 'flexible', 'attendance') then
    return false;
  end if;

  if jsonb_typeof(candidate -> 'days') <> 'array' then
    return false;
  end if;

  for candidate_day in select value from jsonb_array_elements(candidate -> 'days')
  loop
    if jsonb_typeof(candidate_day) <> 'number'
      or (candidate_day #>> '{}')::integer not between 1 and 7 then
      return false;
    end if;
  end loop;

  if candidate_mode <> 'attendance'
    and jsonb_array_length(candidate -> 'days') = 0 then
    return false;
  end if;

  if candidate_mode = 'fixed' and (
    coalesce(candidate ->> 'startTime', '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(candidate ->> 'endTime', '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    or (candidate ->> 'startTime') >= (candidate ->> 'endTime')
  ) then
    return false;
  end if;

  if candidate ? 'daySchedules' then
    if jsonb_typeof(candidate -> 'daySchedules') <> 'object' then
      return false;
    end if;

    for candidate_day_key, candidate_schedule
      in select key, value from jsonb_each(candidate -> 'daySchedules')
    loop
      if candidate_day_key !~ '^[1-7]$'
        or jsonb_typeof(candidate_schedule) <> 'object'
        or coalesce(candidate_schedule ->> 'startTime', '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
        or coalesce(candidate_schedule ->> 'endTime', '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
        or (candidate_schedule ->> 'startTime') >= (candidate_schedule ->> 'endTime')
        or coalesce((candidate_schedule ->> 'breakMinutes')::integer, -1) not between 0 and 720 then
        return false;
      end if;
    end loop;
  end if;

  if candidate_mode = 'flexible'
    and coalesce((candidate ->> 'weeklyTargetMinutes')::integer, 0) not between 60 and 10080 then
    return false;
  end if;

  if coalesce((candidate ->> 'breakMinutes')::integer, 0) not between 0 and 720
    or coalesce((candidate ->> 'toleranceMinutes')::integer, 0) not between 0 and 180
    or coalesce((candidate ->> 'minimumRestMinutes')::integer, 0) not between 0 and 2880
    or coalesce((candidate ->> 'minimumBreakAfterMinutes')::integer, 0) not between 0 and 1440 then
    return false;
  end if;

  candidate_rounding := coalesce((candidate ->> 'roundingMinutes')::integer, 0);
  if candidate_rounding not in (0, 5, 10, 15) then
    return false;
  end if;

  if jsonb_typeof(candidate -> 'overtimeEnabled') is distinct from 'boolean'
    or jsonb_typeof(candidate -> 'overtimeApprovalRequired') is distinct from 'boolean' then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

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

  return jsonb_build_object(
    'policyId', selected_policy_id,
    'versionId', selected_version.id,
    'version', selected_version.version_number,
    'effectiveFrom', selected_version.effective_from,
    'scope', selected_scope,
    'definition', selected_version.definition
  );
end;
$$;

alter table zecontrol.work_teams enable row level security;
alter table zecontrol.work_team_members enable row level security;

create policy "zecontrol members read work teams"
on zecontrol.work_teams for select
to authenticated
using (zecontrol.can_read_organisation(organisation_id));

create policy "zecontrol owners create work teams"
on zecontrol.work_teams for insert
to authenticated
with check (
  zecontrol.can_manage_organisation(organisation_id)
  and created_by = auth.uid()
);

create policy "zecontrol owners update work teams"
on zecontrol.work_teams for update
to authenticated
using (zecontrol.can_manage_organisation(organisation_id))
with check (zecontrol.can_manage_organisation(organisation_id));

create policy "zecontrol owners delete work teams"
on zecontrol.work_teams for delete
to authenticated
using (zecontrol.can_manage_organisation(organisation_id));

create policy "zecontrol members read work team members"
on zecontrol.work_team_members for select
to authenticated
using (
  exists (
    select 1
    from zecontrol.work_teams as team
    where team.id = work_team_members.team_id
      and zecontrol.can_read_organisation(team.organisation_id)
  )
);

create policy "zecontrol owners create work team members"
on zecontrol.work_team_members for insert
to authenticated
with check (
  added_by = auth.uid()
  and exists (
    select 1
    from zecontrol.work_teams as team
    join public.profiles as profile
      on profile.organisation_id = team.organisation_id
    where team.id = work_team_members.team_id
      and profile.id = work_team_members.profile_id
      and zecontrol.can_manage_organisation(team.organisation_id)
  )
);

create policy "zecontrol owners update work team members"
on zecontrol.work_team_members for update
to authenticated
using (
  exists (
    select 1
    from zecontrol.work_teams as team
    where team.id = work_team_members.team_id
      and zecontrol.can_manage_organisation(team.organisation_id)
  )
)
with check (
  exists (
    select 1
    from zecontrol.work_teams as team
    join public.profiles as profile
      on profile.organisation_id = team.organisation_id
    where team.id = work_team_members.team_id
      and profile.id = work_team_members.profile_id
      and zecontrol.can_manage_organisation(team.organisation_id)
  )
);

create policy "zecontrol owners delete work team members"
on zecontrol.work_team_members for delete
to authenticated
using (
  exists (
    select 1
    from zecontrol.work_teams as team
    where team.id = work_team_members.team_id
      and zecontrol.can_manage_organisation(team.organisation_id)
  )
);

drop policy if exists "zecontrol owners manage work policy assignments"
  on zecontrol.work_policy_assignments;
create policy "zecontrol owners manage work policy assignments"
on zecontrol.work_policy_assignments for all
to authenticated
using (
  zecontrol.can_manage_organisation(organisation_id)
  and exists (
    select 1
    from zecontrol.work_policies as policy
    where policy.id = work_policy_assignments.policy_id
      and policy.organisation_id = work_policy_assignments.organisation_id
  )
)
with check (
  zecontrol.can_manage_organisation(organisation_id)
  and exists (
    select 1
    from zecontrol.work_policies as policy
    where policy.id = work_policy_assignments.policy_id
      and policy.organisation_id = work_policy_assignments.organisation_id
  )
  and (
    work_policy_assignments.target_type <> 'team'
    or exists (
      select 1
      from zecontrol.work_teams as team
      where team.id = work_policy_assignments.team_id
        and team.organisation_id = work_policy_assignments.organisation_id
    )
  )
);

grant select, insert, update, delete on zecontrol.work_teams to authenticated;
grant select, insert, update, delete on zecontrol.work_team_members to authenticated;
grant update (team_id, priority) on zecontrol.work_policy_assignments to authenticated;

revoke all on function zecontrol.is_valid_work_policy_definition(jsonb) from public;
revoke all on function zecontrol.resolve_work_policy(uuid, date) from public;
revoke all on function zecontrol.resolve_work_policy(uuid, date) from anon;
grant execute on function zecontrol.resolve_work_policy(uuid, date) to authenticated;

notify pgrst, 'reload schema';
