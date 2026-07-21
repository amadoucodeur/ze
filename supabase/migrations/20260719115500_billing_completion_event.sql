-- Permit trusted server-side billing completion analytics while preserving the
-- tenant and actor verification applied to ordinary client events.

alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check check (event_name in (
  'talent_semantic_search_completed', 'candidate_added_to_collection', 'candidate_enrichment_completed', 'cv_import_completed',
  'offer_created', 'candidate_added_to_offer', 'interview_guide_created', 'interview_response_saved',
  'billing_payment_completed'
));

create or replace function public.prepare_product_event_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
begin
  if auth.role() = 'service_role' then
    select organisation_id into member_organisation_id
    from public.profiles
    where id = new.actor_id and is_active = true;
    if member_organisation_id is null or member_organisation_id <> new.organisation_id then
      raise exception 'active organisation actor is required';
    end if;
    return new;
  end if;

  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null then
    raise exception 'active organisation access is required';
  end if;
  new.organisation_id := member_organisation_id;
  new.actor_id := auth.uid();
  return new;
end;
$$;
