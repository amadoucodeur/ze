-- Every candidate is attributed to the authenticated organisation member who created it.

alter table public.candidats
  add column if not exists created_by uuid;

alter table public.candidats
  drop constraint if exists candidats_created_by_fkey,
  add constraint candidats_created_by_fkey
    foreign key (created_by)
    references public.profiles(id)
    on delete restrict;

-- Records created before this column existed have no reliable author trace.
-- Attribute them to the active organisation owner (then admin/recruiter as a
-- deterministic fallback) before enforcing attribution for every new record.
update public.candidats as candidate
set created_by = (
  select profile.id
  from public.profiles as profile
  where profile.organisation_id = candidate.organisation_id
    and profile.is_active = true
  order by
    case profile.role::text
      when 'owner' then 0
      when 'admin' then 1
      when 'recruiter' then 2
      else 3
    end,
    profile.id
  limit 1
)
where candidate.created_by is null;

do $$
begin
  if exists (select 1 from public.candidats where created_by is null) then
    raise exception 'Some candidates belong to an organisation without an active profile; activate or create an organisation member before retrying.';
  end if;
end $$;

create or replace function public.enforce_candidate_creator_organisation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  creator_organisation_id uuid;
begin
  if new.created_by is null then
    raise exception 'candidate creator is required';
  end if;

  select organisation_id
  into creator_organisation_id
  from public.profiles
  where id = new.created_by
    and is_active = true;

  if creator_organisation_id is null or creator_organisation_id <> new.organisation_id then
    raise exception 'candidate creator must be an active member of the candidate organisation';
  end if;

  return new;
end;
$$;

drop trigger if exists candidats_creator_organisation_guard on public.candidats;
create trigger candidats_creator_organisation_guard
before insert or update of created_by, organisation_id
on public.candidats
for each row
execute function public.enforce_candidate_creator_organisation();

alter table public.candidats
  alter column created_by set not null;

create index if not exists candidats_organisation_creator_idx
  on public.candidats (organisation_id, created_by, created_at desc);

comment on column public.candidats.created_by is
  'Profile id of the active organisation member who originally added the candidate.';
