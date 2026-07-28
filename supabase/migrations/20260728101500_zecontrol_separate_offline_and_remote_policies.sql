-- Keep offline behavior and remote-work location permission as two independent
-- concerns. Live clocking is governed only by can_remote and the site radius.
-- The policy enum is reserved for the future offline synchronization flow:
-- strict = deny, flexible = require admin review, free = accept on sync.

comment on column zecontrol.profiles_configs.policy is
  'Offline clocking policy: strict=deny, flexible=require review, free=accept on synchronization.';

comment on column zecontrol.profiles_configs.can_remote is
  'When true, live clocking is allowed outside the organisation site radius.';

create or replace function zecontrol.prepare_clocking_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  actor_organisation_id uuid;
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
    product_profile.can_remote,
    coalesce(organisation_config.timezone, 'Africa/Abidjan')
  into
    actor_organisation_id,
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
    if actor_can_remote then
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

  if actor_can_remote
    or distance_meters is null
    or distance_meters <= organisation_radius
  then
    new.event_status := 'accepted';
  else
    new.event_status := 'rejected';
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.prepare_clocking_event() from public;
