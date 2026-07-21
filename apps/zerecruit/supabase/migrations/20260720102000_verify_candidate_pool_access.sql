-- One-time assertion on populated environments: an active member can execute
-- the client RPC under the authenticated role. Empty fresh databases skip it.

do $verification$
declare
  member_id uuid;
  visible_rows integer;
  migration_role text := current_user;
begin
  select profile.id
  into member_id
  from public.profiles as profile
  join public.organisations as organisation on organisation.id = profile.organisation_id
  join public.candidats as candidate on candidate.organisation_id = profile.organisation_id
  where profile.is_active = true
    and organisation.status = 'active'
  limit 1;

  if member_id is null then
    return;
  end if;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', member_id::text, 'role', 'authenticated')::text,
    true
  );

  execute 'set local role authenticated';
  select count(*) into visible_rows
  from public.search_candidate_pool(p_limit => 1);
  execute format('set local role %I', migration_role);

  if visible_rows <> 1 then
    raise exception 'candidate_pool_authenticated_access_verification_failed';
  end if;
end
$verification$;
