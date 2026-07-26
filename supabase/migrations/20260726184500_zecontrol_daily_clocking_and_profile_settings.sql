-- Keep live clocking sequences independent for each local workday and make
-- personal settings updates atomic while preserving authenticated RLS.

alter table zecontrol.orga_configs
  add column if not exists timezone text not null default 'Africa/Abidjan';

grant update (timezone) on zecontrol.orga_configs to authenticated;

create or replace function zecontrol.is_clocking_sequence_valid_with_candidate(
  target_profile_id uuid,
  excluded_event_id uuid,
  candidate_type zecontrol.events_type,
  candidate_pointed_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  target_timezone text := 'Africa/Abidjan';
  candidate_local_day date;
  previous_type zecontrol.events_type;
  item record;
begin
  select coalesce(config.timezone, 'Africa/Abidjan')
  into target_timezone
  from public.profiles as profile
  join zecontrol.orga_configs as config on config.id = profile.organisation_id
  where profile.id = target_profile_id;

  target_timezone := coalesce(target_timezone, 'Africa/Abidjan');
  candidate_local_day := (candidate_pointed_at at time zone target_timezone)::date;

  for item in
    select sequence.type
    from (
      select event.type, event.pointed_at, event.id::text as stable_order
      from zecontrol.events as event
      where event.profile_id = target_profile_id
        and event.event_status in ('accepted', 'pending')
        and (excluded_event_id is null or event.id <> excluded_event_id)
        and (event.pointed_at at time zone target_timezone)::date = candidate_local_day
      union all
      select candidate_type, candidate_pointed_at, 'zzzz-candidate'
    ) as sequence
    order by sequence.pointed_at, sequence.stable_order
  loop
    if not (
      (previous_type is null and item.type = 'start')
      or (previous_type = 'end' and item.type = 'start')
      or (previous_type in ('start', 'resume') and item.type in ('break', 'end'))
      or (previous_type = 'break' and item.type in ('resume', 'end'))
    ) then
      return false;
    end if;
    previous_type := item.type;
  end loop;

  return true;
end;
$$;

revoke all on function zecontrol.is_clocking_sequence_valid_with_candidate(uuid, uuid, zecontrol.events_type, timestamptz) from public;

create or replace function zecontrol.prepare_clocking_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  actor_organisation_id uuid;
  actor_policy zecontrol.profile_config_policy;
  actor_can_remote boolean;
  actor_timezone text := 'Africa/Abidjan';
  current_local_day date;
  day_start timestamptz;
  day_end timestamptz;
  organisation_lat double precision;
  organisation_long double precision;
  organisation_radius double precision;
  distance_meters double precision;
  previous_type zecontrol.events_type;
begin
  if new.source_request_id is not null then
    if not exists (
      select 1
      from zecontrol.event_change_requests as request
      where request.id = new.source_request_id
        and request.status = 'pending'
        and request.profile_id = new.profile_id
        and request.organisation_id = new.organisation_id
        and zecontrol.can_administer_organisation(request.organisation_id)
    ) then
      raise exception 'approved_request_event_denied';
    end if;
    new.created_at := clock_timestamp();
    new.updated_at := clock_timestamp();
    return new;
  end if;

  if actor_id is null then
    raise exception 'authentication_required';
  end if;

  select
    profile.organisation_id,
    product_profile.policy,
    product_profile.can_remote,
    coalesce(organisation_config.timezone, 'Africa/Abidjan')
  into
    actor_organisation_id,
    actor_policy,
    actor_can_remote,
    actor_timezone
  from public.profiles as profile
  join zecontrol.profiles_configs as product_profile on product_profile.id = profile.id
  join public.organisations as organisation on organisation.id = profile.organisation_id
  join zecontrol.orga_configs as organisation_config on organisation_config.id = organisation.id
  where profile.id = actor_id
    and profile.is_active = true
    and product_profile.is_active = true
    and organisation.status = 'active'
    and organisation_config.is_active = true;

  if actor_organisation_id is null then
    raise exception 'clocking_access_denied';
  end if;

  actor_timezone := coalesce(actor_timezone, 'Africa/Abidjan');
  current_local_day := (clock_timestamp() at time zone actor_timezone)::date;
  day_start := current_local_day::timestamp at time zone actor_timezone;
  day_end := (current_local_day + 1)::timestamp at time zone actor_timezone;

  select event.type
  into previous_type
  from zecontrol.events as event
  where event.profile_id = actor_id
    and event.event_status in ('accepted', 'pending')
    and event.pointed_at >= day_start
    and event.pointed_at < day_end
  order by event.pointed_at desc, event.created_at desc
  limit 1;

  if not (
    (previous_type is null and new.type = 'start')
    or (previous_type = 'end' and new.type = 'start')
    or (previous_type in ('start', 'resume') and new.type in ('break', 'end'))
    or (previous_type = 'break' and new.type in ('resume', 'end'))
  ) then
    raise exception 'invalid_clocking_sequence';
  end if;

  select
    config.lat::double precision,
    config.long::double precision,
    config.radius::double precision
  into
    organisation_lat,
    organisation_long,
    organisation_radius
  from zecontrol.orga_configs as config
  where config.id = actor_organisation_id;

  if organisation_lat is null or organisation_long is null or organisation_radius is null then
    if actor_can_remote or actor_policy = 'free' then
      distance_meters := null;
    else
      raise exception 'clocking_location_not_configured';
    end if;
  else
    distance_meters := 6371000 * 2 * asin(sqrt(
      power(sin(radians(new.lat::double precision - organisation_lat) / 2), 2)
      + cos(radians(organisation_lat))
      * cos(radians(new.lat::double precision))
      * power(sin(radians(new.long::double precision - organisation_long) / 2), 2)
    ));
  end if;

  new.profile_id := actor_id;
  new.organisation_id := actor_organisation_id;
  new.pointed_at := clock_timestamp();
  new.created_at := clock_timestamp();
  new.updated_at := clock_timestamp();
  new.is_offline := false;
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.review_reason := null;
  new.entry_source := 'live';
  new.source_request_id := null;

  if actor_can_remote or actor_policy = 'free' or distance_meters is null or distance_meters <= organisation_radius then
    new.event_status := 'accepted';
  elsif actor_policy = 'flexible' then
    new.event_status := 'pending';
  else
    new.event_status := 'rejected';
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.prepare_clocking_event() from public;

-- Reassert the narrow client-side settings permissions in case a previous
-- deployment applied the UI before its grants and policies.
alter table public.profiles enable row level security;
alter table zecontrol.profiles_configs enable row level security;

drop policy if exists "zecontrol users update own shared profile" on public.profiles;
create policy "zecontrol users update own shared profile"
on public.profiles for update
to authenticated
using (id = auth.uid() and is_active = true)
with check (id = auth.uid() and is_active = true);

drop policy if exists "zecontrol users update own profile details" on zecontrol.profiles_configs;
create policy "zecontrol users update own profile details"
on zecontrol.profiles_configs for update
to authenticated
using (id = auth.uid() and is_active = true)
with check (id = auth.uid() and is_active = true);

grant usage on schema zecontrol to authenticated;

revoke update on public.profiles from authenticated;
revoke update on zecontrol.profiles_configs from authenticated;

grant update (fullname, phone, updated_at)
on public.profiles to authenticated;
grant update (poste, service, updated_at)
on zecontrol.profiles_configs to authenticated;

create or replace function zecontrol.update_own_profile_settings(
  new_fullname text,
  new_phone text,
  new_poste text,
  new_service text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  clean_fullname text := btrim(coalesce(new_fullname, ''));
  clean_phone text := nullif(btrim(coalesce(new_phone, '')), '');
  clean_poste text := nullif(btrim(coalesce(new_poste, '')), '');
  clean_service text := nullif(btrim(coalesce(new_service, '')), '');
begin
  if actor_id is null then
    raise exception 'profile_settings_authentication_required';
  end if;

  if char_length(clean_fullname) < 2 or char_length(clean_fullname) > 100 then
    raise exception 'profile_settings_fullname_invalid';
  end if;
  if char_length(coalesce(clean_phone, '')) > 30
    or char_length(coalesce(clean_poste, '')) > 100
    or char_length(coalesce(clean_service, '')) > 100 then
    raise exception 'profile_settings_value_too_long';
  end if;

  update public.profiles
  set fullname = clean_fullname,
      phone = clean_phone,
      updated_at = clock_timestamp()
  where id = actor_id
    and is_active = true;

  if not found then
    raise exception 'profile_settings_shared_profile_denied';
  end if;

  update zecontrol.profiles_configs
  set poste = clean_poste,
      service = clean_service,
      updated_at = clock_timestamp()
  where id = actor_id
    and is_active = true;

  if not found then
    raise exception 'profile_settings_product_profile_denied';
  end if;

  return jsonb_build_object(
    'fullname', clean_fullname,
    'phone', clean_phone,
    'poste', clean_poste,
    'service', clean_service
  );
end;
$$;

revoke all on function zecontrol.update_own_profile_settings(text, text, text, text) from public;
grant execute on function zecontrol.update_own_profile_settings(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
