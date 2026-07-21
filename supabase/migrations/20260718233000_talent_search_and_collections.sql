-- Conversational talent search and shared organisation collections.

create or replace function public.current_active_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profile.organisation_id
  from public.profiles as profile
  join public.organisations as organisation on organisation.id = profile.organisation_id
  where profile.id = auth.uid()
    and profile.is_active = true
    and organisation.status = 'active'
  limit 1;
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
      and profile.role::text in ('owner', 'admin', 'recruiter')
  );
$$;

revoke all on function public.current_active_organisation_id() from public;
revoke all on function public.can_manage_talent_collections() from public;
grant execute on function public.current_active_organisation_id() to authenticated;
grant execute on function public.can_manage_talent_collections() to authenticated;

create table if not exists public.talent_collections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  description text check (description is null or char_length(description) <= 500),
  color text not null default 'forest' check (color in ('forest', 'lime', 'blue', 'amber', 'rose', 'violet')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists talent_collections_organisation_name_unique
  on public.talent_collections (organisation_id, lower(trim(name)));
create index if not exists talent_collections_organisation_updated_idx
  on public.talent_collections (organisation_id, updated_at desc);

create table if not exists public.talent_collection_items (
  collection_id uuid not null references public.talent_collections(id) on delete cascade,
  candidat_id uuid not null references public.candidats(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete restrict,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  primary key (collection_id, candidat_id)
);

create index if not exists talent_collection_items_candidate_idx
  on public.talent_collection_items (organisation_id, candidat_id);
create index if not exists talent_collection_items_collection_created_idx
  on public.talent_collection_items (collection_id, created_at desc);

create or replace function public.prepare_talent_collection_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null or not public.can_manage_talent_collections() then
    raise exception 'active recruiter access is required';
  end if;

  if tg_op = 'INSERT' then
    new.organisation_id := member_organisation_id;
    new.created_by := auth.uid();
  else
    new.organisation_id := old.organisation_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.name := trim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists talent_collections_write_guard on public.talent_collections;
create trigger talent_collections_write_guard
before insert or update on public.talent_collections
for each row execute function public.prepare_talent_collection_write();

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
  if tg_op = 'INSERT' then new.added_by := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists talent_collection_items_write_guard on public.talent_collection_items;
create trigger talent_collection_items_write_guard
before insert or update on public.talent_collection_items
for each row execute function public.prepare_talent_collection_item_write();

alter table public.talent_collections enable row level security;
alter table public.talent_collection_items enable row level security;

drop policy if exists "Active members read organisation talent collections" on public.talent_collections;
create policy "Active members read organisation talent collections"
on public.talent_collections for select
to authenticated
using (organisation_id = public.current_active_organisation_id());

drop policy if exists "Recruiters manage organisation talent collections" on public.talent_collections;
create policy "Recruiters manage organisation talent collections"
on public.talent_collections for all
to authenticated
using (
  organisation_id = public.current_active_organisation_id()
  and public.can_manage_talent_collections()
)
with check (
  organisation_id = public.current_active_organisation_id()
  and public.can_manage_talent_collections()
);

drop policy if exists "Active members read organisation talent collection items" on public.talent_collection_items;
create policy "Active members read organisation talent collection items"
on public.talent_collection_items for select
to authenticated
using (organisation_id = public.current_active_organisation_id());

drop policy if exists "Recruiters manage organisation talent collection items" on public.talent_collection_items;
create policy "Recruiters manage organisation talent collection items"
on public.talent_collection_items for all
to authenticated
using (
  organisation_id = public.current_active_organisation_id()
  and public.can_manage_talent_collections()
)
with check (
  organisation_id = public.current_active_organisation_id()
  and public.can_manage_talent_collections()
);

revoke all on public.talent_collections from anon;
revoke all on public.talent_collection_items from anon;
grant select on public.talent_collections to authenticated;
grant select on public.talent_collection_items to authenticated;
grant insert, update, delete on public.talent_collections to authenticated;
grant insert, update, delete on public.talent_collection_items to authenticated;

create index if not exists section_chunks_embedding_hnsw_idx
  on public.section_chunks using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create or replace function public.search_candidate_chunks(
  query_embedding extensions.vector(1536),
  result_limit integer default 80,
  min_similarity double precision default 0.05
)
returns table (
  candidat_id uuid,
  semantic_similarity double precision,
  matched_chunks jsonb
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with ranked as (
    select
      chunk.candidat_id,
      chunk.type::text as chunk_type,
      chunk.content,
      1 - (chunk.embedding <=> query_embedding) as similarity,
      row_number() over (
        partition by chunk.candidat_id
        order by chunk.embedding <=> query_embedding
      ) as chunk_rank
    from public.section_chunks as chunk
    join public.candidats as candidate on candidate.id = chunk.candidat_id
    where chunk.organisation_id = public.current_active_organisation_id()
      and candidate.organisation_id = chunk.organisation_id
      and candidate.archived_at is null
      and chunk.embedding is not null
  )
  select
    ranked.candidat_id,
    greatest(0, least(1,
      max(ranked.similarity) * 0.7
      + avg(ranked.similarity) filter (where ranked.chunk_rank <= 3) * 0.3
    ))::double precision as semantic_similarity,
    (
      select jsonb_agg(jsonb_build_object(
        'type', best.chunk_type,
        'content', best.content,
        'similarity', round(best.similarity::numeric, 4)
      ) order by best.similarity desc)
      from ranked as best
      where best.candidat_id = ranked.candidat_id
        and best.chunk_rank <= 3
    ) as matched_chunks
  from ranked
  where ranked.similarity >= greatest(-1, least(1, min_similarity))
  group by ranked.candidat_id
  order by semantic_similarity desc
  limit greatest(1, least(200, result_limit));
$$;

revoke all on function public.search_candidate_chunks(extensions.vector, integer, double precision) from public;
grant execute on function public.search_candidate_chunks(extensions.vector, integer, double precision) to authenticated;

comment on table public.talent_collections is
  'Shared organisation collections used to group candidate profiles.';
comment on function public.search_candidate_chunks(extensions.vector, integer, double precision) is
  'Tenant-scoped semantic candidate search over granular section embeddings.';
