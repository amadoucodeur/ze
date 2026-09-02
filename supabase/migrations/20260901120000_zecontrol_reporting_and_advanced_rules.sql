-- Reliable report paging, overtime approval, and enforcement of advanced rules.

create table if not exists zecontrol.overtime_approvals (
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete cascade,
  profile_id uuid not null references zecontrol.profiles_configs(id) on delete cascade,
  work_date date not null,
  status text not null check (status in ('approved', 'rejected')),
  reviewed_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key (organisation_id, profile_id, work_date)
);

alter table zecontrol.overtime_approvals enable row level security;

create policy "members read permitted overtime approvals"
on zecontrol.overtime_approvals for select to authenticated
using (
  profile_id = auth.uid()
  or zecontrol.can_administer_organisation(organisation_id)
);

create policy "managers review overtime"
on zecontrol.overtime_approvals for all to authenticated
using (zecontrol.can_administer_organisation(organisation_id))
with check (
  zecontrol.can_administer_organisation(organisation_id)
  and reviewed_by = auth.uid()
  and exists (
    select 1 from public.profiles profile
    where profile.id = profile_id
      and profile.organisation_id = organisation_id
      and profile.is_active = true
  )
);

revoke all on zecontrol.overtime_approvals from public, anon, authenticated;
grant select, insert, update (status, reviewed_by, reviewed_at)
  on zecontrol.overtime_approvals to authenticated;

create or replace function zecontrol.review_overtime(
  target_profile_id uuid,
  target_work_date date,
  review_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare target_organisation_id uuid;
begin
  if review_status not in ('approved', 'rejected') then
    raise exception 'invalid_overtime_review';
  end if;
  select profile.organisation_id into target_organisation_id
  from public.profiles profile
  join zecontrol.profiles_configs config on config.id = profile.id and config.is_active = true
  where profile.id = target_profile_id and profile.is_active = true;
  if target_organisation_id is null
    or not zecontrol.can_administer_organisation(target_organisation_id) then
    raise exception 'overtime_review_access_denied';
  end if;
  insert into zecontrol.overtime_approvals (
    organisation_id, profile_id, work_date, status, reviewed_by, reviewed_at
  ) values (
    target_organisation_id, target_profile_id, target_work_date, review_status, auth.uid(), clock_timestamp()
  )
  on conflict (organisation_id, profile_id, work_date) do update
  set status = excluded.status,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at;
end;
$$;

revoke all on function zecontrol.review_overtime(uuid, date, text) from public, anon;
grant execute on function zecontrol.review_overtime(uuid, date, text) to authenticated;

create or replace function zecontrol.list_report_event_days(
  target_organisation_id uuid,
  target_profile_id uuid,
  range_start timestamptz,
  range_end timestamptz,
  page_offset integer,
  page_limit integer
)
returns table (profile_id uuid, work_date date, event_data jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  organisation_timezone text;
begin
  if auth.uid() is null
    or not (
      zecontrol.can_administer_organisation(target_organisation_id)
      or (
        target_profile_id = auth.uid()
        and zecontrol.can_read_organisation(target_organisation_id)
      )
    ) then
    raise exception 'report_access_denied';
  end if;

  if page_offset is null or page_limit is null
    or page_offset < 0 or page_limit < 1 or page_limit > 500 then
    raise exception 'invalid_report_page';
  end if;

  select coalesce(config.timezone, 'Africa/Abidjan')
  into organisation_timezone
  from zecontrol.orga_configs config
  where config.id = target_organisation_id;

  return query
  select
    event.profile_id,
    (event.pointed_at at time zone organisation_timezone)::date,
    jsonb_agg(
      jsonb_build_object(
        'id', event.id,
        'type', event.type,
        'event_status', event.event_status,
        'pointed_at', event.pointed_at,
        'profile_id', event.profile_id,
        'organisation_id', event.organisation_id
      ) order by event.pointed_at, event.created_at
    )
  from zecontrol.events event
  where event.organisation_id = target_organisation_id
    and (target_profile_id is null or event.profile_id = target_profile_id)
    and (range_start is null or event.pointed_at >= range_start)
    and (range_end is null or event.pointed_at < range_end)
  group by event.profile_id, (event.pointed_at at time zone organisation_timezone)::date
  order by (event.pointed_at at time zone organisation_timezone)::date desc, event.profile_id
  offset page_offset
  limit page_limit;
end;
$$;

revoke all on function zecontrol.list_report_event_days(uuid, uuid, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function zecontrol.list_report_event_days(uuid, uuid, timestamptz, timestamptz, integer, integer) to authenticated;

create or replace function zecontrol.enforce_minimum_rest()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  resolved_policy jsonb;
  required_minutes integer;
  previous_end timestamptz;
begin
  if new.type <> 'start' or new.event_status = 'rejected' then
    return new;
  end if;

  resolved_policy := zecontrol.resolve_work_policy(
    new.profile_id,
    (new.pointed_at at time zone coalesce(
      (select config.timezone from zecontrol.orga_configs config where config.id = new.organisation_id),
      'Africa/Abidjan'
    ))::date
  );
  required_minutes := greatest(0, coalesce((resolved_policy -> 'definition' ->> 'minimumRestMinutes')::integer, 0));
  if required_minutes = 0 then return new; end if;

  select event.pointed_at into previous_end
  from zecontrol.events event
  where event.profile_id = new.profile_id
    and event.type = 'end'
    and event.event_status in ('accepted', 'pending')
    and event.pointed_at < new.pointed_at
  order by event.pointed_at desc
  limit 1;

  if previous_end is not null
    and new.pointed_at - previous_end < make_interval(mins => required_minutes) then
    raise exception 'minimum_rest_not_reached';
  end if;
  return new;
end;
$$;

revoke all on function zecontrol.enforce_minimum_rest() from public, anon;
drop trigger if exists zz_enforce_minimum_rest_before_insert on zecontrol.events;
create trigger zz_enforce_minimum_rest_before_insert
before insert on zecontrol.events
for each row execute function zecontrol.enforce_minimum_rest();
