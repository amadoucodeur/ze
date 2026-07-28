-- Profile settings span the shared ZeSuite identity and the ZeControl product
-- profile. Keep the write atomic while exposing only four harmless fields.
-- The authenticated user id is always read from the JWT and cannot be supplied
-- by the client.

create or replace function zecontrol.update_own_profile_settings(
  new_fullname text,
  new_phone text,
  new_poste text,
  new_service text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, zecontrol
as $$
declare
  actor_id uuid := auth.uid();
  clean_fullname text := btrim(coalesce(new_fullname, ''));
  clean_phone text := nullif(btrim(coalesce(new_phone, '')), '');
  clean_poste text := nullif(btrim(coalesce(new_poste, '')), '');
  clean_service text := nullif(btrim(coalesce(new_service, '')), '');
begin
  if actor_id is null then
    raise exception 'profile_settings_authentication_required';
  end if;

  if char_length(clean_fullname) < 2 or char_length(clean_fullname) > 100 then
    raise exception 'profile_settings_fullname_invalid';
  end if;

  if char_length(coalesce(clean_phone, '')) > 30
    or char_length(coalesce(clean_poste, '')) > 100
    or char_length(coalesce(clean_service, '')) > 100 then
    raise exception 'profile_settings_value_too_long';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    inner join zecontrol.profiles_configs as config
      on config.id = profile.id
    where profile.id = actor_id
      and profile.is_active = true
      and config.is_active = true
  ) then
    raise exception 'profile_settings_access_denied';
  end if;

  update public.profiles
  set fullname = clean_fullname,
      phone = clean_phone,
      updated_at = clock_timestamp()
  where id = actor_id;

  update zecontrol.profiles_configs
  set poste = clean_poste,
      service = clean_service,
      updated_at = clock_timestamp()
  where id = actor_id;

  return jsonb_build_object(
    'fullname', clean_fullname,
    'phone', clean_phone,
    'poste', clean_poste,
    'service', clean_service
  );
end;
$$;

revoke all on function zecontrol.update_own_profile_settings(text, text, text, text) from public;
revoke all on function zecontrol.update_own_profile_settings(text, text, text, text) from anon;
grant execute on function zecontrol.update_own_profile_settings(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
