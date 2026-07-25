-- Allow authenticated ZeControl dashboards to receive event changes through
-- Supabase Realtime. Row-level security on zecontrol.events remains authoritative.

alter table zecontrol.events replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'zecontrol'
      and tablename = 'events'
  ) then
    alter publication supabase_realtime add table zecontrol.events;
  end if;
end
$$;
