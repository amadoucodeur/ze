-- Secure client-side clocking and organisation reporting.

alter table zecontrol.events
  alter column reviewed_by drop not null,
  alter column pointed_at set default now();

create or replace function zecontrol.can_administer_organisation(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, zecontrol
as $$
  select exists (
    select 1
    from public.profiles as profile
    join zecontrol.profiles_configs as product_profile on product_profile.id = profile.id
    where profile.id = auth.uid()
      and profile.organisation_id = target_organisation_id
      and profile.is_active = true
      and product_profile.is_active = true
      and product_profile.role in ('owner', 'admin')
  );
$$;

create or replace function zecontrol.is_organisation_colleague(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, zecontrol
as $$
  select exists (
    select 1
    from public.profiles as current_profile
    join public.profiles as target_profile
      on target_profile.organisation_id = current_profile.organisation_id
    join zecontrol.profiles_configs as current_product on current_product.id = current_profile.id
    join zecontrol.profiles_configs as target_product on target_product.id = target_profile.id
    where current_profile.id = auth.uid()
      and target_profile.id = target_profile_id
      and current_profile.is_active = true
      and target_profile.is_active = true
      and current_product.is_active = true
      and target_product.is_active = true
  );
$$;

revoke all on function zecontrol.can_administer_organisation(uuid) from public;
revoke all on function zecontrol.is_organisation_colleague(uuid) from public;
grant execute on function zecontrol.can_administer_organisation(uuid) to authenticated;
grant execute on function zecontrol.is_organisation_colleague(uuid) to authenticated;

create or replace function zecontrol.prepare_clocking_event()
returns trigger
language plpgsql
security definer
set search_path = public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  actor_organisation_id uuid;
  actor_policy zecontrol.profile_config_policy;
  actor_can_remote boolean;
  organisation_lat double precision;
  organisation_long double precision;
  organisation_radius double precision;
  distance_meters double precision;
  previous_type zecontrol.events_type;
begin
  if actor_id is null then
    raise exception 'authentication_required';
  end if;

  select profile.organisation_id, product_profile.policy, product_profile.can_remote
  into actor_organisation_id, actor_policy, actor_can_remote
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

  select event.type
  into previous_type
  from zecontrol.events as event
  where event.profile_id = actor_id
    and event.event_status in ('accepted', 'pending')
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

  select config.lat::double precision, config.long::double precision, config.radius::double precision
  into organisation_lat, organisation_long, organisation_radius
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

drop trigger if exists prepare_clocking_event_before_insert on zecontrol.events;
create trigger prepare_clocking_event_before_insert
before insert on zecontrol.events
for each row execute function zecontrol.prepare_clocking_event();

alter table zecontrol.events enable row level security;

drop policy if exists "zecontrol users read permitted events" on zecontrol.events;
create policy "zecontrol users read permitted events"
on zecontrol.events for select
to authenticated
using (
  profile_id = auth.uid()
  or zecontrol.can_administer_organisation(organisation_id)
);

drop policy if exists "zecontrol users create own events" on zecontrol.events;
create policy "zecontrol users create own events"
on zecontrol.events for insert
to authenticated
with check (
  profile_id = auth.uid()
  and zecontrol.can_read_organisation(organisation_id)
);

drop policy if exists "zecontrol colleagues read basic profiles" on public.profiles;
create policy "zecontrol colleagues read basic profiles"
on public.profiles for select
to authenticated
using (zecontrol.is_organisation_colleague(id));

drop policy if exists "zecontrol managers read organisation product profiles" on zecontrol.profiles_configs;
create policy "zecontrol managers read organisation product profiles"
on zecontrol.profiles_configs for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.profiles as target_profile
    where target_profile.id = profiles_configs.id
      and zecontrol.can_administer_organisation(target_profile.organisation_id)
  )
);

grant select on zecontrol.events to authenticated;
revoke insert, update, delete on zecontrol.events from authenticated;
grant insert (type, device, lat, long) on zecontrol.events to authenticated;

revoke select on public.profiles from authenticated;
grant select (id, fullname, identifiant) on public.profiles to authenticated;
