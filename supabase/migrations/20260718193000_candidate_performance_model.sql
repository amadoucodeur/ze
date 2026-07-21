-- Candidate intelligence model: availability, evidence scores and granular chunks.

do $$
begin
  create type public.candidate_availability as enum (
    'available',
    'employed',
    'open_to_opportunities',
    'freelance',
    'student',
    'unavailable',
    'unknown'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.skill_importance as enum ('Primary', 'Secondary', 'Bonus');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.skill_expertise as enum (
    'Beginner',
    'Junior',
    'Intermediate',
    'Advanced',
    'Expert'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.skill_source as enum (
    'cv',
    'manual',
    'cover_letter',
    'interview',
    'portfolio',
    'technical_test',
    'reference',
    'import',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.candidats
  alter column statut drop default;

alter table public.candidats
  alter column statut type public.candidate_availability
  using (
    case lower(coalesce(statut::text, ''))
      when 'libre' then 'available'
      when 'disponible' then 'available'
      when 'available' then 'available'
      when 'en poste' then 'employed'
      when 'employed' then 'employed'
      when 'à l’écoute' then 'open_to_opportunities'
      when 'a l''ecoute' then 'open_to_opportunities'
      when 'open_to_opportunities' then 'open_to_opportunities'
      when 'freelance' then 'freelance'
      when 'étudiant' then 'student'
      when 'etudiant' then 'student'
      when 'student' then 'student'
      when 'indisponible' then 'unavailable'
      when 'unavailable' then 'unavailable'
      else 'unknown'
    end::public.candidate_availability
  );

alter table public.candidats
  alter column statut set default 'unknown'::public.candidate_availability,
  alter column statut set not null,
  drop column if exists global_embedding,
  add column if not exists performance_score smallint,
  add column if not exists performance jsonb,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.candidats
  drop constraint if exists candidats_performance_score_range,
  add constraint candidats_performance_score_range
    check (performance_score is null or performance_score between 0 and 100),
  drop constraint if exists candidats_salary_value_shape,
  add constraint candidats_salary_value_shape check (
    salary_value is null
    or (
      jsonb_typeof(salary_value) = 'object'
      and jsonb_typeof(salary_value -> 'from') = 'number'
      and jsonb_typeof(salary_value -> 'to') = 'number'
      and (salary_value ->> 'from')::numeric >= 0
      and (salary_value ->> 'to')::numeric >= (salary_value ->> 'from')::numeric
      and coalesce(salary_value ->> 'currency', '') <> ''
      and salary_value ->> 'period' in ('month', 'year')
      and (
        salary_value -> 'confidence' is null
        or (
          jsonb_typeof(salary_value -> 'confidence') = 'number'
          and (salary_value ->> 'confidence')::numeric between 0 and 100
        )
      )
    )
  );

comment on column public.candidats.statut is
  'Professional availability, separate from any recruitment pipeline stage.';
comment on column public.candidats.salary_value is
  'Indicative AI salary range: from, to, currency, period, confidence, rationale and marketBasis.';
comment on column public.candidats.performance_score is
  'Evidence-based professional profile score from 0 to 100; never an automated hiring decision.';
comment on column public.candidats.performance is
  'Score breakdown, strengths, considerations and supporting evidence extracted from professional documents.';

alter table public.skills
  alter column importance drop default,
  alter column expertise drop default,
  alter column source drop default;

alter table public.skills
  alter column importance type public.skill_importance
  using (
    case lower(coalesce(importance::text, ''))
      when 'primary' then 'Primary'
      when 'bonus' then 'Bonus'
      else 'Secondary'
    end::public.skill_importance
  ),
  alter column expertise type public.skill_expertise
  using (
    case lower(coalesce(expertise::text, ''))
      when 'beginner' then 'Beginner'
      when 'junior' then 'Junior'
      when 'intermediate' then 'Intermediate'
      when 'advanced' then 'Advanced'
      when 'expert' then 'Expert'
      else null
    end::public.skill_expertise
  ),
  alter column source type public.skill_source
  using (
    case lower(coalesce(source::text, ''))
      when 'manual' then 'manual'
      when 'manual_text' then 'manual'
      when 'cover_letter' then 'cover_letter'
      when 'interview' then 'interview'
      when 'portfolio' then 'portfolio'
      when 'technical_test' then 'technical_test'
      when 'reference' then 'reference'
      when 'import' then 'import'
      when 'other' then 'other'
      else 'cv'
    end::public.skill_source
  );

alter table public.skills
  alter column importance set default 'Secondary'::public.skill_importance,
  alter column source set default 'cv'::public.skill_source,
  drop constraint if exists skills_score_range,
  add constraint skills_score_range check (score is null or score between 0 and 100);

alter table public.formations
  add column if not exists institution_name text,
  alter column issuer_date drop default,
  drop constraint if exists formations_confidence_score_range,
  add constraint formations_confidence_score_range
    check (confidence_score is null or confidence_score between 0 and 100);

comment on column public.formations.issuer_date is
  'Date on which the degree, certification or training credential was obtained.';
comment on column public.formations.institution_name is
  'Name of the institution that delivered the degree, certification or training.';

alter type public.type_section_chunks add value if not exists 'profile_summary';
alter type public.type_section_chunks add value if not exists 'professional_summary';
alter type public.type_section_chunks add value if not exists 'experience';
alter type public.type_section_chunks add value if not exists 'responsibility';
alter type public.type_section_chunks add value if not exists 'achievement';
alter type public.type_section_chunks add value if not exists 'project';
alter type public.type_section_chunks add value if not exists 'education';
alter type public.type_section_chunks add value if not exists 'certification';
alter type public.type_section_chunks add value if not exists 'training';
alter type public.type_section_chunks add value if not exists 'skill';
alter type public.type_section_chunks add value if not exists 'language';
alter type public.type_section_chunks add value if not exists 'industry';
alter type public.type_section_chunks add value if not exists 'salary';
alter type public.type_section_chunks add value if not exists 'contact';
alter type public.type_section_chunks add value if not exists 'document';
alter type public.type_section_chunks add value if not exists 'cover_letter';
alter type public.type_section_chunks add value if not exists 'portfolio';
alter type public.type_section_chunks add value if not exists 'interview_note';
alter type public.type_section_chunks add value if not exists 'other';

create index if not exists candidats_organisation_active_idx
  on public.candidats (organisation_id, created_at desc)
  where archived_at is null;

create index if not exists candidats_organisation_archived_idx
  on public.candidats (organisation_id, archived_at desc)
  where archived_at is not null;
