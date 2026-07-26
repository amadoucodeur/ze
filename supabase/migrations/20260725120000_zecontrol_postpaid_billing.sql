-- ZeControl postpaid billing.
--
-- A collaborator is charged once in the billing period in which a valid
-- clocking event is accepted. The business timestamp (pointed_at) never chooses
-- the billing period: an approved backdated event is therefore consumed in the
-- period in which it is approved.

create table if not exists zecontrol.billing_price_versions (
  id uuid primary key default gen_random_uuid(),
  unit_price integer not null check (unit_price > 0),
  currency text not null default 'XOF' check (currency = 'XOF'),
  minimum_invoice_amount integer not null default 0 check (minimum_invoice_amount >= 0),
  payment_terms_days integer not null default 7 check (payment_terms_days between 0 and 60),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_price_versions_dates_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists billing_price_versions_one_current_idx
  on zecontrol.billing_price_versions ((effective_to is null))
  where effective_to is null;

insert into zecontrol.billing_price_versions (
  unit_price,
  currency,
  minimum_invoice_amount,
  payment_terms_days
)
select 300, 'XOF', 0, 7
where not exists (
  select 1
  from zecontrol.billing_price_versions
  where effective_to is null
);

create table if not exists zecontrol.billing_accounts (
  organisation_id uuid primary key references zecontrol.orga_configs(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'suspended')),
  current_price_version_id uuid not null
    references zecontrol.billing_price_versions(id) on delete restrict,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists zecontrol.billing_periods (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete restrict,
  price_version_id uuid not null references zecontrol.billing_price_versions(id) on delete restrict,
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null,
  unit_price integer not null check (unit_price > 0),
  currency text not null default 'XOF' check (currency = 'XOF'),
  minimum_invoice_amount integer not null default 0 check (minimum_invoice_amount >= 0),
  payment_terms_days integer not null check (payment_terms_days between 0 and 60),
  billable_user_count integer not null default 0 check (billable_user_count >= 0),
  amount_due integer not null default 0 check (amount_due >= 0),
  status text not null default 'open'
    check (status in ('open', 'closed', 'overdue', 'paid', 'void')),
  closed_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_period_dates_check check (period_ends_at > period_starts_at),
  unique (organisation_id, period_starts_at)
);

create index if not exists billing_periods_organisation_dates_idx
  on zecontrol.billing_periods (organisation_id, period_starts_at desc);
create index if not exists billing_periods_due_idx
  on zecontrol.billing_periods (status, due_at)
  where status in ('closed', 'overdue');

create table if not exists zecontrol.billing_event_qualifications (
  event_id uuid primary key references zecontrol.events(id) on delete restrict,
  period_id uuid not null references zecontrol.billing_periods(id) on delete restrict,
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete restrict,
  profile_id uuid not null references zecontrol.profiles_configs(id) on delete restrict,
  qualified_at timestamptz not null default now(),
  source_kind text not null,
  source_pointed_at timestamptz not null
);

create index if not exists billing_event_qualifications_period_profile_idx
  on zecontrol.billing_event_qualifications (period_id, profile_id, qualified_at);

create table if not exists zecontrol.billing_usage (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references zecontrol.billing_periods(id) on delete restrict,
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete restrict,
  profile_id uuid not null references zecontrol.profiles_configs(id) on delete restrict,
  first_event_id uuid references zecontrol.events(id) on delete set null,
  first_qualified_at timestamptz not null,
  source_pointed_at timestamptz not null,
  source_kind text not null,
  unit_price integer not null check (unit_price > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, profile_id)
);

create index if not exists billing_usage_organisation_period_idx
  on zecontrol.billing_usage (organisation_id, period_id, first_qualified_at);

create table if not exists zecontrol.billing_payments (
  id uuid primary key default gen_random_uuid(),
  internal_reference uuid not null default gen_random_uuid() unique,
  organisation_id uuid not null references zecontrol.orga_configs(id) on delete restrict,
  period_id uuid not null references zecontrol.billing_periods(id) on delete restrict,
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  provider text not null default 'paydunya' check (provider = 'paydunya'),
  provider_token text unique,
  amount integer not null check (amount > 0),
  currency text not null default 'XOF' check (currency = 'XOF'),
  status text not null default 'initiated'
    check (status in ('initiated', 'pending', 'completed', 'cancelled', 'failed', 'error')),
  checkout_url text,
  receipt_url text,
  provider_response_code text,
  provider_response_text text,
  provider_status text,
  paid_at timestamptz,
  last_verified_at timestamptz,
  payload_fingerprint text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zecontrol_billing_payments_organisation_created_idx
  on zecontrol.billing_payments (organisation_id, created_at desc);
create index if not exists zecontrol_billing_payments_period_status_idx
  on zecontrol.billing_payments (period_id, status, created_at desc);

create or replace function zecontrol.ensure_current_billing_period(
  target_organisation_id uuid,
  reference_time timestamptz default clock_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  organisation_timezone text;
  local_period_start timestamp;
  period_start timestamptz;
  period_end timestamptz;
  price_record zecontrol.billing_price_versions%rowtype;
  target_period_id uuid;
begin
  select coalesce(
    to_jsonb(config) ->> 'timezone',
    'Africa/Abidjan'
  )
  into organisation_timezone
  from zecontrol.orga_configs as config
  where config.id = target_organisation_id
    and config.is_active = true;

  if organisation_timezone is null then
    raise exception 'zecontrol_billing_organisation_unavailable';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = organisation_timezone
  ) then
    organisation_timezone := 'Africa/Abidjan';
  end if;

  select price.*
  into price_record
  from zecontrol.billing_price_versions as price
  where price.effective_from <= reference_time
    and (price.effective_to is null or price.effective_to > reference_time)
  order by price.effective_from desc
  limit 1;

  if price_record.id is null then
    raise exception 'zecontrol_billing_price_unavailable';
  end if;

  insert into zecontrol.billing_accounts (
    organisation_id,
    current_price_version_id
  ) values (
    target_organisation_id,
    price_record.id
  )
  on conflict (organisation_id) do update
  set current_price_version_id = excluded.current_price_version_id,
      updated_at = clock_timestamp()
  where zecontrol.billing_accounts.status <> 'suspended';

  local_period_start := date_trunc(
    'month',
    reference_time at time zone organisation_timezone
  );
  period_start := local_period_start at time zone organisation_timezone;
  period_end := (local_period_start + interval '1 month') at time zone organisation_timezone;

  insert into zecontrol.billing_periods (
    organisation_id,
    price_version_id,
    period_starts_at,
    period_ends_at,
    unit_price,
    currency,
    minimum_invoice_amount,
    payment_terms_days
  ) values (
    target_organisation_id,
    price_record.id,
    period_start,
    period_end,
    price_record.unit_price,
    price_record.currency,
    price_record.minimum_invoice_amount,
    price_record.payment_terms_days
  )
  on conflict (organisation_id, period_starts_at) do nothing;

  select period.id
  into target_period_id
  from zecontrol.billing_periods as period
  where period.organisation_id = target_organisation_id
    and period.period_starts_at = period_start;

  return target_period_id;
end;
$$;

create or replace function zecontrol.refresh_billing_state(
  target_organisation_id uuid,
  reference_time timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
begin
  update zecontrol.billing_periods as period
  set status = 'closed',
      closed_at = coalesce(period.closed_at, reference_time),
      due_at = coalesce(
        period.due_at,
        period.period_ends_at + period.payment_terms_days * interval '1 day'
      ),
      updated_at = reference_time
  where period.organisation_id = target_organisation_id
    and period.status = 'open'
    and period.period_ends_at <= reference_time;

  update zecontrol.billing_periods as period
  set status = 'overdue',
      updated_at = reference_time
  where period.organisation_id = target_organisation_id
    and period.status = 'closed'
    and period.amount_due > 0
    and period.due_at < reference_time;

  update zecontrol.billing_accounts as account
  set status = case
        when exists (
          select 1
          from zecontrol.billing_periods as period
          where period.organisation_id = target_organisation_id
            and period.status = 'overdue'
            and period.amount_due > 0
        ) then 'past_due'
        else 'active'
      end,
      updated_at = reference_time
  where account.organisation_id = target_organisation_id
    and account.status <> 'suspended';
end;
$$;

create or replace function zecontrol.recalculate_billing_period(
  target_period_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  usage_count integer;
begin
  select count(*)::integer
  into usage_count
  from zecontrol.billing_usage as usage
  where usage.period_id = target_period_id;

  update zecontrol.billing_periods as period
  set billable_user_count = usage_count,
      amount_due = case
        when usage_count = 0 then 0
        else greatest(usage_count * period.unit_price, period.minimum_invoice_amount)
      end,
      updated_at = clock_timestamp()
  where period.id = target_period_id
    and period.status <> 'paid';
end;
$$;

create or replace function zecontrol.capture_event_billing_usage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  target_period_id uuid;
  target_period zecontrol.billing_periods%rowtype;
  account_status text;
  captured_at timestamptz := clock_timestamp();
begin
  if new.event_status <> 'accepted' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.event_status = 'accepted' then
    return new;
  end if;

  perform zecontrol.refresh_billing_state(new.organisation_id, captured_at);

  select account.status
  into account_status
  from zecontrol.billing_accounts as account
  where account.organisation_id = new.organisation_id;

  if account_status in ('past_due', 'suspended') then
    raise exception 'zecontrol_billing_access_suspended';
  end if;

  target_period_id := zecontrol.ensure_current_billing_period(
    new.organisation_id,
    captured_at
  );

  select period.*
  into target_period
  from zecontrol.billing_periods as period
  where period.id = target_period_id
  for update;

  if target_period.status <> 'open' then
    raise exception 'zecontrol_billing_period_not_open';
  end if;

  insert into zecontrol.billing_event_qualifications (
    event_id,
    period_id,
    organisation_id,
    profile_id,
    qualified_at,
    source_kind,
    source_pointed_at
  ) values (
    new.id,
    target_period.id,
    new.organisation_id,
    new.profile_id,
    captured_at,
    coalesce(new.entry_source, 'live'),
    new.pointed_at
  )
  on conflict (event_id) do nothing;

  insert into zecontrol.billing_usage (
    period_id,
    organisation_id,
    profile_id,
    first_event_id,
    first_qualified_at,
    source_pointed_at,
    source_kind,
    unit_price
  ) values (
    target_period.id,
    new.organisation_id,
    new.profile_id,
    new.id,
    captured_at,
    new.pointed_at,
    coalesce(new.entry_source, 'live'),
    target_period.unit_price
  )
  on conflict (period_id, profile_id) do nothing;

  perform zecontrol.recalculate_billing_period(target_period.id);
  return new;
end;
$$;

create or replace function zecontrol.reconcile_cancelled_event_billing()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  target_period_id uuid;
  target_profile_id uuid;
  replacement zecontrol.billing_event_qualifications%rowtype;
begin
  if old.event_status <> 'accepted' or new.event_status = 'accepted' then
    return new;
  end if;

  delete from zecontrol.billing_event_qualifications as qualification
  using zecontrol.billing_periods as period
  where qualification.event_id = new.id
    and period.id = qualification.period_id
    and period.status in ('open', 'closed', 'overdue')
    and not exists (
      select 1
      from zecontrol.billing_payments as payment
      where payment.period_id = period.id
        and payment.status in ('pending', 'completed')
    )
  returning qualification.period_id, qualification.profile_id
  into target_period_id, target_profile_id;

  if target_period_id is null then
    return new;
  end if;

  select qualification.*
  into replacement
  from zecontrol.billing_event_qualifications as qualification
  where qualification.period_id = target_period_id
    and qualification.profile_id = target_profile_id
  order by qualification.qualified_at, qualification.event_id
  limit 1;

  if replacement.event_id is null then
    delete from zecontrol.billing_usage
    where period_id = target_period_id
      and profile_id = target_profile_id;
  else
    update zecontrol.billing_usage
    set first_event_id = replacement.event_id,
        first_qualified_at = replacement.qualified_at,
        source_pointed_at = replacement.source_pointed_at,
        source_kind = replacement.source_kind,
        updated_at = clock_timestamp()
    where period_id = target_period_id
      and profile_id = target_profile_id;
  end if;

  perform zecontrol.recalculate_billing_period(target_period_id);
  return new;
end;
$$;

drop trigger if exists capture_event_billing_usage_after_insert on zecontrol.events;
create trigger capture_event_billing_usage_after_insert
after insert on zecontrol.events
for each row execute function zecontrol.capture_event_billing_usage();

drop trigger if exists capture_event_billing_usage_after_acceptance on zecontrol.events;
create trigger capture_event_billing_usage_after_acceptance
after update of event_status on zecontrol.events
for each row
when (new.event_status = 'accepted' and old.event_status is distinct from 'accepted')
execute function zecontrol.capture_event_billing_usage();

drop trigger if exists reconcile_cancelled_event_billing_after_update on zecontrol.events;
create trigger reconcile_cancelled_event_billing_after_update
after update of event_status on zecontrol.events
for each row
when (old.event_status = 'accepted' and new.event_status is distinct from 'accepted')
execute function zecontrol.reconcile_cancelled_event_billing();

create or replace function zecontrol.finalize_due_billing_periods(
  target_organisation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
begin
  perform zecontrol.ensure_current_billing_period(
    target_organisation_id,
    clock_timestamp()
  );
  perform zecontrol.refresh_billing_state(
    target_organisation_id,
    clock_timestamp()
  );
end;
$$;

create or replace function zecontrol.apply_completed_paydunya_payment(
  target_token text,
  confirmed_amount integer,
  confirmed_receipt_url text default null,
  confirmed_payload_fingerprint text default null
)
returns table(payment_id uuid, period_id uuid, applied boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  payment_record zecontrol.billing_payments%rowtype;
  period_record zecontrol.billing_periods%rowtype;
begin
  select payment.*
  into payment_record
  from zecontrol.billing_payments as payment
  where payment.provider = 'paydunya'
    and payment.provider_token = target_token
  for update;

  if payment_record.id is null then
    raise exception 'zecontrol_billing_payment_not_found';
  end if;
  if payment_record.amount <> confirmed_amount then
    raise exception 'zecontrol_billing_amount_mismatch';
  end if;

  select period.*
  into period_record
  from zecontrol.billing_periods as period
  where period.id = payment_record.period_id
  for update;

  if period_record.id is null
    or period_record.organisation_id <> payment_record.organisation_id
    or period_record.amount_due <> confirmed_amount then
    raise exception 'zecontrol_billing_period_mismatch';
  end if;

  if payment_record.status = 'completed' then
    return query
      select payment_record.id, payment_record.period_id, false;
    return;
  end if;

  update zecontrol.billing_payments
  set status = 'completed',
      provider_status = 'completed',
      receipt_url = coalesce(confirmed_receipt_url, receipt_url),
      paid_at = clock_timestamp(),
      last_verified_at = clock_timestamp(),
      payload_fingerprint = coalesce(
        confirmed_payload_fingerprint,
        payload_fingerprint
      ),
      updated_at = clock_timestamp()
  where id = payment_record.id;

  update zecontrol.billing_periods
  set status = 'paid',
      paid_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = payment_record.period_id;

  perform zecontrol.refresh_billing_state(
    payment_record.organisation_id,
    clock_timestamp()
  );

  return query
    select payment_record.id, payment_record.period_id, true;
end;
$$;

alter table zecontrol.billing_price_versions enable row level security;
alter table zecontrol.billing_accounts enable row level security;
alter table zecontrol.billing_periods enable row level security;
alter table zecontrol.billing_event_qualifications enable row level security;
alter table zecontrol.billing_usage enable row level security;
alter table zecontrol.billing_payments enable row level security;

create policy "zecontrol owners read billing accounts"
on zecontrol.billing_accounts for select to authenticated
using (zecontrol.can_manage_organisation(organisation_id));

create policy "zecontrol owners read billing periods"
on zecontrol.billing_periods for select to authenticated
using (zecontrol.can_manage_organisation(organisation_id));

create policy "zecontrol owners read billing usage"
on zecontrol.billing_usage for select to authenticated
using (zecontrol.can_manage_organisation(organisation_id));

create policy "zecontrol owners read billing payments"
on zecontrol.billing_payments for select to authenticated
using (zecontrol.can_manage_organisation(organisation_id));

revoke all on zecontrol.billing_price_versions from public, anon, authenticated;
revoke all on zecontrol.billing_accounts from public, anon, authenticated;
revoke all on zecontrol.billing_periods from public, anon, authenticated;
revoke all on zecontrol.billing_event_qualifications from public, anon, authenticated;
revoke all on zecontrol.billing_usage from public, anon, authenticated;
revoke all on zecontrol.billing_payments from public, anon, authenticated;

grant select on zecontrol.billing_accounts to authenticated;
grant select on zecontrol.billing_periods to authenticated;
grant select on zecontrol.billing_usage to authenticated;
grant select on zecontrol.billing_payments to authenticated;

revoke all on function zecontrol.ensure_current_billing_period(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function zecontrol.refresh_billing_state(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function zecontrol.recalculate_billing_period(uuid)
  from public, anon, authenticated;
revoke all on function zecontrol.capture_event_billing_usage()
  from public, anon, authenticated;
revoke all on function zecontrol.reconcile_cancelled_event_billing()
  from public, anon, authenticated;
revoke all on function zecontrol.finalize_due_billing_periods(uuid)
  from public, anon, authenticated;
revoke all on function zecontrol.apply_completed_paydunya_payment(text, integer, text, text)
  from public, anon, authenticated;

grant execute on function zecontrol.finalize_due_billing_periods(uuid)
  to service_role;
grant execute on function zecontrol.apply_completed_paydunya_payment(text, integer, text, text)
  to service_role;

comment on table zecontrol.billing_usage is
  'One immutable-price ZeControl charge per collaborator and consumption period.';
comment on column zecontrol.billing_usage.source_pointed_at is
  'Business timestamp shown for audit only; it never selects the billing period.';
comment on function zecontrol.capture_event_billing_usage() is
  'Charges the current period when a clocking event becomes accepted, including approved backdated events.';
