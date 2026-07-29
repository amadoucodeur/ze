-- A forgotten pause is one auditable operation containing both its start and
-- its resume. This keeps closed days valid before, during and after approval.

alter table zecontrol.event_change_requests
  add column if not exists requested_end_at timestamptz;

alter table zecontrol.event_change_requests
  drop constraint if exists event_change_requests_request_kind_check,
  drop constraint if exists event_change_request_shape;

alter table zecontrol.event_change_requests
  add constraint event_change_requests_request_kind_check
    check (request_kind in ('correction', 'missing_event', 'missing_break')),
  add constraint event_change_request_shape check (
    (
      request_kind = 'correction'
      and event_id is not null
      and original_type is not null
      and original_pointed_at is not null
      and requested_end_at is null
    )
    or
    (
      request_kind = 'missing_event'
      and event_id is null
      and original_type is null
      and original_pointed_at is null
      and requested_end_at is null
    )
    or
    (
      request_kind = 'missing_break'
      and event_id is null
      and original_type is null
      and original_pointed_at is null
      and requested_type = 'break'
      and requested_end_at is not null
      and requested_end_at > requested_pointed_at
    )
  );

drop index if exists zecontrol.events_source_request_unique_idx;
create index if not exists events_source_request_idx
  on zecontrol.events (source_request_id)
  where source_request_id is not null;

grant insert (requested_end_at)
on zecontrol.event_change_requests
to authenticated;

