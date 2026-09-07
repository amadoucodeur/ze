-- Minimal Web Push foundation for ZeControl. One global dispatcher checks only
-- subscribed agents every three minutes; the delivery ledger prevents repeats.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists zecontrol.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2048),
  p256dh text not null check (char_length(p256dh) between 16 and 512),
  auth_key text not null check (char_length(auth_key) between 8 and 512),
  expires_at timestamptz,
  user_agent text,
  last_checked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists zecontrol_push_subscriptions_profile_idx
  on zecontrol.push_subscriptions (profile_id);
create index if not exists zecontrol_push_subscriptions_check_idx
  on zecontrol.push_subscriptions (last_checked_at nulls first, profile_id);

create table if not exists zecontrol.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  work_date date not null,
  reminder_key text not null check (char_length(reminder_key) between 1 and 160),
  title text not null check (char_length(title) between 1 and 180),
  body text not null check (char_length(body) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'sent')),
  device_count integer not null default 0 check (device_count >= 0),
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (profile_id, work_date, reminder_key)
);

create index if not exists zecontrol_notification_deliveries_pending_idx
  on zecontrol.notification_deliveries (created_at)
  where status = 'pending';

alter table zecontrol.push_subscriptions enable row level security;
alter table zecontrol.notification_deliveries enable row level security;

drop policy if exists "zecontrol users read own push subscriptions"
  on zecontrol.push_subscriptions;
create policy "zecontrol users read own push subscriptions"
on zecontrol.push_subscriptions for select
to authenticated
using (profile_id = auth.uid());

drop policy if exists "zecontrol users delete own push subscriptions"
  on zecontrol.push_subscriptions;
create policy "zecontrol users delete own push subscriptions"
on zecontrol.push_subscriptions for delete
to authenticated
using (profile_id = auth.uid());

grant select, delete on zecontrol.push_subscriptions to authenticated;
revoke all on zecontrol.notification_deliveries from anon, authenticated;

comment on table zecontrol.push_subscriptions is
  'Web Push endpoints owned by ZeControl agents, one row per browser/device.';
comment on table zecontrol.notification_deliveries is
  'Small idempotency ledger for ZeControl reminder deliveries.';

