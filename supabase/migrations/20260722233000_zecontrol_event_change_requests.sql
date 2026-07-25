-- Auditable correction and forgotten-clocking requests.

create table if not exists zecontrol.event_change_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  organisation_id uuid not null references public.organisations(id),
  profile_id uuid not null references zecontrol.profiles_configs(id),
  event_id uuid references zecontrol.events(id),
  request_kind text not null check (request_kind in ('correction', 'missing_event')),
  requested_type zecontrol.events_type not null,
  requested_pointed_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  original_type zecontrol.events_type,
  original_pointed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_at timestamptz,
  reviewed_by uuid references zecontrol.profiles_configs(id),
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 500),
  constraint event_change_request_shape check (
    (request_kind = 'correction' and event_id is not null and original_type is not null and original_pointed_at is not null)
    or
    (request_kind = 'missing_event' and event_id is null and original_type is null and original_pointed_at is null)
  )
);

create index if not exists event_change_requests_profile_created_idx
  on zecontrol.event_change_requests (profile_id, created_at desc);
create index if not exists event_change_requests_admin_queue_idx
  on zecontrol.event_change_requests (organisation_id, status, created_at desc);
create unique index if not exists event_change_requests_one_pending_correction_idx
  on zecontrol.event_change_requests (event_id)
  where status = 'pending' and event_id is not null;

alter table zecontrol.events
  alter column lat drop not null,
  alter column long drop not null,
  add column if not exists entry_source text not null default 'live'
    check (entry_source in ('live', 'approved_correction', 'approved_missing')),
  add column if not exists source_request_id uuid references zecontrol.event_change_requests(id);

create unique index if not exists events_source_request_unique_idx
  on zecontrol.events (source_request_id)
  where source_request_id is not null;

create or replace function zecontrol.prepare_event_change_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  actor_organisation_id uuid;
  source_event zecontrol.events%rowtype;
begin
  select profile.organisation_id
  into actor_organisation_id
  from public.profiles as profile
  join zecontrol.profiles_configs as product_profile on product_profile.id = profile.id
  where profile.id = actor_id
    and profile.is_active = true
    and product_profile.is_active = true;

  if actor_id is null or actor_organisation_id is null then
    raise exception 'event_request_access_denied';
  end if;

  if new.requested_pointed_at > clock_timestamp() then
    raise exception 'event_request_future_time_not_allowed';
  end if;

  new.profile_id := actor_id;
  new.organisation_id := actor_organisation_id;
  new.reason := btrim(new.reason);
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

    new.original_type := source_event.type;
    new.original_pointed_at := source_event.pointed_at;
  elsif new.request_kind = 'missing_event' then
    new.event_id := null;
    new.original_type := null;
    new.original_pointed_at := null;
  else
    raise exception 'event_request_kind_invalid';
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.prepare_event_change_request() from public;

drop trigger if exists prepare_event_change_request_before_insert on zecontrol.event_change_requests;
create trigger prepare_event_change_request_before_insert
before insert on zecontrol.event_change_requests
for each row execute function zecontrol.prepare_event_change_request();

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
  previous_type zecontrol.events_type;
  item record;
begin
  for item in
    select sequence.type
    from (
      select event.type, event.pointed_at, event.id::text as stable_order
      from zecontrol.events as event
      where event.profile_id = target_profile_id
        and event.event_status in ('accepted', 'pending')
        and (excluded_event_id is null or event.id <> excluded_event_id)
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

  if actor_id is null or not zecontrol.can_administer_organisation(request_record.organisation_id) then
    raise exception 'event_request_review_denied';
  end if;

  if review_decision = 'approved' then
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

  update zecontrol.event_change_requests
  set status = review_decision,
      reviewed_at = clock_timestamp(),
      reviewed_by = actor_id,
      decision_reason = nullif(btrim(review_note), ''),
      updated_at = clock_timestamp()
  where id = request_record.id;

  return jsonb_build_object('id', request_record.id, 'status', review_decision);
end;
$$;

revoke all on function zecontrol.review_event_change_request(uuid, text, text) from public;
grant execute on function zecontrol.review_event_change_request(uuid, text, text) to authenticated;

-- Approved request inserts are the only events allowed to bypass live clocking preparation.
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

  if actor_id is null then raise exception 'authentication_required'; end if;

  select profile.organisation_id, product_profile.policy, product_profile.can_remote
  into actor_organisation_id, actor_policy, actor_can_remote
  from public.profiles as profile
  join zecontrol.profiles_configs as product_profile on product_profile.id = profile.id
  join public.organisations as organisation on organisation.id = profile.organisation_id
  join zecontrol.orga_configs as organisation_config on organisation_config.id = organisation.id
  where profile.id = actor_id and profile.is_active = true and product_profile.is_active = true
    and organisation.status = 'active' and organisation_config.is_active = true;

  if actor_organisation_id is null then raise exception 'clocking_access_denied'; end if;

  select event.type into previous_type
  from zecontrol.events as event
  where event.profile_id = actor_id and event.event_status in ('accepted', 'pending')
  order by event.pointed_at desc, event.created_at desc limit 1;

  if not (
    (previous_type is null and new.type = 'start')
    or (previous_type = 'end' and new.type = 'start')
    or (previous_type in ('start', 'resume') and new.type in ('break', 'end'))
    or (previous_type = 'break' and new.type in ('resume', 'end'))
  ) then raise exception 'invalid_clocking_sequence'; end if;

  select config.lat::double precision, config.long::double precision, config.radius::double precision
  into organisation_lat, organisation_long, organisation_radius
  from zecontrol.orga_configs as config where config.id = actor_organisation_id;

  if organisation_lat is null or organisation_long is null or organisation_radius is null then
    if actor_can_remote or actor_policy = 'free' then distance_meters := null;
    else raise exception 'clocking_location_not_configured'; end if;
  else
    distance_meters := 6371000 * 2 * asin(sqrt(
      power(sin(radians(new.lat::double precision - organisation_lat) / 2), 2)
      + cos(radians(organisation_lat)) * cos(radians(new.lat::double precision))
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
  elsif actor_policy = 'flexible' then new.event_status := 'pending';
  else new.event_status := 'rejected'; end if;
  return new;
end;
$$;

alter table zecontrol.event_change_requests enable row level security;

create policy "zecontrol users create own event requests"
on zecontrol.event_change_requests for insert to authenticated
with check (profile_id = auth.uid() and zecontrol.can_read_organisation(organisation_id));

create policy "zecontrol users read permitted event requests"
on zecontrol.event_change_requests for select to authenticated
using (profile_id = auth.uid() or zecontrol.can_administer_organisation(organisation_id));

revoke all on zecontrol.event_change_requests from public, anon, authenticated;
grant select on zecontrol.event_change_requests to authenticated;
grant insert (request_kind, event_id, requested_type, requested_pointed_at, reason)
  on zecontrol.event_change_requests to authenticated;

comment on table zecontrol.event_change_requests is
  'Agent-submitted correction and forgotten-clocking requests, reviewed by organisation administrators.';
