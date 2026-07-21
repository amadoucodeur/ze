-- Keep semantic indexing intentionally small and high-signal. Structured
-- skills, languages and contacts remain in their dedicated relational tables.

delete from public.section_chunks
where type::text in (
  'contact',
  'salary',
  'skill',
  'language',
  'industry',
  'professional_summary'
);

with duplicate_summaries as (
  select id,
    row_number() over (
      partition by candidat_id
      order by created_at desc, id desc
    ) as summary_rank
  from public.section_chunks
  where type::text = 'profile_summary'
)
delete from public.section_chunks as chunk
using duplicate_summaries as duplicate
where chunk.id = duplicate.id
  and duplicate.summary_rank > 1;

with ranked_chunks as (
  select id,
    row_number() over (
      partition by candidat_id
      order by
        case type::text
          when 'profile_summary' then 110
          when 'achievement' then 100
          when 'experience' then 95
          when 'project' then 90
          when 'responsibility' then 85
          when 'portfolio' then 80
          when 'certification' then 75
          when 'education' then 70
          when 'training' then 65
          when 'document' then 55
          when 'cover_letter' then 50
          when 'interview_note' then 45
          else 35
        end desc,
        created_at desc,
        id desc
    ) as chunk_rank
  from public.section_chunks
)
delete from public.section_chunks as chunk
using ranked_chunks as ranked
where chunk.id = ranked.id
  and ranked.chunk_rank > 6;

comment on table public.section_chunks is
  'High-signal semantic evidence. At most six chunks are generated per candidate by the application.';
