-- Enforce ZeRecruit plan promises in the database, including client-side RLS
-- writes. Service-backed AI usage is metered through trusted RPCs.

create or replace function public.organisation_plan_access_active(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select organisation.status = 'active'
      and coalesce(organisation.billing_status, 'active') not in ('expired', 'suspended')
      and case
        when organisation.plan = 'free' then organisation.trial_ends_at is not null and organisation.trial_ends_at > now()
        when organisation.plan in ('essential', 'team') then organisation.plan_expires_at is null or organisation.plan_expires_at > now()
        else organisation.plan = 'scale'
      end
    from public.organisations as organisation
    where organisation.id = target_organisation_id
  ), false);
$$;

create or replace function public.organisation_plan_feature_enabled(target_organisation_id uuid, target_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.organisation_plan_access_active(target_organisation_id)
    and coalesce((
      select case target_feature
        when 'semantic_search' then organisation.plan in ('free', 'essential', 'team', 'scale')
        when 'collections' then organisation.plan in ('essential', 'team', 'scale')
        when 'interview_guides' then organisation.plan in ('essential', 'team', 'scale')
        when 'team_management' then organisation.plan in ('team', 'scale')
        else false
      end
      from public.organisations as organisation
      where organisation.id = target_organisation_id
    ), false);
$$;

create or replace function public.organisation_plan_limit(target_organisation_id uuid, target_resource text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case target_resource
    when 'seats' then case organisation.plan when 'free' then 1 when 'essential' then 1 when 'team' then 8 else null end
    when 'candidates' then case organisation.plan when 'free' then 100 when 'essential' then 1000 when 'team' then 10000 else null end
    when 'active_offers' then case organisation.plan when 'free' then 1 else null end
    when 'offer_matching' then case organisation.plan when 'free' then 3 else null end
    else null
  end
  from public.organisations as organisation
  where organisation.id = target_organisation_id;
$$;

revoke all on function public.organisation_plan_access_active(uuid) from public, anon;
revoke all on function public.organisation_plan_feature_enabled(uuid, text) from public, anon;
revoke all on function public.organisation_plan_limit(uuid, text) from public, anon;
grant execute on function public.organisation_plan_access_active(uuid) to authenticated, service_role;
grant execute on function public.organisation_plan_feature_enabled(uuid, text) to authenticated, service_role;
grant execute on function public.organisation_plan_limit(uuid, text) to authenticated, service_role;

create table if not exists public.plan_usage_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  metric text not null check (metric in ('offer_matching')),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (period_ends_at > period_starts_at)
);

create index if not exists plan_usage_events_lookup_idx
  on public.plan_usage_events (organisation_id, metric, period_starts_at, period_ends_at, created_at);

alter table public.plan_usage_events enable row level security;
revoke all on public.plan_usage_events from public, anon, authenticated;
grant select, insert, delete on public.plan_usage_events to service_role;

create or replace function public.consume_plan_usage(
  target_organisation_id uuid,
  target_metric text,
  target_context jsonb default '{}'::jsonb
)
returns table(allowed boolean, event_id uuid, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  organisation_record public.organisations%rowtype;
  usage_limit integer;
  usage_count integer;
  usage_period_start timestamptz;
  usage_period_end timestamptz;
  inserted_event_id uuid;
begin
  if target_metric <> 'offer_matching' then
    raise exception using errcode = 'P0001', message = 'plan_usage_metric_invalid';
  end if;

  select * into organisation_record
  from public.organisations
  where id = target_organisation_id
  for update;

  if organisation_record.id is null or not public.organisation_plan_access_active(target_organisation_id) then
    return query select false, null::uuid, 0;
    return;
  end if;

  usage_limit := public.organisation_plan_limit(target_organisation_id, target_metric);
  if usage_limit is null then
    return query select true, null::uuid, null::integer;
    return;
  end if;

  usage_period_start := case
    when organisation_record.plan = 'free' then coalesce(organisation_record.trial_ends_at - interval '1 month', organisation_record.created_at)
    else coalesce(organisation_record.plan_updated_at, organisation_record.created_at)
  end;
  usage_period_end := case
    when organisation_record.plan = 'free' then organisation_record.trial_ends_at
    else organisation_record.plan_expires_at
  end;

  select count(*) into usage_count
  from public.plan_usage_events as usage_event
  where usage_event.organisation_id = target_organisation_id
    and usage_event.metric = target_metric
    and usage_event.period_starts_at = usage_period_start
    and usage_event.period_ends_at = usage_period_end;

  if usage_count >= usage_limit then
    return query select false, null::uuid, 0;
    return;
  end if;

  insert into public.plan_usage_events (organisation_id, metric, context, period_starts_at, period_ends_at)
  values (target_organisation_id, target_metric, coalesce(target_context, '{}'::jsonb), usage_period_start, usage_period_end)
  returning id into inserted_event_id;

  return query select true, inserted_event_id, greatest(0, usage_limit - usage_count - 1);
end;
$$;

create or replace function public.release_plan_usage(target_event_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.plan_usage_events where id = target_event_id;
$$;

revoke all on function public.consume_plan_usage(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.release_plan_usage(uuid) from public, anon, authenticated;
grant execute on function public.consume_plan_usage(uuid, text, jsonb) to service_role;
grant execute on function public.release_plan_usage(uuid) to service_role;

create or replace function public.enforce_candidate_plan_entitlements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_limit integer;
  candidate_count integer;
begin
  if new.archived_at is not null or (tg_op = 'UPDATE' and old.archived_at is null) then
    return new;
  end if;

  perform 1 from public.organisations where id = new.organisation_id for update;
  if not public.organisation_plan_access_active(new.organisation_id) then
    raise exception using errcode = 'P0001', message = 'plan_access_inactive';
  end if;

  candidate_limit := public.organisation_plan_limit(new.organisation_id, 'candidates');
  if candidate_limit is null then return new; end if;

  select count(*) into candidate_count
  from public.candidats as candidate
  where candidate.organisation_id = new.organisation_id
    and candidate.archived_at is null
    and candidate.id <> new.id;
  if candidate_count >= candidate_limit then
    raise exception using errcode = 'P0001', message = 'plan_candidate_limit_reached';
  end if;
  return new;
end;
$$;

drop trigger if exists candidats_plan_entitlements_guard on public.candidats;
create trigger candidats_plan_entitlements_guard
before insert or update of archived_at on public.candidats
for each row execute function public.enforce_candidate_plan_entitlements();

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
  if new.organisation_id is null or not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.organisation_id is not distinct from new.organisation_id and old.is_active then return new; end if;

  perform 1 from public.organisations where id = new.organisation_id for update;
  if not public.organisation_plan_access_active(new.organisation_id) then
    raise exception using errcode = 'P0001', message = 'plan_access_inactive';
  end if;
  seat_limit := public.organisation_plan_limit(new.organisation_id, 'seats');
  if seat_limit is null then return new; end if;

  select count(*) into seat_count
  from public.profiles as profile
  where profile.organisation_id = new.organisation_id
    and profile.is_active = true
    and profile.id <> new.id;
  if seat_count >= seat_limit then
    raise exception using errcode = 'P0001', message = 'plan_seat_limit_reached';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_plan_seat_guard on public.profiles;
create trigger profiles_plan_seat_guard
before insert or update of organisation_id, is_active on public.profiles
for each row execute function public.enforce_profile_seat_limit();

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
    join public.organisations as organisation on organisation.id = profile.organisation_id
    where profile.id = auth.uid()
      and profile.is_active = true
      and organisation.status = 'active'
      and public.organisation_plan_access_active(organisation.id)
      and profile.role::text in ('owner', 'admin', 'recruiter')
  );
$$;

create or replace function public.prepare_offer_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
  active_offer_limit integer;
  active_offer_count integer;
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null or not public.can_manage_recruitment() then
    raise exception using errcode = 'P0001', message = 'plan_access_inactive';
  end if;

  new.organisation_id := member_organisation_id;
  new.title := trim(new.title);
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if new.status <> 'closed' and (tg_op = 'INSERT' or old.status = 'closed') then
    perform 1 from public.organisations where id = member_organisation_id for update;
    active_offer_limit := public.organisation_plan_limit(member_organisation_id, 'active_offers');
    if active_offer_limit is not null then
      select count(*) into active_offer_count
      from public.offres as offer
      where offer.organisation_id = member_organisation_id
        and offer.status <> 'closed'
        and offer.id <> new.id;
      if active_offer_count >= active_offer_limit then
        raise exception using errcode = 'P0001', message = 'plan_active_offer_limit_reached';
      end if;
    end if;
  end if;
  return new;
end;
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
    join public.organisations as organisation on organisation.id = profile.organisation_id
    where profile.id = auth.uid()
      and profile.is_active = true
      and organisation.status = 'active'
      and public.organisation_plan_feature_enabled(organisation.id, 'collections')
      and profile.role::text in ('owner', 'admin', 'recruiter')
  );
$$;

create or replace function public.prepare_interview_question_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
  application_organisation_id uuid;
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null or not public.can_manage_recruitment() then
    raise exception using errcode = 'P0001', message = 'plan_access_inactive';
  end if;
  if not public.organisation_plan_feature_enabled(member_organisation_id, 'interview_guides') then
    raise exception using errcode = 'P0001', message = 'plan_interview_guides_unavailable';
  end if;

  if tg_op = 'UPDATE' then
    new.candidature_id := old.candidature_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  select organisation_id into application_organisation_id from public.candidatures where id = new.candidature_id;
  if application_organisation_id is distinct from member_organisation_id then
    raise exception 'interview question must belong to the active organisation';
  end if;

  new.organisation_id := member_organisation_id;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if new.candidate_answer is not null and char_length(trim(new.candidate_answer)) > 0 then
    new.answered_at := coalesce(new.answered_at, now());
  end if;
  return new;
end;
$$;

comment on table public.plan_usage_events is
  'Trusted metering ledger for plan-limited product actions; never writable from the browser.';
comment on function public.consume_plan_usage(uuid, text, jsonb) is
  'Atomically reserves one metered action inside the organisation billing period.';
