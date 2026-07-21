-- Tenant-safe, client-side pagination for the candidate pool. The function
-- exposes only fields already visible to active organisation members and never
-- trusts an organisation id supplied by the browser.

create or replace function public.search_candidate_pool(
  p_archived boolean default false,
  p_query text default '',
  p_availability text default '',
  p_location text default '',
  p_skill text default '',
  p_language text default '',
  p_industry text default '',
  p_min_score integer default null,
  p_sort text default 'recent',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  fullname text,
  poste_type text,
  localisation text,
  summary text,
  statut text,
  performance_score integer,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  industries jsonb,
  skills jsonb,
  languages jsonb,
  creator_name text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select candidate.*
    from public.candidats as candidate
    where candidate.organisation_id = public.current_active_organisation_id()
      and case when p_archived then candidate.archived_at is not null else candidate.archived_at is null end
      and (coalesce(trim(p_availability), '') = '' or candidate.statut::text = trim(p_availability))
      and (coalesce(trim(p_location), '') = '' or coalesce(candidate.localisation, '') ilike '%' || trim(p_location) || '%')
      and (
        coalesce(trim(p_skill), '') = ''
        or exists (
          select 1 from public.skills as skill
          where skill.candidat_id = candidate.id
            and skill.name ilike '%' || trim(p_skill) || '%'
        )
      )
      and (
        coalesce(trim(p_language), '') = ''
        or exists (
          select 1 from public.languages as language
          where language.candidat_id = candidate.id
            and language.name ilike '%' || trim(p_language) || '%'
        )
      )
      and (
        coalesce(trim(p_industry), '') = ''
        or exists (
          select 1 from jsonb_array_elements_text(coalesce(candidate.industries, '[]'::jsonb)) as industry(value)
          where industry.value ilike '%' || trim(p_industry) || '%'
        )
      )
      and (p_min_score is null or coalesce(candidate.performance_score, 0) >= greatest(0, least(100, p_min_score)))
      and not exists (
        select 1
        from regexp_split_to_table(coalesce(trim(p_query), ''), '\s+') as query_term(value)
        where query_term.value <> ''
          and not (
            concat_ws(' ', candidate.fullname, candidate.poste_type, candidate.localisation, candidate.summary) ilike '%' || query_term.value || '%'
            or exists (
              select 1 from jsonb_array_elements_text(coalesce(candidate.industries, '[]'::jsonb)) as industry(value)
              where industry.value ilike '%' || query_term.value || '%'
            )
            or exists (
              select 1 from public.skills as skill
              where skill.candidat_id = candidate.id
                and concat_ws(' ', skill.name, skill.expertise::text) ilike '%' || query_term.value || '%'
            )
            or exists (
              select 1 from public.languages as language
              where language.candidat_id = candidate.id
                and concat_ws(' ', language.name, language.level::text) ilike '%' || query_term.value || '%'
            )
          )
      )
  )
  select
    candidate.id,
    candidate.fullname,
    candidate.poste_type,
    candidate.localisation,
    candidate.summary,
    candidate.statut::text,
    candidate.performance_score,
    candidate.archived_at,
    candidate.created_by,
    candidate.created_at,
    coalesce(candidate.industries, '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('name', skill.name, 'expertise', skill.expertise) order by skill.score desc nulls last, skill.name)
      from public.skills as skill
      where skill.candidat_id = candidate.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('name', language.name, 'level', language.level) order by language.name)
      from public.languages as language
      where language.candidat_id = candidate.id
    ), '[]'::jsonb),
    coalesce((select profile.fullname from public.profiles as profile where profile.id = candidate.created_by), 'un membre de l’équipe'),
    count(*) over ()
  from filtered as candidate
  order by
    case when p_sort = 'score' then candidate.performance_score end desc nulls last,
    case when p_sort = 'name' then candidate.fullname end asc,
    case when p_sort not in ('score', 'name') then candidate.created_at end desc,
    candidate.created_at desc
  limit greatest(1, least(50, coalesce(p_limit, 24)))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_candidate_pool(boolean, text, text, text, text, text, text, integer, text, integer, integer) from public;
grant execute on function public.search_candidate_pool(boolean, text, text, text, text, text, text, integer, text, integer, integer) to authenticated;

comment on function public.search_candidate_pool(boolean, text, text, text, text, text, text, integer, text, integer, integer) is
  'Paginated candidate-pool search scoped from the authenticated active profile; the browser never supplies an organisation id.';
