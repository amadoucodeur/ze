-- Organisation time reference and client-side logo upload.
-- The storage path always starts with the organisation UUID so RLS can
-- validate ownership without exposing service-role operations to the client.

alter table zecontrol.orga_configs
  add column if not exists timezone text not null default 'Africa/Abidjan';

grant update (timezone) on zecontrol.orga_configs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organisation-logos',
  'organisation-logos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "zecontrol owners upload organisation logos" on storage.objects;
create policy "zecontrol owners upload organisation logos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'organisation-logos'
  and (storage.foldername(name))[1] is not null
  and zecontrol.can_manage_organisation(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "zecontrol owners update organisation logos" on storage.objects;
create policy "zecontrol owners update organisation logos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'organisation-logos'
  and (storage.foldername(name))[1] is not null
  and zecontrol.can_manage_organisation(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'organisation-logos'
  and (storage.foldername(name))[1] is not null
  and zecontrol.can_manage_organisation(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "zecontrol owners delete organisation logos" on storage.objects;
create policy "zecontrol owners delete organisation logos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'organisation-logos'
  and (storage.foldername(name))[1] is not null
  and zecontrol.can_manage_organisation(((storage.foldername(name))[1])::uuid)
);

notify pgrst, 'reload schema';
