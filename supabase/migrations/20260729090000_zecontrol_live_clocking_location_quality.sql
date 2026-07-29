-- Reject unusable live geolocation measurements before they create misleading
-- accepted or rejected events. Approved corrections are intentionally excluded:
-- their location and time are reviewed by an administrator.

create or replace function zecontrol.validate_live_clocking_location()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_can_remote boolean;
  organisation_radius double precision;
  accuracy_text text;
  location_accuracy double precision;
  maximum_accuracy double precision;
begin
  if new.source_request_id is not null then
    return new;
  end if;

  select
    product_profile.can_remote,
    organisation_config.radius::double precision
  into
    actor_can_remote,
    organisation_radius
  from public.profiles as profile
  join zecontrol.profiles_configs as product_profile
    on product_profile.id = profile.id
  join zecontrol.orga_configs as organisation_config
    on organisation_config.id = profile.organisation_id
  where profile.id = auth.uid()
    and profile.is_active = true
    and product_profile.is_active = true
    and organisation_config.is_active = true;

  if actor_can_remote is null then
    raise exception 'clocking_access_denied';
  end if;

  if new.lat is null
    or new.long is null
    or new.lat::double precision < -90
    or new.lat::double precision > 90
    or new.long::double precision < -180
    or new.long::double precision > 180
  then
    raise exception 'clocking_location_required';
  end if;

  -- Remote clocking is allowed outside the site, but a real location is still
  -- recorded. Only restricted on-site clocking requires a usable accuracy.
  if actor_can_remote then
    return new;
  end if;

  accuracy_text := new.device ->> 'accuracy';
  if accuracy_text is null
    or accuracy_text !~ '^[0-9]+([.][0-9]+)?$'
  then
    raise exception 'clocking_location_accuracy_required';
  end if;

  location_accuracy := accuracy_text::double precision;
  maximum_accuracy := greatest(50, least(organisation_radius, 150));

  if location_accuracy < 0
    or location_accuracy > maximum_accuracy
  then
    raise exception 'clocking_location_accuracy_too_low';
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.validate_live_clocking_location() from public;

drop trigger if exists validate_live_clocking_location_before_insert
on zecontrol.events;

create trigger validate_live_clocking_location_before_insert
before insert on zecontrol.events
for each row execute function zecontrol.validate_live_clocking_location();

notify pgrst, 'reload schema';
