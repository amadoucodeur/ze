-- Optional, versioned work-policy configurator for ZeControl.
-- Owners edit metadata and drafts directly through RLS. Publishing is the only
-- privileged operation because it creates an immutable regulatory snapshot.

create table if not exists zecontrol.work_policies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete cascade,
  name text not null default 'Cadre de travail principal',
  is_enabled boolean not null default false,
  is_default boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_policies_name_length check (char_length(btrim(name)) between 2 and 100)
);

create unique index if not exists work_policies_one_default_per_organisation
  on zecontrol.work_policies (organisation_id)
  where is_default = true;

create table if not exists zecontrol.work_policy_drafts (
  policy_id uuid primary key references zecontrol.work_policies(id) on delete cascade,
  definition jsonb not null,
  effective_from date not null,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint work_policy_drafts_definition_object
    check (jsonb_typeof(definition) = 'object')
);

create table if not exists zecontrol.work_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references zecontrol.work_policies(id) on delete restrict,
  version_number integer not null,
  definition jsonb not null,
  effective_from date not null,
  published_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz not null default now(),
  constraint work_policy_versions_number_positive check (version_number > 0),
  constraint work_policy_versions_definition_object
    check (jsonb_typeof(definition) = 'object'),
  unique (policy_id, version_number),
  unique (policy_id, effective_from)
);

-- Foundation for later service/profile-specific policies. The first interface
-- deliberately configures only the organisation default to remain effortless.
create table if not exists zecontrol.work_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete cascade,
  policy_id uuid not null references zecontrol.work_policies(id) on delete cascade,
  target_type text not null,
  service_name text,
  profile_id uuid references zecontrol.profiles_configs(id) on delete cascade,
  valid_from date not null,
  valid_until date,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_policy_assignments_target_type
    check (target_type in ('organisation', 'service', 'profile')),
  constraint work_policy_assignments_target_shape
    check (
      (target_type = 'organisation' and service_name is null and profile_id is null)
      or (target_type = 'service' and nullif(btrim(service_name), '') is not null and profile_id is null)
      or (target_type = 'profile' and service_name is null and profile_id is not null)
    ),
  constraint work_policy_assignments_dates
    check (valid_until is null or valid_until >= valid_from)
);

create index if not exists work_policy_versions_policy_effective
  on zecontrol.work_policy_versions (policy_id, effective_from desc);
create index if not exists work_policy_assignments_organisation
  on zecontrol.work_policy_assignments (organisation_id, target_type, valid_from);

create or replace function zecontrol.is_valid_work_policy_definition(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, zecontrol
as $$
declare
  candidate_mode text;
  candidate_day jsonb;
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
  ) then
    return false;
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

