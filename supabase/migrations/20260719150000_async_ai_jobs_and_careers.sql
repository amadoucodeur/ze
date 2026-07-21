-- Durable AI processing queue and public career applications.

create or replace function public.career_slug(value text, suffix uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '-' from left(
    regexp_replace(
      lower(translate(coalesce(value, 'offre'),
        'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ',
        'aaaaaaceeeeiiiinooooouuuuyy')),
      '[^a-z0-9]+', '-', 'g'
    ),
    72
  )) || '-' || left(suffix::text, 8);
$$;

alter table public.offres
  add column if not exists public_slug text,
  add column if not exists published_at timestamptz;

-- This is a migration backfill, not a recruiter action. The normal write guard
-- derives the organisation from auth.uid() and enforces the current plan, so it
-- must not run while existing rows receive their generated public slug.
-- PostgreSQL migrations are transactional: if the backfill fails, the trigger
-- state is rolled back with the rest of the migration.
alter table public.offres disable trigger offres_write_guard;

update public.offres
set public_slug = public.career_slug(title, id)
where public_slug is null;

alter table public.offres enable trigger offres_write_guard;

alter table public.offres
  alter column public_slug set not null;

create unique index if not exists offres_organisation_public_slug_uidx
  on public.offres (organisation_id, public_slug);

create or replace function public.prepare_offer_publication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.public_slug is null or trim(new.public_slug) = '' then
    new.public_slug := public.career_slug(new.title, new.id);
  elsif tg_op = 'UPDATE' then
    new.public_slug := old.public_slug;
  end if;

  if new.status <> 'open' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists offres_publication_guard on public.offres;
create trigger offres_publication_guard
before insert or update of status, public_slug, published_at on public.offres
for each row execute function public.prepare_offer_publication();

create table if not exists public.public_applications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  offre_id uuid not null references public.offres(id) on delete cascade,
  fullname text not null check (char_length(trim(fullname)) between 2 and 140),
  email text not null check (char_length(trim(email)) between 5 and 240),
  phone text check (phone is null or char_length(trim(phone)) <= 50),
  cover_note text check (cover_note is null or char_length(cover_note) <= 5000),
  source_name text not null check (char_length(source_name) between 1 and 240),
  request_fingerprint text not null check (char_length(request_fingerprint) = 64),
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  status_message text check (status_message is null or char_length(status_message) <= 1000),
  candidat_id uuid references public.candidats(id) on delete set null,
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_applications_offer_created_idx
  on public.public_applications (offre_id, created_at desc);
create index if not exists public_applications_rate_idx
  on public.public_applications (request_fingerprint, created_at desc);

alter table public.candidatures
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'career_page', 'import')),
  add column if not exists public_application_id uuid
    references public.public_applications(id) on delete set null;

create unique index if not exists candidatures_public_application_uidx
  on public.candidatures (public_application_id)
  where public_application_id is not null;

create or replace function public.prepare_candidature_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
  offer_organisation_id uuid;
  candidate_organisation_id uuid;
  assignee_organisation_id uuid;
  application_organisation_id uuid;
  application_offer_id uuid;
  offer_creator_id uuid;
begin
  if auth.role() = 'service_role' and new.public_application_id is not null then
    select organisation_id, offre_id into application_organisation_id, application_offer_id
    from public.public_applications where id = new.public_application_id;
    select organisation_id, created_by into offer_organisation_id, offer_creator_id
    from public.offres where id = new.offre_id;
    select organisation_id into candidate_organisation_id
    from public.candidats where id = new.candidat_id and archived_at is null;
    if application_organisation_id is null
      or application_offer_id is distinct from new.offre_id
      or offer_organisation_id is distinct from application_organisation_id
      or candidate_organisation_id is distinct from application_organisation_id then
      raise exception 'public application, offer and candidate must belong to the same organisation';
    end if;
    new.organisation_id := application_organisation_id;
    new.created_by := coalesce(new.created_by, offer_creator_id);
    new.updated_by := coalesce(new.updated_by, offer_creator_id);
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    return new;
  end if;

  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null or not public.can_manage_recruitment() then
    raise exception 'active recruiter access is required';
  end if;

  if tg_op = 'UPDATE' then
    new.offre_id := old.offre_id;
    new.candidat_id := old.candidat_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.public_application_id := old.public_application_id;
    new.source := old.source;
  end if;

  select organisation_id into offer_organisation_id from public.offres where id = new.offre_id;
  select organisation_id into candidate_organisation_id from public.candidats where id = new.candidat_id and archived_at is null;
  if offer_organisation_id is null or candidate_organisation_id is null
    or offer_organisation_id <> member_organisation_id
    or candidate_organisation_id <> member_organisation_id then
    raise exception 'offer and candidate must belong to the active organisation';
  end if;

  if new.assigned_to is not null then
    select organisation_id into assignee_organisation_id from public.profiles where id = new.assigned_to and is_active = true;
    if assignee_organisation_id is distinct from member_organisation_id then
      raise exception 'assignee must be an active organisation member';
    end if;
  end if;

  new.organisation_id := member_organisation_id;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