create or replace function zecontrol.is_clocking_sequence_valid_with_pair(
  target_profile_id uuid,
  first_type zecontrol.events_type,
  first_pointed_at timestamptz,
  second_type zecontrol.events_type,
  second_pointed_at timestamptz
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
  if first_pointed_at >= second_pointed_at then
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
    (first_pointed_at at time zone target_timezone)::date;

  if (second_pointed_at at time zone target_timezone)::date
    <> target_local_day
  then
    return false;
  end if;

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
        and (event.pointed_at at time zone target_timezone)::date
          = target_local_day

      union all

      select first_type, first_pointed_at, 1, 'first-candidate'

      union all

      select second_type, second_pointed_at, 1, 'second-candidate'
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

revoke all on function zecontrol.is_clocking_sequence_valid_with_pair(
  uuid,
  zecontrol.events_type,
  timestamptz,
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

    if not zecontrol.is_clocking_sequence_valid_with_candidate(
      target_profile_id,
      new.event_id,
      new.requested_type,
      new.requested_pointed_at
    ) then
      raise exception 'event_request_invalid_sequence';
    end if;
  elsif new.request_kind = 'missing_event' then
    new.event_id := null;
    new.original_type := null;
    new.original_pointed_at := null;
    new.requested_end_at := null;

    if not zecontrol.is_clocking_sequence_valid_with_candidate(
      target_profile_id,
      null,
      new.requested_type,
      new.requested_pointed_at
    ) then
      raise exception 'event_request_invalid_sequence';
    end if;
  elsif new.request_kind = 'missing_break' then
    new.event_id := null;
    new.original_type := null;
    new.original_pointed_at := null;
    new.requested_type := 'break';

    if new.requested_end_at is null
      or new.requested_end_at <= new.requested_pointed_at
      or (
        new.requested_end_at at time zone target_timezone
      )::date <> requested_local_day
      or not zecontrol.is_clocking_sequence_valid_with_pair(
        target_profile_id,
        'break',
        new.requested_pointed_at,
        'resume',
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

-- Pair requests are validated as a whole before insertion. Their two event
-- rows must therefore bypass the single-candidate guard.
create or replace function zecontrol.validate_clocking_event_sequence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
begin
  if new.source_request_id is not null
    and exists (
      select 1
      from zecontrol.event_change_requests as request
      where request.id = new.source_request_id
        and request.request_kind = 'missing_break'
        and request.status = 'pending'
        and request.profile_id = new.profile_id
    )
  then
    return new;
  end if;

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

create or replace function zecontrol.review_event_change_request(
  target_request_id uuid,
  review_decision text,
  review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  request_record zecontrol.event_change_requests%rowtype;
  replacement_source text;
begin
  if review_decision not in ('approved', 'rejected') then
    raise exception 'event_request_decision_invalid';
  end if;

  select request.*
  into request_record
  from zecontrol.event_change_requests as request
  where request.id = target_request_id
  for update;

  if not found or request_record.status <> 'pending' then
    raise exception 'event_request_not_pending';
  end if;

  if actor_id is null
    or not zecontrol.can_administer_organisation(
      request_record.organisation_id
    )
  then
    raise exception 'event_request_review_denied';
  end if;

  if review_decision = 'approved' then
    if request_record.request_kind = 'missing_break' then
      if request_record.requested_end_at is null
        or not zecontrol.is_clocking_sequence_valid_with_pair(
          request_record.profile_id,
          'break',
          request_record.requested_pointed_at,
          'resume',
          request_record.requested_end_at
        )
      then
        raise exception 'event_request_invalid_sequence';
      end if;

      insert into zecontrol.events (
        type,
        profile_id,
        organisation_id,
        device,
        is_offline,
        pointed_at,
        event_status,
        reviewed_at,
        reviewed_by,
        review_reason,
        lat,
        long,
        entry_source,
        source_request_id
      ) values
      (
        'break',
        request_record.profile_id,
        request_record.organisation_id,
        jsonb_build_object('source', 'approved_missing_break'),
        false,
        request_record.requested_pointed_at,
        'accepted',
        clock_timestamp(),
        actor_id,
        nullif(btrim(review_note), ''),
        null,
        null,
        'approved_missing',
        request_record.id
      ),
      (
        'resume',
        request_record.profile_id,
        request_record.organisation_id,
        jsonb_build_object('source', 'approved_missing_break'),
        false,
        request_record.requested_end_at,
        'accepted',
        clock_timestamp(),
        actor_id,
        nullif(btrim(review_note), ''),
        null,
        null,
        'approved_missing',
        request_record.id
      );
    else
      if not zecontrol.is_clocking_sequence_valid_with_candidate(
        request_record.profile_id,
        request_record.event_id,
        request_record.requested_type,
        request_record.requested_pointed_at
      ) then
        raise exception 'event_request_invalid_sequence';
      end if;

      if request_record.request_kind = 'correction' then
        update zecontrol.events
        set event_status = 'cancelled',
            updated_at = clock_timestamp(),
            reviewed_at = clock_timestamp(),
            reviewed_by = actor_id,
            review_reason = 'Remplacé par une correction approuvée'
        where id = request_record.event_id;
        replacement_source := 'approved_correction';
      else
        replacement_source := 'approved_missing';
      end if;

      insert into zecontrol.events (
        type,
        profile_id,
        organisation_id,
        device,
        is_offline,
        pointed_at,
        event_status,
        reviewed_at,
        reviewed_by,
        review_reason,
        lat,
        long,
        entry_source,
        source_request_id
      ) values (
        request_record.requested_type,
        request_record.profile_id,
        request_record.organisation_id,
        jsonb_build_object('source', replacement_source),
        false,
        request_record.requested_pointed_at,
        'accepted',
        clock_timestamp(),
        actor_id,
        nullif(btrim(review_note), ''),
        null,
        null,
        replacement_source,
        request_record.id
      );
    end if;
  end if;

  update zecontrol.event_change_requests
  set status = review_decision,
      reviewed_at = clock_timestamp(),
      reviewed_by = actor_id,
      decision_reason = nullif(btrim(review_note), ''),
      updated_at = clock_timestamp()
  where id = request_record.id;

  return jsonb_build_object(
    'id', request_record.id,
    'status', review_decision
  );
end;
$$;

revoke all on function zecontrol.review_event_change_request(
  uuid,
  text,
  text
) from public;
grant execute on function zecontrol.review_event_change_request(
  uuid,
  text,
  text
) to authenticated;

create or replace function zecontrol.create_admin_missing_clocking_break(
  target_profile_id uuid,
  requested_break_at timestamptz,
  requested_resume_at timestamptz,
  admin_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  target_organisation_id uuid;
  request_id uuid;
  clean_reason text := nullif(btrim(coalesce(admin_reason, '')), '');
begin
  select profile.organisation_id
  into target_organisation_id
  from public.profiles as profile
  join zecontrol.profiles_configs as product_profile
    on product_profile.id = profile.id
  where profile.id = target_profile_id
    and profile.is_active = true
    and product_profile.is_active = true;

  if actor_id is null
    or target_organisation_id is null
    or not zecontrol.can_administer_organisation(target_organisation_id)
  then
    raise exception 'admin_missing_event_access_denied';
  end if;

  if char_length(coalesce(clean_reason, '')) > 500 then
    raise exception 'admin_missing_event_reason_too_long';
  end if;

  insert into zecontrol.event_change_requests (
    organisation_id,
    profile_id,
    requested_by,
    request_kind,
    requested_type,
    requested_pointed_at,
    requested_end_at,
    reason,
    status,
    reviewed_by
  ) values (
    target_organisation_id,
    target_profile_id,
    actor_id,
    'missing_break',
    'break',
    requested_break_at,
    requested_resume_at,
    clean_reason,
    'pending',
    actor_id
  )
  returning id into request_id;

  insert into zecontrol.events (
    type,
    profile_id,
    organisation_id,
    device,
    is_offline,
    pointed_at,
    event_status,
    reviewed_at,
    reviewed_by,
    review_reason,
    lat,
    long,
    entry_source,
    source_request_id
  ) values
  (
    'break',
    target_profile_id,
    target_organisation_id,
    jsonb_build_object(
      'source', 'admin_missing_break',
      'administrator_id', actor_id
    ),
    false,
    requested_break_at,
    'accepted',
    clock_timestamp(),
    actor_id,
    clean_reason,
    null,
    null,
    'approved_missing',
    request_id
  ),
  (
    'resume',
    target_profile_id,
    target_organisation_id,
    jsonb_build_object(
      'source', 'admin_missing_break',
      'administrator_id', actor_id
    ),
    false,
    requested_resume_at,
    'accepted',
    clock_timestamp(),
    actor_id,
    clean_reason,
    null,
    null,
    'approved_missing',
    request_id
  );

  update zecontrol.event_change_requests
  set status = 'approved',
      reviewed_at = clock_timestamp(),
      reviewed_by = actor_id,
      decision_reason = clean_reason,
      updated_at = clock_timestamp()
  where id = request_id;

  return jsonb_build_object(
    'request_id', request_id,
    'profile_id', target_profile_id,
    'break_at', requested_break_at,
    'resume_at', requested_resume_at,
    'status', 'approved'
  );
end;
$$;

revoke all on function zecontrol.create_admin_missing_clocking_break(
  uuid,
  timestamptz,
  timestamptz,
  text
) from public;
grant execute on function zecontrol.create_admin_missing_clocking_break(
  uuid,
  timestamptz,
  timestamptz,
  text
) to authenticated;

notify pgrst, 'reload schema';
