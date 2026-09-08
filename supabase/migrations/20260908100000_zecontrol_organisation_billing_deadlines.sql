-- Per-organisation enforcement of ZeControl invoice payment deadlines.
--
-- Invoices remain payable when deadlines are disabled, but they never become
-- overdue and therefore never suspend clocking access. The setting is stored
-- on the billing account so it also applies to every future period.

alter table zecontrol.billing_accounts
  add column if not exists enforce_payment_deadlines boolean not null default true;

comment on column zecontrol.billing_accounts.enforce_payment_deadlines is
  'When false, unpaid invoices stay closed without a due date and never suspend clocking access.';

create or replace function zecontrol.refresh_billing_state(
  target_organisation_id uuid,
  reference_time timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  deadlines_enforced boolean;
begin
  select account.enforce_payment_deadlines
  into deadlines_enforced
  from zecontrol.billing_accounts as account
  where account.organisation_id = target_organisation_id;

  deadlines_enforced := coalesce(deadlines_enforced, true);

  update zecontrol.billing_periods as period
  set status = 'closed',
      closed_at = coalesce(period.closed_at, reference_time),
      due_at = case
        when deadlines_enforced then coalesce(
          period.due_at,
          period.period_ends_at + period.payment_terms_days * interval '1 day'
        )
        else null
      end,
      updated_at = reference_time
  where period.organisation_id = target_organisation_id
    and period.status = 'open'
    and period.period_ends_at <= reference_time;

  if deadlines_enforced then
    update zecontrol.billing_periods as period
    set due_at = period.period_ends_at
          + period.payment_terms_days * interval '1 day',
        updated_at = reference_time
    where period.organisation_id = target_organisation_id
      and period.status = 'closed'
      and period.amount_due > 0
      and period.due_at is null;

    update zecontrol.billing_periods as period
    set status = 'overdue',
        updated_at = reference_time
    where period.organisation_id = target_organisation_id
      and period.status = 'closed'
      and period.amount_due > 0
      and period.due_at < reference_time;
  else
    update zecontrol.billing_periods as period
    set status = case
          when period.status = 'overdue' then 'closed'
          else period.status
        end,
        due_at = null,
        updated_at = reference_time
    where period.organisation_id = target_organisation_id
      and period.status in ('closed', 'overdue')
      and (period.status = 'overdue' or period.due_at is not null);
  end if;

  update zecontrol.billing_accounts as account
  set status = case
        when deadlines_enforced and exists (
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

do $$
declare
  trabad_organisation_id uuid;
begin
  select organisation.id
  into trabad_organisation_id
  from public.organisations as organisation
  where lower(organisation.identifiant) = 'trabad'
  limit 1;

  if trabad_organisation_id is null then
    raise notice 'Trabad organisation not found; billing deadline exception was not applied.';
    return;
  end if;

  update zecontrol.billing_accounts
  set enforce_payment_deadlines = false,
      updated_at = clock_timestamp()
  where organisation_id = trabad_organisation_id;

  perform zecontrol.refresh_billing_state(
    trabad_organisation_id,
    clock_timestamp()
  );
end;
$$;
