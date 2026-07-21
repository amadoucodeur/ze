-- A paid plan starts immediately, but any remaining trial or paid duration is
-- preserved and the purchased month/year is added after that existing period.

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

  if payment_record.id is null then raise exception 'billing payment not found'; end if;
  if payment_record.amount <> confirmed_amount then raise exception 'billing amount mismatch'; end if;

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
  set status = 'completed', provider_status = 'completed',
      receipt_url = coalesce(confirmed_receipt_url, receipt_url),
      period_starts_at = period_start, period_ends_at = period_end,
      paid_at = now(), last_verified_at = now(),
      payload_fingerprint = coalesce(confirmed_payload_fingerprint, payload_fingerprint),
      updated_at = now()
  where id = payment_record.id;

  update public.organisations
  set plan = payment_record.plan_code, billing_status = 'active',
      billing_cycle = payment_record.billing_cycle,
      plan_expires_at = period_end, plan_updated_at = now(), updated_at = now()
  where id = payment_record.organisation_id;

  return query select payment_record.id, true, period_end;
end;
$$;

revoke all on function public.apply_completed_paydunya_payment(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.apply_completed_paydunya_payment(text, integer, text, text) to service_role;
