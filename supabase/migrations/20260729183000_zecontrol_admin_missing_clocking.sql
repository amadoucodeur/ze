-- Administrators may add a forgotten event for a collaborator. The operation
-- is approved immediately, while keeping the same auditable request trail.

alter table zecontrol.event_change_requests
  add column if not exists requested_by uuid
  references public.profiles(id);

update zecontrol.event_change_requests
set requested_by = profile_id
where requested_by is null;

alter table zecontrol.event_change_requests
  alter column requested_by set not null;

create index if not exists event_change_requests_requested_by_idx
  on zecontrol.event_change_requests (requested_by, created_at desc);

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
    new.request_kind = 'missing_event'
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

  if new.requested_pointed_at > clock_timestamp() then
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
  elsif new.request_kind = 'missing_event' then
    new.event_id := null;
    new.original_type := null;
    new.original_pointed_at := null;
  else
    raise exception 'event_request_kind_invalid';
  end if;

  if not zecontrol.is_clocking_sequence_valid_with_candidate(
    target_profile_id,
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

create or replace function zecontrol.create_admin_missing_clocking_event(
  target_profile_id uuid,
  requested_event_type zecontrol.events_type,
  requested_pointed_at timestamptz,
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
  created_event zecontrol.events%rowtype;
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

  if requested_pointed_at > clock_timestamp() then
    raise exception 'event_request_future_time_not_allowed';
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
    reason,
    status,
    reviewed_by
  ) values (
    target_organisation_id,
    target_profile_id,
    actor_id,
    'missing_event',
    requested_event_type,
    requested_pointed_at,
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
  ) values (
    requested_event_type,
    target_profile_id,
    target_organisation_id,
    jsonb_build_object(
      'source', 'admin_missing',
      'administrator_id', actor_id
    ),
    false,
    requested_pointed_at,
    'accepted',
    clock_timestamp(),
    actor_id,
    clean_reason,
    null,
    null,
    'approved_missing',
    request_id
  )
  returning * into created_event;

  update zecontrol.event_change_requests
  set status = 'approved',
      reviewed_at = clock_timestamp(),
      reviewed_by = actor_id,
      decision_reason = clean_reason,
      updated_at = clock_timestamp()
  where id = request_id;

  return jsonb_build_object(
    'id', created_event.id,
    'profile_id', created_event.profile_id,
    'type', created_event.type,
    'pointed_at', created_event.pointed_at,
    'event_status', created_event.event_status,
    'request_id', request_id
  );
end;
$$;

revoke all on function zecontrol.create_admin_missing_clocking_event(
  uuid,
  zecontrol.events_type,
  timestamptz,
  text
) from public;

grant execute on function zecontrol.create_admin_missing_clocking_event(
  uuid,
  zecontrol.events_type,
  timestamptz,
  text
) to authenticated;

comment on function zecontrol.create_admin_missing_clocking_event(
  uuid,
  zecontrol.events_type,
  timestamptz,
  text
) is
  'Immediately approves a sequence-safe forgotten event added by an organisation administrator.';

notify pgrst, 'reload schema';
