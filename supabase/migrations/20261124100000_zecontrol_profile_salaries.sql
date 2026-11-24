-- Salaire mensuel net d'un collaborateur ZeControl, utilisé pour chiffrer
-- les déductions liées aux retards d'arrivée dans les rapports.
-- Donnée sensible : lecture réservée aux gestionnaires (owner, admin) de
-- l'organisation ; écriture uniquement par les actions serveur (service role).

create table if not exists zecontrol.profile_salaries (
  profile_id uuid primary key references zecontrol.profiles_configs (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  monthly_net_salary numeric(14, 0) not null check (monthly_net_salary >= 0),
  currency text not null default 'XOF' check (currency = 'XOF'),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profile_salaries_organisation_idx
  on zecontrol.profile_salaries (organisation_id);

create or replace function zecontrol.can_view_salaries(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as actor_profile
    join zecontrol.profiles_configs as actor_config
      on actor_config.id = actor_profile.id
    where actor_profile.id = auth.uid()
      and actor_profile.organisation_id = target_organisation_id
      and actor_profile.is_active = true
      and actor_config.is_active = true
      and actor_config.role in ('owner', 'admin')
  );
$$;

revoke all on function zecontrol.can_view_salaries(uuid) from public, anon, authenticated;
grant execute on function zecontrol.can_view_salaries(uuid) to authenticated;

alter table zecontrol.profile_salaries enable row level security;

drop policy if exists "zecontrol managers read salaries" on zecontrol.profile_salaries;
create policy "zecontrol managers read salaries"
on zecontrol.profile_salaries for select
to authenticated
using (zecontrol.can_view_salaries(organisation_id));

revoke all on zecontrol.profile_salaries from public, anon, authenticated;
grant select on zecontrol.profile_salaries to authenticated;

notify pgrst, 'reload schema';
