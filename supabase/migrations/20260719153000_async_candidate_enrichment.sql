-- Candidate enrichment uses the same durable, private AI queue as imports.

alter table public.ai_processing_jobs
  drop constraint if exists ai_processing_jobs_kind_check;

alter table public.ai_processing_jobs
  add constraint ai_processing_jobs_kind_check
    check (kind in ('cv_import', 'public_application', 'candidate_enrichment')),
  add column if not exists target_candidat_id uuid
    references public.candidats(id) on delete cascade;

create index if not exists ai_processing_jobs_target_candidate_idx
  on public.ai_processing_jobs (target_candidat_id, created_at desc)
  where target_candidat_id is not null;

comment on column public.ai_processing_jobs.target_candidat_id is
  'Candidate updated by an asynchronous enrichment job.';
