-- Auditable commercial grace for a closed ZeControl billing period.
--
-- A grace is not a payment: the original billed amount remains visible for
-- audit, the period becomes void, and later billing periods are untouched.

create table if not exists zecontrol.billing_waivers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references zecontrol.orga_configs(id) on delete restrict,
  period_id uuid not null unique
    references zecontrol.billing_periods(id) on delete restrict,
  amount_waived integer not null check (amount_waived > 0),
  currency text not null default 'XOF' check (currency = 'XOF'),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_via text not null default 'platform_support'
    check (granted_via in ('platform_support', 'commercial_grace')),
  metadata jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists billing_waivers_organisation_granted_idx
  on zecontrol.billing_waivers (organisation_id, granted_at desc);

alter table zecontrol.billing_waivers enable row level security;

drop policy if exists "zecontrol owners read billing waivers"
  on zecontrol.billing_waivers;
create policy "zecontrol owners read billing waivers"
on zecontrol.billing_waivers for select to authenticated
using (zecontrol.can_manage_organisation(organisation_id));

revoke all on zecontrol.billing_waivers from public, anon, authenticated;
grant select on zecontrol.billing_waivers to authenticated;

create or replace function zecontrol.grant_billing_period_grace(
  target_organisation_id uuid,
  target_period_id uuid,
  target_expected_amount integer,
  grace_reason text,
  target_granted_by uuid default null,
  grace_metadata jsonb default '{}'::jsonb
)
returns table(waiver_id uuid, period_id uuid, applied boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  period_record zecontrol.billing_periods%rowtype;
  existing_waiver_id uuid;
  created_waiver_id uuid;
  applied_at timestamptz := clock_timestamp();
begin
  if target_organisation_id is null or target_period_id is null then
    raise exception 'zecontrol_billing_grace_target_required';
  end if;
  if target_expected_amount is null or target_expected_amount <= 0 then
    raise exception 'zecontrol_billing_grace_amount_required';
  end if;
  if grace_reason is null
    or char_length(btrim(grace_reason)) not between 5 and 500 then
    raise exception 'zecontrol_billing_grace_reason_required';
  end if;

  select period.*
  into period_record
  from zecontrol.billing_periods as period
  where period.id = target_period_id
    and period.organisation_id = target_organisation_id
  for update;

  if period_record.id is null then
    raise exception 'zecontrol_billing_grace_period_not_found';
  end if;
  if period_record.amount_due <> target_expected_amount then
    raise exception 'zecontrol_billing_grace_amount_mismatch';
  end if;

  select waiver.id
  into existing_waiver_id
  from zecontrol.billing_waivers as waiver
  where waiver.period_id = target_period_id;

  if existing_waiver_id is not null then
    if period_record.status <> 'void' then
      update zecontrol.billing_periods as period
      set status = 'void',
          paid_at = null,
          updated_at = applied_at
      where period.id = target_period_id;
      perform zecontrol.refresh_billing_state(
        target_organisation_id,
        applied_at
      );
    end if;
    return query select existing_waiver_id, target_period_id, false;
    return;
  end if;

  -- `void` is accepted for audit backfills when an emergency grace already
  -- closed the invoice before this dedicated ledger was installed.
  if period_record.status not in ('closed', 'overdue', 'void') then
    raise exception 'zecontrol_billing_grace_period_not_eligible';
  end if;

  insert into zecontrol.billing_waivers (
    organisation_id,
    period_id,
    amount_waived,
    currency,
    reason,
    granted_by,
    granted_via,
    metadata,
    granted_at
  ) values (
    target_organisation_id,
    target_period_id,
    period_record.amount_due,
    period_record.currency,
    btrim(grace_reason),
    target_granted_by,
    'commercial_grace',
    coalesce(grace_metadata, '{}'::jsonb),
    applied_at
  )
  returning id into created_waiver_id;

  update zecontrol.billing_periods as period
  set status = 'void',
      paid_at = null,
      updated_at = applied_at
  where period.id = target_period_id;

  update zecontrol.billing_payments as payment
  set status = 'cancelled',
      provider_status = coalesce(payment.provider_status, 'cancelled'),
      provider_response_text = coalesce(
        payment.provider_response_text,
        'Invoice closed by an audited commercial grace.'
      ),
      updated_at = applied_at
  where payment.period_id = target_period_id
    and payment.status in ('initiated', 'pending');

  perform zecontrol.refresh_billing_state(
    target_organisation_id,
    applied_at
  );

  return query select created_waiver_id, target_period_id, true;
end;
$$;

revoke all on function zecontrol.grant_billing_period_grace(
  uuid,
  uuid,
  integer,
  text,
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function zecontrol.grant_billing_period_grace(
  uuid,
  uuid,
  integer,
  text,
  uuid,
  jsonb
) to service_role;

comment on table zecontrol.billing_waivers is
  'Auditable non-payment settlements. The original billed amount remains on the void period.';
comment on function zecontrol.grant_billing_period_grace(
  uuid,
  uuid,
  integer,
  text,
  uuid,
  jsonb
) is
  'Voids one closed invoice, or audits an already void invoice, through an idempotent amount-checked commercial grace.';

-- One-off commercial grace requested for Trabad's July 2026 invoice.
do $$
begin
  if exists (
    select 1
    from public.organisations as organisation
    join zecontrol.billing_periods as period
      on period.organisation_id = organisation.id
    where organisation.id = 'ee561df1-33f2-4860-91a8-5e0b5998e3e2'::uuid
      and organisation.name = 'Trabad'
      and period.id = '5939d511-7d4f-49d8-bb71-cfa851ff172a'::uuid
      and period.amount_due = 7500
      and period.status in ('closed', 'overdue', 'void')
  ) then
    perform zecontrol.grant_billing_period_grace(
      'ee561df1-33f2-4860-91a8-5e0b5998e3e2'::uuid,
      '5939d511-7d4f-49d8-bb71-cfa851ff172a'::uuid,
      7500,
      'Grâce commerciale exceptionnelle accordée à Trabad pour juillet 2026.',
      null,
      jsonb_build_object(
        'requested_on', '2026-08-10',
        'migration', '20260810080000_zecontrol_billing_grace'
      )
    );
  end if;
end;
$$;
