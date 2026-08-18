-- Read-only: lists every RLS policy on every table in the public schema.
-- Run this in the Supabase SQL Editor. We're looking for any policy whose
-- `roles` includes anon/public and whose `qual` (USING clause) is permissive
-- (e.g. "true") — that's what's still letting clients/invoices leak despite
-- RLS being enabled.
--
-- NOTE (2026-08-18): this project's Supabase org hosts more than one app on
-- the same database — ICSS Command Center's own tables plus at least one
-- other product (HR/payroll `hm_*` tables, a church/community app). This
-- query returns rows from all of them; only fix policies on tables this
-- codebase actually owns (see drop_public_rls_policies*.sql for the list
-- confirmed via grep against src/).
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd AS applies_to,
  qual AS using_clause,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
