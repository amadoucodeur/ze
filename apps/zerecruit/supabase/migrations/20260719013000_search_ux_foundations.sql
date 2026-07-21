-- UX foundations: user-owned search history, privacy-safe product events and ordered collection items.

alter table public.talent_collection_items
  add column if not exists position integer;

with ranked_items as (
  select
    collection_id,
    candidat_id,
    row_number() over (partition by collection_id order by created_at, candidat_id)::integer as next_position
  from public.talent_collection_items
)
update public.talent_collection_items as item
set position = ranked.next_position
from ranked_items as ranked
where item.collection_id = ranked.collection_id
  and item.candidat_id = ranked.candidat_id
  and item.position is null;

alter table public.talent_collection_items
  alter column position set default 0,
  alter column position set not null;

create index if not exists talent_collection_items_collection_position_idx
  on public.talent_collection_items (collection_id, position, created_at);

create or replace function public.prepare_talent_collection_item_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
  collection_organisation_id uuid;
  candidate_organisation_id uuid;
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null or not public.can_manage_talent_collections() then
    raise exception 'active recruiter access is required';
  end if;

  if tg_op = 'UPDATE' then
    new.collection_id := old.collection_id;
    new.candidat_id := old.candidat_id;
    new.added_by := old.added_by;
    new.created_at := old.created_at;
    if new.position is null or new.position < 1 then new.position := old.position; end if;
  end if;

  select collection.organisation_id
  into collection_organisation_id
  from public.talent_collections as collection
  where collection.id = new.collection_id;

  select candidate.organisation_id
  into candidate_organisation_id
  from public.candidats as candidate
  where candidate.id = new.candidat_id
    and candidate.archived_at is null;

  if collection_organisation_id is null
    or candidate_organisation_id is null
    or collection_organisation_id <> member_organisation_id
    or candidate_organisation_id <> member_organisation_id then
    raise exception 'collection and candidate must belong to the active organisation';
  end if;

  new.organisation_id := member_organisation_id;
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
    if new.position is null or new.position < 1 then
      select coalesce(max(item.position), 0) + 1
      into new.position
      from public.talent_collection_items as item
      where item.collection_id = new.collection_id;
    end if;
  end if;
  return new;
end;
$$;

create table if not exists public.talent_search_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  understood_request text not null check (char_length(trim(understood_request)) between 3 and 500),
  criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  result_count integer not null default 0 check (result_count between 0 and 200),
  clarification_count integer not null default 0 check (clarification_count between 0 and 20),
  created_at timestamptz not null default now()
);

create index if not exists talent_search_sessions_user_created_idx
  on public.talent_search_sessions (user_id, created_at desc);

create or replace function public.prepare_talent_search_session_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null then
    raise exception 'active organisation access is required';
  end if;
  new.organisation_id := member_organisation_id;
  new.user_id := auth.uid();
  new.understood_request := trim(new.understood_request);
  return new;
end;
$$;

drop trigger if exists talent_search_sessions_write_guard on public.talent_search_sessions;
create trigger talent_search_sessions_write_guard
before insert on public.talent_search_sessions
for each row execute function public.prepare_talent_search_session_write();

alter table public.talent_search_sessions enable row level security;

drop policy if exists "Members read their talent search history" on public.talent_search_sessions;
create policy "Members read their talent search history"
on public.talent_search_sessions for select
to authenticated
using (
  user_id = auth.uid()
  and organisation_id = public.current_active_organisation_id()
);

drop policy if exists "Members create their talent search history" on public.talent_search_sessions;
create policy "Members create their talent search history"
on public.talent_search_sessions for insert
to authenticated
with check (
  user_id = auth.uid()
  and organisation_id = public.current_active_organisation_id()
);

drop policy if exists "Members delete their talent search history" on public.talent_search_sessions;
create policy "Members delete their talent search history"
on public.talent_search_sessions for delete
to authenticated
using (
  user_id = auth.uid()
  and organisation_id = public.current_active_organisation_id()
);

revoke all on public.talent_search_sessions from anon;
grant select, insert, delete on public.talent_search_sessions to authenticated;

create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_name text not null check (event_name in (
    'talent_semantic_search_completed',
    'candidate_added_to_collection',
    'candidate_enrichment_completed',
    'cv_import_completed'
  )),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists product_events_organisation_created_idx
  on public.product_events (organisation_id, created_at desc);

create or replace function public.prepare_product_event_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null then
    raise exception 'active organisation access is required';
  end if;
  new.organisation_id := member_organisation_id;
  new.actor_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists product_events_write_guard on public.product_events;
create trigger product_events_write_guard
before insert on public.product_events
for each row execute function public.prepare_product_event_write();

alter table public.product_events enable row level security;

drop policy if exists "Members create privacy safe product events" on public.product_events;
create policy "Members create privacy safe product events"
on public.product_events for insert
to authenticated
with check (
  actor_id = auth.uid()
  and organisation_id = public.current_active_organisation_id()
);

revoke all on public.product_events from anon;
revoke all on public.product_events from authenticated;
grant insert on public.product_events to authenticated;

comment on table public.talent_search_sessions is
  'Private per-user history of sanitized understood talent searches. Raw conversation text is not stored.';
comment on table public.product_events is
  'Privacy-safe product value events. Candidate names, contact details and document text are forbidden in properties.';
