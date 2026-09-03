-- Let an agent submit a coherent chain of missing clocking requests without
-- waiting for each preceding request to be reviewed. Pending requests remain
-- provisional: they are considered only while validating another request and
-- are not inserted into zecontrol.events before approval.

create or replace function zecontrol.is_clocking_request_sequence_valid(
  target_profile_id uuid,
  excluded_event_id uuid,
  excluded_request_id uuid,
  candidate_type zecontrol.events_type,
  candidate_pointed_at timestamptz,
  candidate_end_at timestamptz default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  target_timezone text := 'Africa/Abidjan';
  target_local_day date;
  previous_type zecontrol.events_type;
  item record;
begin
  if candidate_pointed_at is null then
    return false;
  end if;

  select coalesce(config.timezone, 'Africa/Abidjan')
  into target_timezone
  from public.profiles as profile
  left join zecontrol.orga_configs as config
    on config.id = profile.organisation_id
  where profile.id = target_profile_id;

  target_timezone := coalesce(target_timezone, 'Africa/Abidjan');
  target_local_day :=
    (candidate_pointed_at at time zone target_timezone)::date;

  if candidate_end_at is not null
    and (
      candidate_type <> 'break'
      or candidate_end_at <= candidate_pointed_at
      or (candidate_end_at at time zone target_timezone)::date
        <> target_local_day
    )
  then
    return false;
  end if;

  for item in
    select sequence.type
    from (
      select
        event.type,
        event.pointed_at,
        0 as source_order,
        event.id::text as stable_order
      from zecontrol.events as event
      where event.profile_id = target_profile_id
        and event.event_status in ('accepted', 'pending')
        and (excluded_event_id is null or event.id <> excluded_event_id)
        and (event.pointed_at at time zone target_timezone)::date
          = target_local_day

      union all

      select
        request.requested_type,
        request.requested_pointed_at,
        1,
        request.id::text || '-start'
      from zecontrol.event_change_requests as request
      where request.profile_id = target_profile_id
        and request.status = 'pending'
        and request.request_kind = 'missing_event'
        and (
          excluded_request_id is null
          or request.id <> excluded_request_id
        )
        and (
          request.requested_pointed_at at time zone target_timezone
        )::date = target_local_day

      union all

      select
        'break'::zecontrol.events_type,
        request.requested_pointed_at,
        1,
        request.id::text || '-break'
      from zecontrol.event_change_requests as request
      where request.profile_id = target_profile_id
        and request.status = 'pending'
        and request.request_kind = 'missing_break'
        and (
          excluded_request_id is null
          or request.id <> excluded_request_id
        )
        and (
          request.requested_pointed_at at time zone target_timezone
        )::date = target_local_day

      union all

      select
        'resume'::zecontrol.events_type,
        request.requested_end_at,
        1,
        request.id::text || '-resume'
      from zecontrol.event_change_requests as request
      where request.profile_id = target_profile_id
        and request.status = 'pending'
        and request.request_kind = 'missing_break'
        and request.requested_end_at is not null
        and (
          excluded_request_id is null
          or request.id <> excluded_request_id
        )
        and (
          request.requested_pointed_at at time zone target_timezone
        )::date = target_local_day

      union all

      select
        candidate_type,
        candidate_pointed_at,
        2,
        'candidate-start'

      union all

      select
        'resume'::zecontrol.events_type,
        candidate_end_at,
        2,
        'candidate-end'
      where candidate_end_at is not null
    ) as sequence
    order by
      sequence.pointed_at,
      sequence.source_order,
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

revoke all on function zecontrol.is_clocking_request_sequence_valid(
  uuid,
  uuid,
  uuid,
  zecontrol.events_type,
  timestamptz,
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
  target_profile_id uuid;
  target_organisation_id uuid;
  target_timezone text := 'Africa/Abidjan';
  admin_on_behalf boolean;
  source_event zecontrol.events%rowtype;
  source_local_day date;
  requested_local_day date;
begin
  admin_on_behalf :=
    new.request_kind in ('missing_event', 'missing_break')
    and new.requested_by = actor_id
    and new.reviewed_by = actor_id
    and new.status = 'pending';

  if actor_id is null then
    raise exception 'event_request_access_denied';
  end if;

  if admin_on_behalf then
    target_profile_id := new.profile_id;

    select
      profile.organisation_id,
      coalesce(config.timezone, 'Africa/Abidjan')
    into
      target_organisation_id,
      target_timezone
    from public.profiles as profile
    join zecontrol.profiles_configs as product_profile
      on product_profile.id = profile.id
    left join zecontrol.orga_configs as config
      on config.id = profile.organisation_id
    where profile.id = target_profile_id
      and profile.is_active = true
      and product_profile.is_active = true;

    if target_organisation_id is null
      or not zecontrol.can_administer_organisation(target_organisation_id)
    then
      raise exception 'admin_missing_event_access_denied';
    end if;
  else
    target_profile_id := actor_id;

    select
      profile.organisation_id,
      coalesce(config.timezone, 'Africa/Abidjan')
    into
      target_organisation_id,
      target_timezone
    from public.profiles as profile
    join zecontrol.profiles_configs as product_profile
      on product_profile.id = profile.id
    left join zecontrol.orga_configs as config
      on config.id = profile.organisation_id
    where profile.id = actor_id
      and profile.is_active = true
      and product_profile.is_active = true;

    if target_organisation_id is null then
      raise exception 'event_request_access_denied';
    end if;
  end if;

  -- Prevent two simultaneous submissions for the same collaborator from
  -- validating against two different provisional chronologies.
  perform pg_advisory_xact_lock(
    hashtextextended(target_profile_id::text, 0)
  );

  if new.requested_pointed_at > clock_timestamp()
    or (
      new.requested_end_at is not null
      and new.requested_end_at > clock_timestamp()
    )
  then
    raise exception 'event_request_future_time_not_allowed';
  end if;

  target_timezone := coalesce(target_timezone, 'Africa/Abidjan');
  requested_local_day :=
    (new.requested_pointed_at at time zone target_timezone)::date;

  new.profile_id := target_profile_id;
  new.organisation_id := target_organisation_id;
  new.requested_by := actor_id;
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  new.status := 'pending';
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.decision_reason := null;
  new.created_at := clock_timestamp();
  new.updated_at := clock_timestamp();

  if new.request_kind = 'correction' then
    if admin_on_behalf then
      raise exception 'admin_event_correction_not_supported';
    end if;

    new.requested_end_at := null;

    select event.*
    into source_event
    from zecontrol.events as event
    where event.id = new.event_id
      and event.profile_id = target_profile_id
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
      (source_event.pointed_at at time zone target_timezone)::date;

    if source_local_day <> requested_local_day
      and not zecontrol.is_clocking_day_sequence_valid(
        target_profile_id,
        source_local_day,
        source_event.id,
        null,
        null
      )
    then
      raise exception 'event_request_invalid_sequence';
    end if;

    if not zecontrol.is_clocking_request_sequence_valid(
      target_profile_id,
      new.event_id,
      new.id,
      new.requested_type,
      new.requested_pointed_at,
      null
    ) then
      raise exception 'event_request_invalid_sequence';
    end if;
  elsif new.request_kind = 'missing_event' then
    new.event_id := null;
    new.original_type := null;
    new.original_pointed_at := null;
    new.requested_end_at := null;

    if not zecontrol.is_clocking_request_sequence_valid(
      target_profile_id,
      null,
      new.id,
      new.requested_type,
      new.requested_pointed_at,
      null
    ) then
      raise exception 'event_request_invalid_sequence';
    end if;
  elsif new.request_kind = 'missing_break' then
    new.event_id := null;
    new.original_type := null;
    new.original_pointed_at := null;
    new.requested_type := 'break';

    if new.requested_end_at is null
      or not zecontrol.is_clocking_request_sequence_valid(
        target_profile_id,
        null,
        new.id,
        'break',
        new.requested_pointed_at,
        new.requested_end_at
      )
    then
      raise exception 'event_request_invalid_break';
    end if;
  else
    raise exception 'event_request_kind_invalid';
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.prepare_event_change_request() from public;

notify pgrst, 'reload schema';
