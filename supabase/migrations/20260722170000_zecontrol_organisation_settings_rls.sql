-- Browser-side settings CRUD for ZeControl.
-- Sensitive access fields remain unavailable to authenticated clients.

create or replace function zecontrol.can_read_organisation(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, zecontrol
as $$
  select exists (
    select 1
    from public.profiles as profile
    join zecontrol.profiles_configs as product_profile on product_profile.id = profile.id
    where profile.id = auth.uid()
      and profile.organisation_id = target_organisation_id
      and profile.is_active = true
      and product_profile.is_active = true
  );
$$;

create or replace function zecontrol.can_manage_organisation(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, zecontrol
as $$
  select exists (
    select 1
    from public.profiles as profile
    join zecontrol.profiles_configs as product_profile on product_profile.id = profile.id
    where profile.id = auth.uid()
      and profile.organisation_id = target_organisation_id
      and profile.is_active = true
      and product_profile.is_active = true
      and product_profile.role = 'owner'
  );
$$;

revoke all on function zecontrol.can_read_organisation(uuid) from public;
revoke all on function zecontrol.can_manage_organisation(uuid) from public;
grant execute on function zecontrol.can_read_organisation(uuid) to authenticated;
grant execute on function zecontrol.can_manage_organisation(uuid) to authenticated;

alter table public.organisations enable row level security;
alter table public.profiles enable row level security;
alter table zecontrol.orga_configs enable row level security;
alter table zecontrol.profiles_configs enable row level security;

drop policy if exists "zecontrol members read organisation" on public.organisations;
create policy "zecontrol members read organisation"
on public.organisations for select
to authenticated
using (zecontrol.can_read_organisation(id));

drop policy if exists "zecontrol owners update organisation identity" on public.organisations;
create policy "zecontrol owners update organisation identity"
on public.organisations for update
to authenticated
using (zecontrol.can_manage_organisation(id))
with check (zecontrol.can_manage_organisation(id));

drop policy if exists "zecontrol members read organisation config" on zecontrol.orga_configs;
create policy "zecontrol members read organisation config"
on zecontrol.orga_configs for select
to authenticated
using (zecontrol.can_read_organisation(id));

drop policy if exists "zecontrol owners update organisation config" on zecontrol.orga_configs;
create policy "zecontrol owners update organisation config"
on zecontrol.orga_configs for update
to authenticated
using (zecontrol.can_manage_organisation(id))
with check (zecontrol.can_manage_organisation(id));

drop policy if exists "zecontrol users update own shared profile" on public.profiles;
create policy "zecontrol users update own shared profile"
on public.profiles for update
to authenticated
using (id = auth.uid() and is_active = true)
with check (id = auth.uid() and is_active = true);

drop policy if exists "zecontrol users read own product profile" on zecontrol.profiles_configs;
create policy "zecontrol users read own product profile"
on zecontrol.profiles_configs for select
to authenticated
using (id = auth.uid() and is_active = true);

drop policy if exists "zecontrol users update own profile details" on zecontrol.profiles_configs;
create policy "zecontrol users update own profile details"
on zecontrol.profiles_configs for update
to authenticated
using (id = auth.uid() and is_active = true)
with check (id = auth.uid() and is_active = true);

grant usage on schema zecontrol to authenticated;
grant select on public.organisations, zecontrol.orga_configs, zecontrol.profiles_configs to authenticated;

-- Remove broad UPDATE privileges before granting only harmless settings columns.
revoke update on public.organisations from authenticated;
revoke update on public.profiles from authenticated;
revoke update on zecontrol.orga_configs from authenticated;
revoke update on zecontrol.profiles_configs from authenticated;

grant update (name, email, phone, website_url, description, logo_url, updated_at)
on public.organisations to authenticated;
grant update (fullname, phone, updated_at)
on public.profiles to authenticated;
grant update (lat, long, radius, updated_at)
on zecontrol.orga_configs to authenticated;
grant update (poste, service, updated_at)
on zecontrol.profiles_configs to authenticated;
