-- Active organisation members may read only candidates from their own tenant.
-- This enables safe client-side collection joins without exposing another
-- organisation's candidate records.

alter table public.candidats enable row level security;

drop policy if exists "Active members read organisation candidates" on public.candidats;
create policy "Active members read organisation candidates"
on public.candidats for select
to authenticated
using (organisation_id = public.current_active_organisation_id());

grant select on public.candidats to authenticated;
