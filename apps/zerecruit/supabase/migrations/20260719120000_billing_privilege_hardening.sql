-- Make the intended billing privileges explicit even when project-wide default
-- grants change: no anonymous access, owner-only reads through RLS, server-only writes.

revoke all on public.billing_payments from anon, authenticated;
grant select on public.billing_payments to authenticated;
