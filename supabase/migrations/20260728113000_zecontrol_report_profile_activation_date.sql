-- Reporting needs the ZeControl activation date to avoid counting planned days
-- before a collaborator actually joined the product.

drop function if exists zecontrol.list_report_profiles(uuid);

create function zecontrol.list_report_profiles(
  target_organisation_id uuid
)
returns table (
  id uuid,
  fullname text,
  identifiant text,
  role text,
  is_active boolean,
  activated_at timestamptz,
  poste text,
  service text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_profile.id,
    target_profile.fullname,
    target_profile.identifiant,
    target_config.role::text,
    target_config.is_active,
    target_config.created_at,
    target_config.poste,
    target_config.service
  from public.profiles as target_profile
  join zecontrol.profiles_configs as target_config
    on target_config.id = target_profile.id
  where target_profile.organisation_id = target_organisation_id
    and target_profile.is_active = true
    and target_config.is_active = true
    and exists (
      select 1
      from public.profiles as actor_profile
      join zecontrol.profiles_configs as actor_config
        on actor_config.id = actor_profile.id
      where actor_profile.id = auth.uid()
        and actor_profile.organisation_id = target_organisation_id
        and actor_profile.is_active = true
        and actor_config.is_active = true
        and actor_config.role in ('owner', 'admin')
    )
  order by target_profile.fullname, target_profile.id;
$$;

revoke all on function zecontrol.list_report_profiles(uuid)
from public, anon, authenticated;

grant usage on schema zecontrol to authenticated;
grant execute on function zecontrol.list_report_profiles(uuid)
to authenticated;

notify pgrst, 'reload schema';
