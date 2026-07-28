-- A ZeSuite identity can exist for ZeControl without consuming a ZeRecruit
-- seat or receiving recruitment permissions. Existing profiles predate this
-- distinction and therefore keep their current ZeRecruit access.

alter table public.profiles
  add column if not exists zerecruit_access boolean;

update public.profiles
set zerecruit_access = true
where zerecruit_access is null;

-- Collaborators explicitly created from ZeControl already existed before the
-- access flag. They must not inherit ZeRecruit access during the backfill.
update public.profiles
set zerecruit_access = false
where meta_data ->> 'created_product' = 'zecontrol';

alter table public.profiles
  alter column zerecruit_access set default false,
  alter column zerecruit_access set not null;

create index if not exists profiles_zerecruit_team_idx
  on public.profiles (organisation_id, is_active, created_at)
  where zerecruit_access = true;

comment on column public.profiles.zerecruit_access is
  'Product access flag for ZeRecruit. ZeControl access remains in zecontrol.profiles_configs.';

create or replace function public.enforce_profile_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seat_limit integer;
  seat_count integer;
begin
  if new.organisation_id is null
    or not new.is_active
    or not new.zerecruit_access
  then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.organisation_id is not distinct from new.organisation_id
    and old.is_active
    and old.zerecruit_access
  then
    return new;
  end if;

  perform 1
  from public.organisations
  where id = new.organisation_id
  for update;

  if not public.organisation_plan_access_active(new.organisation_id) then
    raise exception using errcode = 'P0001', message = 'plan_access_inactive';
  end if;

  seat_limit := public.organisation_plan_limit(new.organisation_id, 'seats');
  if seat_limit is null then
    return new;
  end if;

  select count(*)
  into seat_count
  from public.profiles as profile
  where profile.organisation_id = new.organisation_id
    and profile.is_active = true
    and profile.zerecruit_access = true
    and profile.id <> new.id;

  if seat_count >= seat_limit then
    raise exception using errcode = 'P0001', message = 'plan_seat_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_plan_seat_guard on public.profiles;
create trigger profiles_plan_seat_guard
before insert or update of organisation_id, is_active, zerecruit_access
on public.profiles
for each row execute function public.enforce_profile_seat_limit();

create or replace function public.current_active_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profile.organisation_id
  from public.profiles as profile
  join public.organisations as organisation
    on organisation.id = profile.organisation_id
  where profile.id = auth.uid()
    and profile.is_active = true
    and profile.zerecruit_access = true
    and organisation.status = 'active'
  limit 1;
$$;

create or replace function public.can_manage_recruitment()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.organisations as organisation
      on organisation.id = profile.organisation_id
    where profile.id = auth.uid()
      and profile.is_active = true
      and profile.zerecruit_access = true
      and organisation.status = 'active'
      and public.organisation_plan_access_active(organisation.id)
      and profile.role::text in ('owner', 'admin', 'recruiter')
  );
$$;

create or replace function public.can_manage_talent_collections()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.organisations as organisation
      on organisation.id = profile.organisation_id
    where profile.id = auth.uid()
      and profile.is_active = true
      and profile.zerecruit_access = true
      and organisation.status = 'active'
      and public.organisation_plan_feature_enabled(
        organisation.id,
        'collections'
      )
      and profile.role::text in ('owner', 'admin', 'recruiter')
  );
$$;

revoke all on function public.current_active_organisation_id() from public;
revoke all on function public.can_manage_recruitment() from public;
revoke all on function public.can_manage_talent_collections() from public;
grant execute on function public.current_active_organisation_id() to authenticated;
grant execute on function public.can_manage_recruitment() to authenticated;
grant execute on function public.can_manage_talent_collections() to authenticated;

notify pgrst, 'reload schema';
