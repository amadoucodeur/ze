-- Offer-centered recruitment: validated recruiter intent, candidate pipeline and interview answers.

create or replace function public.can_manage_recruitment()
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

revoke all on function public.can_manage_recruitment() from public;
grant execute on function public.can_manage_recruitment() to authenticated;

create table if not exists public.offres (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  department text check (department is null or char_length(department) <= 120),
  status text not null default 'draft' check (status in ('draft', 'open', 'paused', 'closed')),
  contract_type text check (contract_type is null or contract_type in ('permanent', 'fixed_term', 'internship', 'freelance', 'temporary', 'apprenticeship', 'other')),
  work_mode text check (work_mode is null or work_mode in ('onsite', 'hybrid', 'remote')),
  location text check (location is null or char_length(location) <= 160),
  headcount integer not null default 1 check (headcount between 1 and 500),
  target_start_date date,
  salary_min numeric check (salary_min is null or salary_min >= 0),
  salary_max numeric check (salary_max is null or salary_max >= 0),
  salary_currency text check (salary_currency is null or char_length(salary_currency) between 3 and 8),
  salary_period text check (salary_period is null or salary_period in ('month', 'year')),
  summary text check (summary is null or char_length(summary) <= 4000),
  mission text check (mission is null or char_length(mission) <= 6000),
  responsibilities text[] not null default '{}',
  must_have_skills text[] not null default '{}',
  nice_to_have_skills text[] not null default '{}',
  languages text[] not null default '{}',
  industries text[] not null default '{}',
  min_experience_months integer check (min_experience_months is null or min_experience_months between 0 and 720),
  education text check (education is null or char_length(education) <= 500),
  success_outcomes text[] not null default '{}',
  recruiter_intent text check (recruiter_intent is null or char_length(recruiter_intent) <= 4000),
  points_to_clarify text[] not null default '{}',
  excluded_sensitive_criteria text[] not null default '{}',
  source_text text check (source_text is null or char_length(source_text) <= 120000),
  source_names text[] not null default '{}',
  analysis jsonb not null default '{}'::jsonb check (jsonb_typeof(analysis) = 'object'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offres_salary_range check (salary_min is null or salary_max is null or salary_max >= salary_min)
);

create index if not exists offres_organisation_status_updated_idx
  on public.offres (organisation_id, status, updated_at desc);

create or replace function public.prepare_offer_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null or not public.can_manage_recruitment() then
    raise exception 'active recruiter access is required';
  end if;

  new.organisation_id := member_organisation_id;
  new.title := trim(new.title);
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists offres_write_guard on public.offres;
create trigger offres_write_guard
before insert or update on public.offres
for each row execute function public.prepare_offer_write();

create table if not exists public.candidatures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  offre_id uuid not null references public.offres(id) on delete cascade,
  candidat_id uuid not null references public.candidats(id) on delete cascade,
  stage text not null default 'review' check (stage in ('review', 'shortlisted', 'interview', 'offer', 'hired', 'rejected')),
  match_score integer check (match_score is null or match_score between 0 and 100),
  match_summary text check (match_summary is null or char_length(match_summary) <= 1200),
  match_details jsonb not null default '{}'::jsonb check (jsonb_typeof(match_details) = 'object'),
  assigned_to uuid references public.profiles(id) on delete set null,
  team_note text check (team_note is null or char_length(team_note) <= 3000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offre_id, candidat_id)
);

create index if not exists candidatures_offer_stage_updated_idx
  on public.candidatures (offre_id, stage, updated_at desc);
create index if not exists candidatures_candidate_updated_idx
  on public.candidatures (organisation_id, candidat_id, updated_at desc);

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
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null or not public.can_manage_recruitment() then
    raise exception 'active recruiter access is required';
  end if;

  if tg_op = 'UPDATE' then
    new.offre_id := old.offre_id;
    new.candidat_id := old.candidat_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
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

drop trigger if exists candidatures_write_guard on public.candidatures;
create trigger candidatures_write_guard
before insert or update on public.candidatures
for each row execute function public.prepare_candidature_write();

