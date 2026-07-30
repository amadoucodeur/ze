-- A ZeControl owner manages the product but is not an attendance subject.
-- Existing owner events are preserved for audit, while owners disappear from
-- operational directories and cannot create new clocking data.

drop function if exists zecontrol.list_report_profiles(uuid);

create function zecontrol.list_report_profiles(
  target_organisation_id uuid
)
returns table (
  id uuid,
  fullname text,
  identifiant text,
  role text,
  is_active boolean,
  activated_at timestamptz,
  poste text,
  service text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_profile.id,
    target_profile.fullname,
    target_profile.identifiant,
    target_config.role::text,
    target_config.is_active,
    target_config.created_at,
    target_config.poste,
    target_config.service
  from public.profiles as target_profile
  join zecontrol.profiles_configs as target_config
    on target_config.id = target_profile.id
  where target_profile.organisation_id = target_organisation_id
    and target_profile.is_active = true
    and target_config.is_active = true
    and target_config.role <> 'owner'
    and exists (
      select 1
      from public.profiles as actor_profile
      join zecontrol.profiles_configs as actor_config
        on actor_config.id = actor_profile.id
      where actor_profile.id = auth.uid()
        and actor_profile.organisation_id = target_organisation_id
        and actor_profile.is_active = true
        and actor_config.is_active = true
        and actor_config.role in ('owner', 'admin')
    )
  order by target_profile.fullname, target_profile.id;
$$;

revoke all on function zecontrol.list_report_profiles(uuid)
from public, anon, authenticated;

grant usage on schema zecontrol to authenticated;
grant execute on function zecontrol.list_report_profiles(uuid)
to authenticated;

create or replace function zecontrol.is_clocking_subject(
  target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from zecontrol.profiles_configs as config
    where config.id = target_profile_id
      and config.is_active = true
      and config.role <> 'owner'
  );
$$;

revoke all on function zecontrol.is_clocking_subject(uuid)
from public, anon;

grant execute on function zecontrol.is_clocking_subject(uuid)
to authenticated;

create or replace function zecontrol.reject_owner_clocking_subject()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
begin
  if not zecontrol.is_clocking_subject(new.profile_id) then
    raise exception 'owner_is_not_a_clocking_subject';
  end if;

  return new;
end;
$$;

revoke all on function zecontrol.reject_owner_clocking_subject() from public;

drop trigger if exists zy_reject_owner_clocking_subject_before_insert
on zecontrol.events;

create trigger zy_reject_owner_clocking_subject_before_insert
before insert on zecontrol.events
for each row execute function zecontrol.reject_owner_clocking_subject();

drop trigger if exists zy_reject_owner_event_request_before_insert
on zecontrol.event_change_requests;

create trigger zy_reject_owner_event_request_before_insert
before insert on zecontrol.event_change_requests
for each row execute function zecontrol.reject_owner_clocking_subject();

drop policy if exists "zecontrol users create own events"
on zecontrol.events;

create policy "zecontrol users create own events"
on zecontrol.events for insert
to authenticated
with check (
  profile_id = auth.uid()
  and zecontrol.can_read_organisation(organisation_id)
  and zecontrol.is_clocking_subject(auth.uid())
);

drop policy if exists "zecontrol users create own event requests"
on zecontrol.event_change_requests;

create policy "zecontrol users create own event requests"
on zecontrol.event_change_requests for insert
to authenticated
with check (
  profile_id = auth.uid()
  and zecontrol.can_read_organisation(organisation_id)
  and zecontrol.is_clocking_subject(auth.uid())
);

notify pgrst, 'reload schema';