create or replace function public.record_candidature_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.candidature_stage_history (organisation_id, candidature_id, from_stage, to_stage, changed_by)
    values (new.organisation_id, new.id, case when tg_op = 'UPDATE' then old.stage else null end, new.stage, coalesce(auth.uid(), new.created_by));
  end if;
  return new;
end;
$$;

create table if not exists public.ai_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  kind text not null check (kind in ('cv_import', 'public_application')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'retry_wait', 'completed', 'failed', 'cancelled')),
  client_reference text check (client_reference is null or char_length(client_reference) <= 120),
  source_name text not null check (char_length(source_name) between 1 and 240),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  public_application_id uuid references public.public_applications(id) on delete cascade,
  candidat_id uuid references public.candidats(id) on delete set null,
  progress_step text not null default 'queued'
    check (progress_step in ('queued', 'parsing', 'embedding', 'saving', 'completed', 'retry_wait', 'failed')),
  progress_message text not null default 'En attente de traitement',
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_processing_jobs_ready_idx
  on public.ai_processing_jobs (next_attempt_at, created_at)
  where status in ('queued', 'retry_wait');
create index if not exists ai_processing_jobs_organisation_created_idx
  on public.ai_processing_jobs (organisation_id, created_at desc);

create or replace function public.claim_ai_processing_job(
  p_worker_id text,
  p_job_id uuid default null
)
returns setof public.ai_processing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select job.id into claimed_id
  from public.ai_processing_jobs as job
  where (p_job_id is null or job.id = p_job_id)
    and (
      (job.status in ('queued', 'retry_wait') and job.next_attempt_at <= now())
      or (job.status = 'processing' and job.locked_at < now() - interval '15 minutes')
    )
    and job.attempt_count < job.max_attempts
  order by case when p_job_id is not null then 0 else 1 end, job.next_attempt_at, job.created_at
  for update skip locked
  limit 1;

  if claimed_id is null then return; end if;

  return query
  update public.ai_processing_jobs
  set status = 'processing',
      progress_step = case when progress_step in ('retry_wait', 'failed') then 'queued' else progress_step end,
      progress_message = case when attempt_count > 0 then 'Nouvelle tentative en cours…' else 'Traitement démarré…' end,
      attempt_count = attempt_count + 1,
      locked_at = now(),
      locked_by = left(p_worker_id, 200),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = claimed_id
  returning *;
end;
$$;

revoke all on function public.claim_ai_processing_job(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_processing_job(text, uuid) to service_role;

alter table public.public_applications enable row level security;
alter table public.ai_processing_jobs enable row level security;

drop policy if exists "Active members read organisation public applications"
  on public.public_applications;
create policy "Active members read organisation public applications"
on public.public_applications for select to authenticated
using (organisation_id = public.current_active_organisation_id());

revoke all on public.public_applications, public.ai_processing_jobs from anon;
revoke all on public.ai_processing_jobs from authenticated;
grant select on public.public_applications to authenticated;
grant all on public.public_applications, public.ai_processing_jobs to service_role;

update public.candidats
set salary_value = null,
    performance_score = null,
    performance = null;

comment on column public.candidats.salary_value is
  'Reserved for a recruiter-verified or candidate-declared salary expectation. Never generated by AI.';
comment on column public.candidats.performance_score is
  'Objective CV quality score (content and presentation), never a candidate suitability or hiring score.';
comment on column public.candidats.performance is
  'Quality breakdown for completeness, clarity, consistency, evidence and presentation of the professional profile.';
comment on table public.ai_processing_jobs is
  'Private durable queue for secret-backed AI work. Payloads are inaccessible to browser roles and cleared after completion.';
comment on table public.public_applications is
  'Public career-page submissions; documents are read in the browser and only verified text enters the private AI queue.';