create table if not exists public.candidature_stage_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  candidature_id uuid not null references public.candidatures(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists candidature_stage_history_candidate_idx
  on public.candidature_stage_history (candidature_id, created_at desc);

create or replace function public.record_candidature_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.candidature_stage_history (organisation_id, candidature_id, from_stage, to_stage, changed_by)
    values (new.organisation_id, new.id, case when tg_op = 'UPDATE' then old.stage else null end, new.stage, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists candidature_stage_change_history on public.candidatures;
create trigger candidature_stage_change_history
after insert or update of stage on public.candidatures
for each row execute function public.record_candidature_stage_change();

create table if not exists public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  candidature_id uuid not null references public.candidatures(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 5 and 1000),
  purpose text check (purpose is null or char_length(purpose) <= 700),
  expected_signals text[] not null default '{}',
  category text not null default 'role' check (category in ('motivation', 'experience', 'skill', 'situation', 'availability', 'role', 'closing')),
  position integer not null default 1 check (position between 1 and 100),
  candidate_answer text check (candidate_answer is null or char_length(candidate_answer) <= 10000),
  interviewer_note text check (interviewer_note is null or char_length(interviewer_note) <= 5000),
  score integer check (score is null or score between 0 and 100),
  answered_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists interview_questions_candidate_position_idx
  on public.interview_questions (candidature_id, position, created_at);

create or replace function public.prepare_interview_question_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_organisation_id uuid;
  application_organisation_id uuid;
begin
  member_organisation_id := public.current_active_organisation_id();
  if member_organisation_id is null or not public.can_manage_recruitment() then
    raise exception 'active recruiter access is required';
  end if;

  if tg_op = 'UPDATE' then
    new.candidature_id := old.candidature_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  select organisation_id into application_organisation_id from public.candidatures where id = new.candidature_id;
  if application_organisation_id is distinct from member_organisation_id then
    raise exception 'interview question must belong to the active organisation';
  end if;

  new.organisation_id := member_organisation_id;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if new.candidate_answer is not null and char_length(trim(new.candidate_answer)) > 0 then new.answered_at := coalesce(new.answered_at, now()); end if;
  return new;
end;
$$;

drop trigger if exists interview_questions_write_guard on public.interview_questions;
create trigger interview_questions_write_guard
before insert or update on public.interview_questions
for each row execute function public.prepare_interview_question_write();

alter table public.offres enable row level security;
alter table public.candidatures enable row level security;
alter table public.candidature_stage_history enable row level security;
alter table public.interview_questions enable row level security;

create policy "Active members read organisation offers" on public.offres for select to authenticated
using (organisation_id = public.current_active_organisation_id());
create policy "Recruiters manage organisation offers" on public.offres for all to authenticated
using (organisation_id = public.current_active_organisation_id() and public.can_manage_recruitment())
with check (organisation_id = public.current_active_organisation_id() and public.can_manage_recruitment());

create policy "Active members read organisation applications" on public.candidatures for select to authenticated
using (organisation_id = public.current_active_organisation_id());
create policy "Recruiters manage organisation applications" on public.candidatures for all to authenticated
using (organisation_id = public.current_active_organisation_id() and public.can_manage_recruitment())
with check (organisation_id = public.current_active_organisation_id() and public.can_manage_recruitment());

create policy "Active members read organisation application history" on public.candidature_stage_history for select to authenticated
using (organisation_id = public.current_active_organisation_id());

create policy "Active members read organisation interview questions" on public.interview_questions for select to authenticated
using (organisation_id = public.current_active_organisation_id());
create policy "Recruiters manage organisation interview questions" on public.interview_questions for all to authenticated
using (organisation_id = public.current_active_organisation_id() and public.can_manage_recruitment())
with check (organisation_id = public.current_active_organisation_id() and public.can_manage_recruitment());

revoke all on public.offres, public.candidatures, public.candidature_stage_history, public.interview_questions from anon;
grant select on public.offres, public.candidatures, public.candidature_stage_history, public.interview_questions to authenticated;
grant insert, update, delete on public.offres, public.candidatures, public.interview_questions to authenticated;

alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check check (event_name in (
  'talent_semantic_search_completed', 'candidate_added_to_collection', 'candidate_enrichment_completed', 'cv_import_completed',
  'offer_created', 'candidate_added_to_offer', 'interview_guide_created', 'interview_response_saved'
));

comment on table public.offres is 'Organisation-scoped job descriptions with recruiter-validated professional intent.';
comment on table public.candidatures is 'Candidate-to-offer recruitment pipeline; separate from candidate professional availability.';
comment on table public.interview_questions is 'Offer- and candidate-contextual interview guide with the candidate answer recorded by the recruiter.';