-- Keep the existing user authorization while allowing the trusted dispatcher
-- to resolve policies through the service role.
create or replace function zecontrol.resolve_work_policy(
  target_profile_id uuid,
  target_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  target_organisation_id uuid;
  target_service text;
  selected_policy_id uuid;
  selected_scope text := 'organisation';
  selected_version record;
  selected_definition jsonb;
  selected_exception_id uuid;
  selected_exception_scope text;
  selected_exception_label text;
  target_weekday integer := extract(isodow from target_work_date)::integer;
begin
  select profile.organisation_id, config.service
  into target_organisation_id, target_service
  from public.profiles as profile
  join zecontrol.profiles_configs as config on config.id = profile.id
  where profile.id = target_profile_id
    and profile.is_active = true
    and config.is_active = true;

  if target_organisation_id is null then
    return null;
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and (
      auth.uid() is null
      or not zecontrol.can_read_organisation(target_organisation_id)
    )
  then
    raise exception 'work_policy_read_access_denied';
  end if;

  select candidate.policy_id, candidate.scope
  into selected_policy_id, selected_scope
  from (
    select
      assignment.policy_id,
      assignment.target_type as scope,
      (
        case assignment.target_type
          when 'profile' then 400
          when 'team' then 300
          when 'service' then 200
          else 100
        end
        + assignment.priority
      ) as resolution_priority,
      assignment.valid_from,
      assignment.created_at
    from zecontrol.work_policy_assignments as assignment
    join zecontrol.work_policies as policy on policy.id = assignment.policy_id
    where assignment.organisation_id = target_organisation_id
      and policy.is_enabled = true
      and assignment.valid_from <= target_work_date
      and (assignment.valid_until is null or assignment.valid_until >= target_work_date)
      and (
        (assignment.target_type = 'profile' and assignment.profile_id = target_profile_id)
        or (
          assignment.target_type = 'team'
          and exists (
            select 1
            from zecontrol.work_team_members as member
            join zecontrol.work_teams as team on team.id = member.team_id
            where member.team_id = assignment.team_id
              and member.profile_id = target_profile_id
              and member.is_active = true
              and team.is_active = true
          )
        )
        or (
          assignment.target_type = 'service'
          and lower(btrim(assignment.service_name)) = lower(btrim(target_service))
        )
        or assignment.target_type = 'organisation'
      )
  ) as candidate
  order by candidate.resolution_priority desc, candidate.valid_from desc, candidate.created_at desc
  limit 1;

  if selected_policy_id is null then
    select policy.id
    into selected_policy_id
    from zecontrol.work_policies as policy
    where policy.organisation_id = target_organisation_id
      and policy.is_default = true
      and policy.is_enabled = true
    order by policy.updated_at desc
    limit 1;
    selected_scope := 'organisation';
  end if;

  if selected_policy_id is null then
    return null;
  end if;

  select version.id, version.version_number, version.definition, version.effective_from
  into selected_version
  from zecontrol.work_policy_versions as version
  where version.policy_id = selected_policy_id
    and version.effective_from <= target_work_date
  order by version.effective_from desc, version.version_number desc
  limit 1;

  if selected_version.id is null then
    return null;
  end if;

  selected_definition := selected_version.definition;

  select calendar_exception.id, calendar_exception.target_type, calendar_exception.label
  into selected_exception_id, selected_exception_scope, selected_exception_label
  from zecontrol.work_calendar_exceptions as calendar_exception
  where calendar_exception.organisation_id = target_organisation_id
    and calendar_exception.work_date = target_work_date
    and (
      (calendar_exception.target_type = 'profile' and calendar_exception.profile_id = target_profile_id)
      or (
        calendar_exception.target_type = 'service'
        and lower(btrim(calendar_exception.service_name)) = lower(btrim(target_service))
      )
      or calendar_exception.target_type = 'organisation'
    )
  order by case calendar_exception.target_type when 'profile' then 3 when 'service' then 2 else 1 end desc
  limit 1;

  if selected_exception_id is not null then
    selected_definition := jsonb_set(
      selected_definition,
      '{days}',
      coalesce(
        (
          select jsonb_agg(day_value order by day_value)
          from jsonb_array_elements(selected_definition -> 'days') as day(day_value)
          where (day_value #>> '{}')::integer <> target_weekday
        ),
        '[]'::jsonb
      ),
      true
    );
  end if;

  return jsonb_build_object(
    'policyId', selected_policy_id,
    'versionId', selected_version.id,
    'version', selected_version.version_number,
    'effectiveFrom', selected_version.effective_from,
    'scope', selected_scope,
    'definition', selected_definition,
    'calendarException', case
      when selected_exception_id is null then null
      else jsonb_build_object(
        'id', selected_exception_id,
        'scope', selected_exception_scope,
        'label', selected_exception_label
      )
    end
  );
end;
$$;

revoke all on function zecontrol.resolve_work_policy(uuid, date) from public;
revoke all on function zecontrol.resolve_work_policy(uuid, date) from anon;
grant execute on function zecontrol.resolve_work_policy(uuid, date) to authenticated, service_role;

create or replace function zecontrol.notification_dispatch_contexts(
  batch_size integer default 500
)
returns table (
  profile_id uuid,
  organisation_id uuid,
  timezone text,
  work_date date,
  events jsonb,
  resolved_policy jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  safe_batch_size integer := greatest(1, least(coalesce(batch_size, 500), 1000));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'notification_dispatch_access_denied';
  end if;

  return query
  with subscribed_profiles as (
    select subscription.profile_id
    from zecontrol.push_subscriptions as subscription
    group by subscription.profile_id
    order by min(subscription.last_checked_at) nulls first
    limit safe_batch_size
  )
  select
    profile.id,
    profile.organisation_id,
    coalesce(organisation_config.timezone, 'Africa/Abidjan'),
    local_day.work_date,
    coalesce(event_data.events, '[]'::jsonb),
    zecontrol.resolve_work_policy(profile.id, local_day.work_date)
  from subscribed_profiles
  join public.profiles as profile on profile.id = subscribed_profiles.profile_id
  join public.organisations as organisation on organisation.id = profile.organisation_id
  join zecontrol.profiles_configs as product_profile on product_profile.id = profile.id
  join zecontrol.orga_configs as organisation_config on organisation_config.id = profile.organisation_id
  cross join lateral (
    select (current_timestamp at time zone coalesce(organisation_config.timezone, 'Africa/Abidjan'))::date as work_date
  ) as local_day
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'type', event.type::text,
        'event_status', event.event_status::text,
        'pointed_at', event.pointed_at
      )
      order by event.pointed_at, event.created_at
    ) as events
    from zecontrol.events as event
    where event.profile_id = profile.id
      and event.event_status in ('accepted', 'pending')
      and event.pointed_at >= (
        local_day.work_date::timestamp
        at time zone coalesce(organisation_config.timezone, 'Africa/Abidjan')
      )
      and event.pointed_at < (
        (local_day.work_date + 1)::timestamp
        at time zone coalesce(organisation_config.timezone, 'Africa/Abidjan')
      )
  ) as event_data on true
  where profile.is_active = true
    and organisation.status::text = 'active'
    and product_profile.is_active = true
    and product_profile.role::text <> 'owner'
    and organisation_config.is_active = true;
end;
$$;

revoke all on function zecontrol.notification_dispatch_contexts(integer) from public, anon, authenticated;
grant execute on function zecontrol.notification_dispatch_contexts(integer) to service_role;

-- The job safely does nothing until both Vault secrets are configured:
-- zecontrol_site_url and zecontrol_notification_dispatch_secret.
create or replace function zecontrol.invoke_notification_dispatcher()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol, extensions
as $$
declare
  site_url text;
  dispatch_secret text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into site_url
      using 'zecontrol_site_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into dispatch_secret
      using 'zecontrol_notification_dispatch_secret';
  exception when undefined_table then
    return;
  end;

  if nullif(btrim(site_url), '') is null
    or nullif(btrim(dispatch_secret), '') is null
  then
    return;
  end if;

  perform net.http_post(
    url := regexp_replace(btrim(site_url), '/+$', '') || '/api/notifications/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || btrim(dispatch_secret)
    ),
    body := jsonb_build_object('scheduled_at', clock_timestamp()),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function zecontrol.invoke_notification_dispatcher() from public, anon, authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'zecontrol-push-dispatch-every-3-minutes'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'zecontrol-push-dispatch-every-3-minutes',
    '*/3 * * * *',
    'select zecontrol.invoke_notification_dispatcher();'
  );
end;
$$;

notify pgrst, 'reload schema';