create or replace function zecontrol.publish_work_policy(
  target_policy_id uuid,
  target_effective_from date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  target_organisation_id uuid;
  organisation_timezone text;
  local_today date;
  draft_definition jsonb;
  next_version integer;
  published_version_id uuid;
begin
  if actor_id is null then
    raise exception 'work_policy_authentication_required';
  end if;

  select policy.organisation_id, coalesce(config.timezone, 'Africa/Abidjan')
  into target_organisation_id, organisation_timezone
  from zecontrol.work_policies as policy
  join zecontrol.orga_configs as config on config.id = policy.organisation_id
  where policy.id = target_policy_id
  for update of policy;

  if target_organisation_id is null
    or not zecontrol.can_manage_organisation(target_organisation_id) then
    raise exception 'work_policy_access_denied';
  end if;

  local_today := (clock_timestamp() at time zone organisation_timezone)::date;
  if target_effective_from < local_today then
    raise exception 'work_policy_retroactive_publication_forbidden';
  end if;

  select draft.definition
  into draft_definition
  from zecontrol.work_policy_drafts as draft
  where draft.policy_id = target_policy_id
  for update;

  if draft_definition is null then
    raise exception 'work_policy_draft_missing';
  end if;

  if not zecontrol.is_valid_work_policy_definition(draft_definition) then
    raise exception 'work_policy_definition_invalid';
  end if;

  select coalesce(max(version.version_number), 0) + 1
  into next_version
  from zecontrol.work_policy_versions as version
  where version.policy_id = target_policy_id;

  -- A scheduled version for the same day is replaced by the newly published
  -- snapshot. Past versions remain immutable.
  delete from zecontrol.work_policy_versions
  where policy_id = target_policy_id
    and effective_from = target_effective_from
    and effective_from >= local_today;

  insert into zecontrol.work_policy_versions (
    policy_id,
    version_number,
    definition,
    effective_from,
    published_by
  )
  values (
    target_policy_id,
    next_version,
    draft_definition,
    target_effective_from,
    actor_id
  )
  returning id into published_version_id;

  delete from zecontrol.work_policy_drafts
  where policy_id = target_policy_id;

  update zecontrol.work_policies
  set is_enabled = true,
      updated_at = clock_timestamp()
  where id = target_policy_id;

  return jsonb_build_object(
    'id', published_version_id,
    'version', next_version,
    'effectiveFrom', target_effective_from
  );
end;
$$;

alter table zecontrol.work_policies enable row level security;
alter table zecontrol.work_policy_drafts enable row level security;
alter table zecontrol.work_policy_versions enable row level security;
alter table zecontrol.work_policy_assignments enable row level security;

create policy "zecontrol members read work policies"
on zecontrol.work_policies for select
to authenticated
using (zecontrol.can_read_organisation(organisation_id));

create policy "zecontrol owners create work policies"
on zecontrol.work_policies for insert
to authenticated
with check (
  zecontrol.can_manage_organisation(organisation_id)
  and created_by = auth.uid()
);

create policy "zecontrol owners update work policies"
on zecontrol.work_policies for update
to authenticated
using (zecontrol.can_manage_organisation(organisation_id))
with check (zecontrol.can_manage_organisation(organisation_id));

create policy "zecontrol owners delete unused work policies"
on zecontrol.work_policies for delete
to authenticated
using (
  zecontrol.can_manage_organisation(organisation_id)
  and not exists (
    select 1 from zecontrol.work_policy_versions as version
    where version.policy_id = work_policies.id
  )
);

create policy "zecontrol owners read work policy drafts"
on zecontrol.work_policy_drafts for select
to authenticated
using (
  exists (
    select 1
    from zecontrol.work_policies as policy
    where policy.id = work_policy_drafts.policy_id
      and zecontrol.can_manage_organisation(policy.organisation_id)
  )
);

create policy "zecontrol owners create work policy drafts"
on zecontrol.work_policy_drafts for insert
to authenticated
with check (
  updated_by = auth.uid()
  and exists (
    select 1
    from zecontrol.work_policies as policy
    where policy.id = work_policy_drafts.policy_id
      and zecontrol.can_manage_organisation(policy.organisation_id)
  )
);

create policy "zecontrol owners update work policy drafts"
on zecontrol.work_policy_drafts for update
to authenticated
using (
  exists (
    select 1
    from zecontrol.work_policies as policy
    where policy.id = work_policy_drafts.policy_id
      and zecontrol.can_manage_organisation(policy.organisation_id)
  )
)
with check (
  updated_by = auth.uid()
  and exists (
    select 1
    from zecontrol.work_policies as policy
    where policy.id = work_policy_drafts.policy_id
      and zecontrol.can_manage_organisation(policy.organisation_id)
  )
);

create policy "zecontrol owners delete work policy drafts"
on zecontrol.work_policy_drafts for delete
to authenticated
using (
  exists (
    select 1
    from zecontrol.work_policies as policy
    where policy.id = work_policy_drafts.policy_id
      and zecontrol.can_manage_organisation(policy.organisation_id)
  )
);

create policy "zecontrol members read published work policy versions"
on zecontrol.work_policy_versions for select
to authenticated
using (
  exists (
    select 1
    from zecontrol.work_policies as policy
    where policy.id = work_policy_versions.policy_id
      and zecontrol.can_read_organisation(policy.organisation_id)
  )
);

create policy "zecontrol members read work policy assignments"
on zecontrol.work_policy_assignments for select
to authenticated
using (zecontrol.can_read_organisation(organisation_id));

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
);

grant select, delete on zecontrol.work_policies to authenticated;
grant insert (organisation_id, name, is_enabled, is_default, created_by)
  on zecontrol.work_policies to authenticated;
grant update (name, is_enabled, is_default, updated_at)
  on zecontrol.work_policies to authenticated;

grant select, delete on zecontrol.work_policy_drafts to authenticated;
grant insert (policy_id, definition, effective_from, updated_by, updated_at)
  on zecontrol.work_policy_drafts to authenticated;
grant update (definition, effective_from, updated_by, updated_at)
  on zecontrol.work_policy_drafts to authenticated;

grant select on zecontrol.work_policy_versions to authenticated;
grant select, insert, update, delete on zecontrol.work_policy_assignments to authenticated;

revoke all on function zecontrol.is_valid_work_policy_definition(jsonb) from public;
revoke all on function zecontrol.publish_work_policy(uuid, date) from public;
revoke all on function zecontrol.publish_work_policy(uuid, date) from anon;
grant execute on function zecontrol.publish_work_policy(uuid, date) to authenticated;

notify pgrst, 'reload schema';
