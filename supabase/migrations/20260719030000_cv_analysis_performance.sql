-- Faster CV analysis persistence, privacy-safe timings and duplicate detection.

alter table public.candidats
  add column if not exists source_fingerprint text,
  add column if not exists analysis_version text,
  add column if not exists analysis_metrics jsonb not null default '{}'::jsonb,
  add column if not exists processing_status text not null default 'ready',
  add column if not exists indexed_at timestamptz;

alter table public.candidats
  drop constraint if exists candidats_analysis_metrics_object,
  add constraint candidats_analysis_metrics_object
    check (jsonb_typeof(analysis_metrics) = 'object'),
  drop constraint if exists candidats_processing_status_values,
  add constraint candidats_processing_status_values
    check (processing_status in ('indexing', 'ready', 'failed'));

create index if not exists candidats_organisation_fingerprint_idx
  on public.candidats (organisation_id, source_fingerprint, created_at desc)
  where source_fingerprint is not null and archived_at is null;

comment on column public.candidats.source_fingerprint is
  'Organisation-scoped SHA-256 fingerprint of normalized source text and parser version. The source text is never stored here.';
comment on column public.candidats.analysis_metrics is
  'Privacy-safe parser, embedding and persistence timings. Never contains CV text, names or contact details.';
comment on column public.candidats.processing_status is
  'Search preparation state. The structured candidate remains usable while indexing or after an indexing failure.';

create or replace function public.insert_candidate_analysis_relations_v1(
  p_candidate_id uuid,
  p_organisation_id uuid,
  p_chunks jsonb,
  p_skills jsonb,
  p_languages jsonb,
  p_formations jsonb,
  p_existing_skill_sources jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  entry jsonb;
  selected_source text;
begin
  for entry in select value from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb))
  loop
    insert into public.section_chunks (
      candidat_id, organisation_id, content, type, embedding_model, embedding
    ) values (
      p_candidate_id,
      p_organisation_id,
      entry ->> 'content',
      (entry ->> 'type')::public.type_section_chunks,
      entry ->> 'embedding_model',
      (entry ->> 'embedding')::extensions.vector
    );
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(p_skills, '[]'::jsonb))
  loop
    selected_source := coalesce(
      p_existing_skill_sources ->> lower(trim(entry ->> 'name')),
      entry ->> 'source',
      'cv'
    );
    insert into public.skills (
      candidat_id, name, importance, source, score,
      nb_month_of_experiance, expertise, industry
    ) values (
      p_candidate_id,
      entry ->> 'name',
      coalesce(entry ->> 'importance', 'Secondary')::public.skill_importance,
      selected_source::public.skill_source,
      (entry ->> 'score')::numeric,
      nullif(entry ->> 'nb_month_of_experiance', '')::numeric,
      nullif(entry ->> 'expertise', '')::public.skill_expertise,
      nullif(entry ->> 'industry', '')
    );
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(p_languages, '[]'::jsonb))
  loop
    insert into public.languages (candidat_id, organisation_id, name, level)
    values (
      p_candidate_id,
      p_organisation_id,
      entry ->> 'name',
      nullif(entry ->> 'level', '')::public.language_level
    );
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(p_formations, '[]'::jsonb))
  loop
    insert into public.formations (
      candidat_id, organisation_id, name, institution_name, issuer_date,
      type, field_of_study, adresse, description, start_date, end_date,
      nb_training_months, confidence_score
    ) values (
      p_candidate_id,
      p_organisation_id,
      entry ->> 'name',
      nullif(entry ->> 'institution_name', ''),
      nullif(entry ->> 'issuer_date', '')::timestamptz,
      coalesce(entry ->> 'type', 'training')::public.type_formation,
      nullif(entry ->> 'field_of_study', ''),
      nullif(entry ->> 'adresse', ''),
      nullif(entry ->> 'description', ''),
      nullif(entry ->> 'start_date', '')::date,
      nullif(entry ->> 'end_date', '')::date,
      nullif(entry ->> 'nb_training_months', '')::numeric,
      (entry ->> 'confidence_score')::numeric
    );
  end loop;
end;
$$;

