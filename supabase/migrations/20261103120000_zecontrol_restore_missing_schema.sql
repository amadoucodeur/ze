-- Restores what production is missing from two migrations which were never
-- applied there: 20260727110000 and 20260901120000.
--
-- Do not apply those two files directly on a database with later migrations:
--   * 20260727110000 would replace resolve_work_policy with an old version that
--     refuses the service role and ignores non-working days, stopping Web Push.
--   * 20260901120000 installs enforce_minimum_rest, which refuses clock-ins. It
--     is deliberately left out here: enabling it is a product decision.
--
-- The current resolve_work_policy is kept untouched. It only needs the columns
-- restored below. This file is transactional and can safely be run again.

begin;

-- From 20260727110000: teams, assignment columns and policy validation.
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

alter table zecontrol.work_teams enable row level security;
alter table zecontrol.work_team_members enable row level security;

drop policy if exists "zecontrol members read work teams" on zecontrol.work_teams;
create policy "zecontrol members read work teams"
on zecontrol.work_teams for select
to authenticated
using (zecontrol.can_read_organisation(organisation_id));

drop policy if exists "zecontrol owners create work teams" on zecontrol.work_teams;
create policy "zecontrol owners create work teams"
on zecontrol.work_teams for insert
to authenticated
with check (
  zecontrol.can_manage_organisation(organisation_id)
  and created_by = auth.uid()
);

drop policy if exists "zecontrol owners update work teams" on zecontrol.work_teams;
create policy "zecontrol owners update work teams"
on zecontrol.work_teams for update
to authenticated
using (zecontrol.can_manage_organisation(organisation_id))
with check (zecontrol.can_manage_organisation(organisation_id));

drop policy if exists "zecontrol owners delete work teams" on zecontrol.work_teams;
create policy "zecontrol owners delete work teams"
on zecontrol.work_teams for delete
to authenticated
using (zecontrol.can_manage_organisation(organisation_id));

drop policy if exists "zecontrol members read work team members" on zecontrol.work_team_members;
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

drop policy if exists "zecontrol owners create work team members" on zecontrol.work_team_members;
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

drop policy if exists "zecontrol owners update work team members" on zecontrol.work_team_members;
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

drop policy if exists "zecontrol owners delete work team members" on zecontrol.work_team_members;
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

drop policy if exists "zecontrol owners manage work policy assignments" on zecontrol.work_policy_assignments;
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

-- From 20260901120000: overtime approvals and report paging.
create table if not exists zecontrol.overtime_approvals (
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete cascade,
  profile_id uuid not null references zecontrol.profiles_configs(id) on delete cascade,
  work_date date not null,
  status text not null check (status in ('approved', 'rejected')),
  reviewed_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key (organisation_id, profile_id, work_date)
);

alter table zecontrol.overtime_approvals enable row level security;

drop policy if exists "members read permitted overtime approvals" on zecontrol.overtime_approvals;
create policy "members read permitted overtime approvals"
on zecontrol.overtime_approvals for select to authenticated
using (
  profile_id = auth.uid()
  or zecontrol.can_administer_organisation(organisation_id)
);

drop policy if exists "managers review overtime" on zecontrol.overtime_approvals;
create policy "managers review overtime"
on zecontrol.overtime_approvals for all to authenticated
using (zecontrol.can_administer_organisation(organisation_id))
with check (
  zecontrol.can_administer_organisation(organisation_id)
  and reviewed_by = auth.uid()
  and exists (
    select 1 from public.profiles profile
    where profile.id = profile_id
      and profile.organisation_id = organisation_id
      and profile.is_active = true
  )
);

revoke all on zecontrol.overtime_approvals from public, anon, authenticated;
grant select, insert, update (status, reviewed_by, reviewed_at)
  on zecontrol.overtime_approvals to authenticated;

create or replace function zecontrol.review_overtime(
  target_profile_id uuid,
  target_work_date date,
  review_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare target_organisation_id uuid;
begin
  if review_status not in ('approved', 'rejected') then
    raise exception 'invalid_overtime_review';
  end if;
  select profile.organisation_id into target_organisation_id
  from public.profiles profile
  join zecontrol.profiles_configs config on config.id = profile.id and config.is_active = true
  where profile.id = target_profile_id and profile.is_active = true;
  if target_organisation_id is null
    or not zecontrol.can_administer_organisation(target_organisation_id) then
    raise exception 'overtime_review_access_denied';
  end if;
  insert into zecontrol.overtime_approvals (
    organisation_id, profile_id, work_date, status, reviewed_by, reviewed_at
  ) values (
    target_organisation_id, target_profile_id, target_work_date, review_status, auth.uid(), clock_timestamp()
  )
  on conflict (organisation_id, profile_id, work_date) do update
  set status = excluded.status,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at;
end;
$$;

revoke all on function zecontrol.review_overtime(uuid, date, text) from public, anon;
grant execute on function zecontrol.review_overtime(uuid, date, text) to authenticated;

create or replace function zecontrol.list_report_event_days(
  target_organisation_id uuid,
  target_profile_id uuid,
  range_start timestamptz,
  range_end timestamptz,
  page_offset integer,
  page_limit integer
)
returns table (profile_id uuid, work_date date, event_data jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  organisation_timezone text;
begin
  if auth.uid() is null
    or not (
      zecontrol.can_administer_organisation(target_organisation_id)
      or (
        target_profile_id = auth.uid()
        and zecontrol.can_read_organisation(target_organisation_id)
      )
    ) then
    raise exception 'report_access_denied';
  end if;

  if page_offset is null or page_limit is null
    or page_offset < 0 or page_limit < 1 or page_limit > 500 then
    raise exception 'invalid_report_page';
  end if;

  select coalesce(config.timezone, 'Africa/Abidjan')
  into organisation_timezone
  from zecontrol.orga_configs config
  where config.id = target_organisation_id;

  return query
  select
    event.profile_id,
    (event.pointed_at at time zone organisation_timezone)::date,
    jsonb_agg(
      jsonb_build_object(
        'id', event.id,
        'type', event.type,
        'event_status', event.event_status,
        'pointed_at', event.pointed_at,
        'profile_id', event.profile_id,
        'organisation_id', event.organisation_id
      ) order by event.pointed_at, event.created_at
    )
  from zecontrol.events event
  where event.organisation_id = target_organisation_id
    and (target_profile_id is null or event.profile_id = target_profile_id)
    and (range_start is null or event.pointed_at >= range_start)
    and (range_end is null or event.pointed_at < range_end)
  group by event.profile_id, (event.pointed_at at time zone organisation_timezone)::date
  order by (event.pointed_at at time zone organisation_timezone)::date desc, event.profile_id
  offset page_offset
  limit page_limit;
end;
$$;

revoke all on function zecontrol.list_report_event_days(uuid, uuid, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function zecontrol.list_report_event_days(uuid, uuid, timestamptz, timestamptz, integer, integer) to authenticated;

commit;

notify pgrst, 'reload schema';
