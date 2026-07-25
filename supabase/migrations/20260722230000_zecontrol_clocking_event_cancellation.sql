-- Allow a user to cancel only their latest clocking event within 30 seconds.

create or replace function zecontrol.cancel_own_clocking_event(target_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  target_event zecontrol.events%rowtype;
  latest_event_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required';
  end if;

  select event.*
  into target_event
  from zecontrol.events as event
  where event.id = target_event_id
    and event.profile_id = actor_id
  for update;

  if not found or target_event.event_status not in ('accepted', 'pending') then
    raise exception 'clocking_cancellation_not_allowed';
  end if;

  if clock_timestamp() > target_event.pointed_at + interval '30 seconds' then
    raise exception 'clocking_cancellation_window_expired';
  end if;

  select event.id
  into latest_event_id
  from zecontrol.events as event
  where event.profile_id = actor_id
    and event.event_status in ('accepted', 'pending')
  order by event.pointed_at desc, event.created_at desc
  limit 1;

  if latest_event_id is distinct from target_event.id then
    raise exception 'clocking_cancellation_requires_latest_event';
  end if;

  update zecontrol.events
  set event_status = 'cancelled',
      updated_at = clock_timestamp(),
      reviewed_at = null,
      reviewed_by = null,
      review_reason = null
  where id = target_event.id;

  return jsonb_build_object(
    'id', target_event.id,
    'event_status', 'cancelled'
  );
end;
$$;

revoke all on function zecontrol.cancel_own_clocking_event(uuid) from public;
grant execute on function zecontrol.cancel_own_clocking_event(uuid) to authenticated;

comment on function zecontrol.cancel_own_clocking_event(uuid) is
  'Cancels the authenticated user latest accepted or pending clocking event within a server-enforced 30-second window.';
