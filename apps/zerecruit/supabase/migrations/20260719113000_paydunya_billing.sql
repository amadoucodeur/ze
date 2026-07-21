-- PayDunya billing ledger and organisation subscription state.
-- Payments are created and mutated only by trusted server code. Owners receive
-- read-only access to the financial history of their own organisation.

alter table public.organisations
  add column if not exists trial_ends_at timestamptz,
  add column if not exists plan_expires_at timestamptz,
  add column if not exists billing_status text,
  add column if not exists billing_cycle text,
  add column if not exists plan_updated_at timestamptz;

update public.organisations
set trial_ends_at = coalesce(trial_ends_at, created_at + interval '1 month'),
    plan_expires_at = coalesce(plan_expires_at, created_at + interval '1 month'),
    billing_status = coalesce(billing_status, 'trialing'),
    billing_cycle = coalesce(billing_cycle, 'trial'),
    plan_updated_at = coalesce(plan_updated_at, created_at)
where plan = 'free';

update public.organisations
set billing_status = coalesce(billing_status, 'active'),
    billing_cycle = coalesce(billing_cycle, 'month'),
    plan_updated_at = coalesce(plan_updated_at, updated_at, created_at)
where plan <> 'free';

alter table public.organisations
  alter column trial_ends_at set default (now() + interval '1 month'),
  alter column billing_status set default 'trialing',
  alter column plan_updated_at set default now();

alter table public.organisations
  drop constraint if exists organisations_billing_status_check,
  add constraint organisations_billing_status_check
    check (billing_status is null or billing_status in ('trialing', 'active', 'past_due', 'expired', 'suspended')),
  drop constraint if exists organisations_billing_cycle_check,
  add constraint organisations_billing_cycle_check
    check (billing_cycle is null or billing_cycle in ('trial', 'month', 'year'));

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  internal_reference uuid not null default gen_random_uuid() unique,
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  provider text not null default 'paydunya' check (provider = 'paydunya'),
  provider_token text unique,
  plan_code text not null check (plan_code in ('essential', 'team')),
  billing_cycle text not null check (billing_cycle in ('month', 'year')),
  amount integer not null check (amount > 0),
  currency text not null default 'XOF' check (currency = 'XOF'),
  status text not null default 'initiated'
    check (status in ('initiated', 'pending', 'completed', 'cancelled', 'failed', 'error')),
  checkout_url text,
  receipt_url text,
  provider_response_code text,
  provider_response_text text,
  provider_status text,
  period_starts_at timestamptz,
  period_ends_at timestamptz,
  paid_at timestamptz,
  last_verified_at timestamptz,
  payload_fingerprint text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_payments_organisation_created_idx
  on public.billing_payments (organisation_id, created_at desc);
create index if not exists billing_payments_pending_idx
  on public.billing_payments (organisation_id, status, created_at desc)
  where status in ('initiated', 'pending');

alter table public.billing_payments enable row level security;

drop policy if exists "Owners read organisation billing" on public.billing_payments;
create policy "Owners read organisation billing"
on public.billing_payments
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organisation_id = billing_payments.organisation_id
      and p.role = 'owner'
      and p.is_active = true
  )
);

revoke all on public.billing_payments from anon, authenticated;
grant select on public.billing_payments to authenticated;

create or replace function public.apply_completed_paydunya_payment(
  target_token text,
  confirmed_amount integer,
  confirmed_receipt_url text default null,
  confirmed_payload_fingerprint text default null
)
returns table(payment_id uuid, applied boolean, subscription_ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_record public.billing_payments%rowtype;
  organisation_record public.organisations%rowtype;
  period_start timestamptz;
  period_end timestamptz;
begin
  select * into payment_record
  from public.billing_payments
  where provider = 'paydunya' and provider_token = target_token
  for update;

  if payment_record.id is null then
    raise exception 'billing payment not found';
  end if;
  if payment_record.amount <> confirmed_amount then
    raise exception 'billing amount mismatch';
  end if;

  select * into organisation_record
  from public.organisations
  where id = payment_record.organisation_id
  for update;

  if payment_record.status = 'completed' then
    return query select payment_record.id, false, payment_record.period_ends_at;
    return;
  end if;

  period_start := case
    when organisation_record.plan_expires_at is not null
      and organisation_record.plan_expires_at > now()
      then organisation_record.plan_expires_at
    else now()
  end;
  period_end := period_start + case
    when payment_record.billing_cycle = 'year' then interval '1 year'
    else interval '1 month'
  end;

  update public.billing_payments
  set status = 'completed',
      provider_status = 'completed',
      receipt_url = coalesce(confirmed_receipt_url, receipt_url),
      period_starts_at = period_start,
      period_ends_at = period_end,
      paid_at = now(),
      last_verified_at = now(),
      payload_fingerprint = coalesce(confirmed_payload_fingerprint, payload_fingerprint),
      updated_at = now()
  where id = payment_record.id;

  update public.organisations
  set plan = payment_record.plan_code,
      billing_status = 'active',
      billing_cycle = payment_record.billing_cycle,
      plan_expires_at = period_end,
      plan_updated_at = now(),
      updated_at = now()
  where id = payment_record.organisation_id;

  return query select payment_record.id, true, period_end;
end;
$$;

revoke all on function public.apply_completed_paydunya_payment(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.apply_completed_paydunya_payment(text, integer, text, text) to service_role;

comment on table public.billing_payments is
  'Immutable-price payment attempts initiated by an organisation owner through PayDunya.';
comment on function public.apply_completed_paydunya_payment(text, integer, text, text) is
  'Idempotently completes a verified PayDunya payment and extends the organisation plan in one transaction.';