create or replace function public.persist_candidate_analysis_v1(
  p_organisation_id uuid,
  p_created_by uuid,
  p_candidate jsonb,
  p_chunks jsonb,
  p_skills jsonb,
  p_languages jsonb,
  p_formations jsonb,
  p_source_fingerprint text default null,
  p_analysis_version text default null,
  p_analysis_metrics jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  candidate_id uuid;
begin
  if not exists (
    select 1
    from public.profiles as profile
    join public.organisations as organisation on organisation.id = profile.organisation_id
    where profile.id = p_created_by
      and profile.organisation_id = p_organisation_id
      and profile.is_active = true
      and organisation.status = 'active'
  ) then
    raise exception 'active organisation member is required';
  end if;

  insert into public.candidats (
    organisation_id, created_by, fullname, poste_type, localisation, summary,
    contacts, industries, weakness, source, statut, salary_value,
    performance_score, performance, embedding_model, source_fingerprint,
    analysis_version, analysis_metrics, indexed_at
  ) values (
    p_organisation_id,
    p_created_by,
    coalesce(nullif(p_candidate ->> 'fullname', ''), 'Candidat à identifier'),
    nullif(p_candidate ->> 'poste_type', ''),
    nullif(p_candidate ->> 'localisation', ''),
    nullif(p_candidate ->> 'summary', ''),
    coalesce(p_candidate -> 'contacts', '{}'::jsonb),
    coalesce(p_candidate -> 'industries', '[]'::jsonb),
    coalesce(p_candidate -> 'weakness', '[]'::jsonb),
    nullif(p_candidate ->> 'source', ''),
    coalesce(p_candidate ->> 'statut', 'unknown')::public.candidate_availability,
    case when jsonb_typeof(p_candidate -> 'salary_value') = 'object' then p_candidate -> 'salary_value' else null end,
    (p_candidate ->> 'performance_score')::smallint,
    p_candidate -> 'performance',
    p_candidate ->> 'embedding_model',
    p_source_fingerprint,
    p_analysis_version,
    coalesce(p_analysis_metrics, '{}'::jsonb),
    now()
  )
  returning id into candidate_id;

  perform public.insert_candidate_analysis_relations_v1(
    candidate_id, p_organisation_id, p_chunks, p_skills, p_languages, p_formations
  );
  return candidate_id;
end;
$$;

create or replace function public.update_candidate_analysis_v1(
  p_candidate_id uuid,
  p_organisation_id uuid,
  p_candidate jsonb,
  p_chunks jsonb,
  p_skills jsonb,
  p_languages jsonb,
  p_formations jsonb,
  p_analysis_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing_skill_sources jsonb;
begin
  if not exists (
    select 1 from public.candidats
    where id = p_candidate_id and organisation_id = p_organisation_id
    for update
  ) then
    raise exception 'candidate not found in organisation';
  end if;

  select coalesce(jsonb_object_agg(lower(trim(name)), source::text), '{}'::jsonb)
  into existing_skill_sources
  from public.skills
  where candidat_id = p_candidate_id;

  delete from public.section_chunks where candidat_id = p_candidate_id;
  delete from public.skills where candidat_id = p_candidate_id;
  delete from public.languages where candidat_id = p_candidate_id;
  delete from public.formations where candidat_id = p_candidate_id;

  perform public.insert_candidate_analysis_relations_v1(
    p_candidate_id,
    p_organisation_id,
    p_chunks,
    p_skills,
    p_languages,
    p_formations,
    existing_skill_sources
  );

  update public.candidats
  set fullname = coalesce(nullif(p_candidate ->> 'fullname', ''), fullname),
      poste_type = nullif(p_candidate ->> 'poste_type', ''),
      localisation = nullif(p_candidate ->> 'localisation', ''),
      summary = nullif(p_candidate ->> 'summary', ''),
      contacts = coalesce(p_candidate -> 'contacts', '{}'::jsonb),
      industries = coalesce(p_candidate -> 'industries', '[]'::jsonb),
      weakness = coalesce(p_candidate -> 'weakness', '[]'::jsonb),
      statut = coalesce(p_candidate ->> 'statut', 'unknown')::public.candidate_availability,
      salary_value = case when jsonb_typeof(p_candidate -> 'salary_value') = 'object' then p_candidate -> 'salary_value' else null end,
      performance_score = (p_candidate ->> 'performance_score')::smallint,
      performance = p_candidate -> 'performance',
      embedding_model = p_candidate ->> 'embedding_model',
      analysis_version = p_analysis_version,
      indexed_at = now(),
      updated_at = now()
  where id = p_candidate_id and organisation_id = p_organisation_id;

  return p_candidate_id;
end;
$$;

create or replace function public.persist_candidate_core_v1(
  p_organisation_id uuid,
  p_created_by uuid,
  p_candidate jsonb,
  p_chunks jsonb,
  p_skills jsonb,
  p_languages jsonb,
  p_formations jsonb,
  p_source_fingerprint text default null,
  p_analysis_version text default null,
  p_analysis_metrics jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  candidate_id uuid;
begin
  candidate_id := public.persist_candidate_analysis_v1(
    p_organisation_id,
    p_created_by,
    p_candidate,
    p_chunks,
    p_skills,
    p_languages,
    p_formations,
    p_source_fingerprint,
    p_analysis_version,
    p_analysis_metrics
  );
  update public.candidats
  set processing_status = 'indexing', indexed_at = null
  where id = candidate_id and organisation_id = p_organisation_id;
  return candidate_id;
end;
$$;

create or replace function public.finalize_candidate_indexing_v1(
  p_candidate_id uuid,
  p_organisation_id uuid,
  p_chunks jsonb,
  p_analysis_metrics jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.candidats
    where id = p_candidate_id and organisation_id = p_organisation_id
    for update
  ) then
    raise exception 'candidate not found in organisation';
  end if;

  delete from public.section_chunks where candidat_id = p_candidate_id;
  perform public.insert_candidate_analysis_relations_v1(
    p_candidate_id,
    p_organisation_id,
    p_chunks,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  );
  update public.candidats
  set processing_status = 'ready',
      indexed_at = now(),
      analysis_metrics = analysis_metrics || coalesce(p_analysis_metrics, '{}'::jsonb),
      updated_at = now()
  where id = p_candidate_id and organisation_id = p_organisation_id;
  return p_candidate_id;
end;
$$;

create or replace function public.mark_candidate_indexing_failed_v1(
  p_candidate_id uuid,
  p_organisation_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.candidats
  set processing_status = 'failed', updated_at = now()
  where id = p_candidate_id and organisation_id = p_organisation_id;
$$;

revoke all on function public.insert_candidate_analysis_relations_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persist_candidate_analysis_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.update_candidate_analysis_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.persist_candidate_core_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_candidate_indexing_v1(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.mark_candidate_indexing_failed_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.persist_candidate_analysis_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb) to service_role;
grant execute on function public.update_candidate_analysis_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.persist_candidate_core_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, jsonb) to service_role;
grant execute on function public.finalize_candidate_indexing_v1(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.mark_candidate_indexing_failed_v1(uuid, uuid) to service_role;
