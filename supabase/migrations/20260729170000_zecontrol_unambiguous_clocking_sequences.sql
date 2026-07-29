-- Keep every workday unambiguous:
-- one start, alternating work/pause events, then one definitive end.

create or replace function zecontrol.is_clocking_day_sequence_valid(
  target_profile_id uuid,
  target_local_day date,
  excluded_event_id uuid default null,
  candidate_type zecontrol.events_type default null,
  candidate_pointed_at timestamptz default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  target_timezone text := 'Africa/Abidjan';
  previous_type zecontrol.events_type;
  item record;
begin
  select coalesce(config.timezone, 'Africa/Abidjan')
  into target_timezone
  from public.profiles as profile
  join zecontrol.orga_configs as config
    on config.id = profile.organisation_id
  where profile.id = target_profile_id;

  target_timezone := coalesce(target_timezone, 'Africa/Abidjan');

  for item in
    select sequence.type
    from (
      select
        event.type,
        event.pointed_at,
        0 as candidate_order,
        event.id::text as stable_order
      from zecontrol.events as event
      where event.profile_id = target_profile_id
        and event.event_status in ('accepted', 'pending')
        and (excluded_event_id is null or event.id <> excluded_event_id)
        and (event.pointed_at at time zone target_timezone)::date = target_local_day

      union all

      select
        candidate_type,
        candidate_pointed_at,
        1,
        'candidate'
      where candidate_type is not null
        and candidate_pointed_at is not null
        and (candidate_pointed_at at time zone target_timezone)::date = target_local_day
    ) as sequence
    order by
      sequence.pointed_at,
      sequence.candidate_order,
      sequence.stable_order
  loop
    if not (
      (previous_type is null and item.type = 'start')
      or (
        previous_type in ('start', 'resume')
        and item.type in ('break', 'end')
      )
      or (
        previous_type = 'break'
        and item.type in ('resume', 'end')
      )
    ) then
      return false;
    end if;
    previous_type := item.type;
  end loop;

  return true;
end;
$$;

revoke all on function zecontrol.is_clocking_day_sequence_valid(
  uuid,
  date,
  uuid,
  zecontrol.events_type,
  timestamptz
) from public;

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
begin
  select coalesce(config.timezone, 'Africa/Abidjan')
  into target_timezone
  from public.profiles as profile
  join zecontrol.orga_configs as config
    on config.id = profile.organisation_id
  where profile.id = target_profile_id;

  target_timezone := coalesce(target_timezone, 'Africa/Abidjan');
  candidate_local_day :=
    (candidate_pointed_at at time zone target_timezone)::date;

  return zecontrol.is_clocking_day_sequence_valid(
    target_profile_id,
    candidate_local_day,
    excluded_event_id,
    candidate_type,
    candidate_pointed_at
  );
end;
$$;

revoke all on function zecontrol.is_clocking_sequence_valid_with_candidate(
  uuid,
  uuid,
  zecontrol.events_type,
  timestamptz
) from public;

create or replace function zecontrol.prepare_event_change_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  actor_organisation_id uuid;
  actor_timezone text := 'Africa/Abidjan';
  source_event zecontrol.events%rowtype;
  source_local_day date;
  requested_local_day date;
begin
  select
    profile.organisation_id,
    coalesce(config.timezone, 'Africa/Abidjan')
  into
    actor_organisation_id,
    actor_timezone
  from public.profiles as profile
  join zecontrol.profiles_configs as product_profile
    on product_profile.id = profile.id
  left join zecontrol.orga_configs as config
    on config.id = profile.organisation_id
  where profile.id = actor_id
    and profile.is_active = true
    and product_profile.is_active = true;

  if actor_id is null or actor_organisation_id is null then
    raise exception 'event_request_access_denied';
  end if;

  if new.requested_pointed_at > clock_timestamp() then
    raise exception 'event_request_future_time_not_allowed';
  end if;

  actor_timezone := coalesce(actor_timezone, 'Africa/Abidjan');
  requested_local_day :=
    (new.requested_pointed_at at time zone actor_timezone)::date;

  new.profile_id := actor_id;
  new.organisation_id := actor_organisation_id;
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  new.status := 'pending';
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.decision_reason := null;
  new.created_at := clock_timestamp();
  new.updated_at := clock_timestamp();

  if new.request_kind = 'correction' then
    select event.*
    into source_event
    from zecontrol.events as event
    where event.id = new.event_id
      and event.profile_id = actor_id
      and event.event_status in ('accepted', 'pending');

    if not found then
      raise exception 'event_request_source_not_available';
    end if;

    if new.requested_type <> source_event.type then
      raise exception 'event_request_type_change_not_allowed';
    end if;

    new.original_type := source_event.type;
    new.original_pointed_at := source_event.pointed_at;
    source_local_day :=
      (source_event.pointed_at at time zone actor_timezone)::date;

    if source_local_day <> requested_local_day
      and not zecontrol.is_clocking_day_sequence_valid(
        actor_id,
        source_local_day,
        source_event.id,
        null,
        null
      )
    then
      raise exception 'event_request_invalid_sequence';
    end if;
  elsif new.request_kind = 'missing_event' then
    new.event_id := null;
    new.original_type := null;
    new.original_pointed_at := null;
  else
    raise exception 'event_request_kind_invalid';
  end if;

  if not zecontrol.is_clocking_sequence_valid_with_candidate(
    actor_id,
    new.event_id,
    new.requested_type,
    new.requested_pointed_at
  ) then
    raise exception 'event_request_invalid_sequence';
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.prepare_event_change_request() from public;

create or replace function zecontrol.prevent_event_request_type_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
begin
  if new.requested_type is distinct from old.requested_type then
    raise exception 'event_request_type_change_not_allowed';
  end if;
  return new;
end;
$$;

revoke all on function zecontrol.prevent_event_request_type_change()
from public;

drop trigger if exists prevent_event_request_type_change_before_update
on zecontrol.event_change_requests;

create trigger prevent_event_request_type_change_before_update
before update on zecontrol.event_change_requests
for each row execute function zecontrol.prevent_event_request_type_change();

create or replace function zecontrol.validate_clocking_event_sequence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
begin
  if not zecontrol.is_clocking_sequence_valid_with_candidate(
    new.profile_id,
    null,
    new.type,
    new.pointed_at
  ) then
    raise exception 'invalid_clocking_sequence';
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.validate_clocking_event_sequence() from public;

drop trigger if exists zz_validate_clocking_event_sequence_before_insert
on zecontrol.events;

create trigger zz_validate_clocking_event_sequence_before_insert
before insert on zecontrol.events
for each row execute function zecontrol.validate_clocking_event_sequence();

create or replace function zecontrol.validate_approved_event_change_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  target_timezone text := 'Africa/Abidjan';
  original_local_day date;
  requested_local_day date;
begin
  if old.status = 'pending' and new.status = 'approved' then
    select coalesce(config.timezone, 'Africa/Abidjan')
    into target_timezone
    from public.profiles as profile
    join zecontrol.orga_configs as config
      on config.id = profile.organisation_id
    where profile.id = new.profile_id;

    target_timezone := coalesce(target_timezone, 'Africa/Abidjan');
    requested_local_day :=
      (new.requested_pointed_at at time zone target_timezone)::date;

    if not zecontrol.is_clocking_day_sequence_valid(
      new.profile_id,
      requested_local_day,
      null,
      null,
      null
    ) then
      raise exception 'event_request_invalid_sequence';
    end if;

    if new.original_pointed_at is not null then
      original_local_day :=
        (new.original_pointed_at at time zone target_timezone)::date;

      if original_local_day <> requested_local_day
        and not zecontrol.is_clocking_day_sequence_valid(
          new.profile_id,
          original_local_day,
          null,
          null,
          null
        )
      then
        raise exception 'event_request_invalid_sequence';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.validate_approved_event_change_request()
from public;

drop trigger if exists validate_approved_event_change_request_before_update
on zecontrol.event_change_requests;

create trigger validate_approved_event_change_request_before_update
before update on zecontrol.event_change_requests
for each row execute function zecontrol.validate_approved_event_change_request();

notify pgrst, 'reload schema';
