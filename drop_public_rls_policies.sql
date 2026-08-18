-- =============================================================================
-- REMOVE "ALLOW EVERYONE" RLS POLICIES — BATCH 1
-- =============================================================================
-- Run in the Supabase SQL Editor. Enabling RLS (already done, see
-- enable_rls_all_tables.sql) doesn't help if a policy on the table still says
-- "true" for role `public` — that role means *everyone*, including
-- unauthenticated anon requests, not "internal to our app." These are
-- exactly that: catch-all policies named "Enable all access" / "Allow all
-- (ICSS internal)" that grant full CRUD to anyone with the anon key (which
-- is already public in public/js/config.js).
--
-- SAFE TO RUN: your backend (src/db.js) connects with the service_role key,
-- which bypasses RLS/policies entirely — dropping these does not change
-- anything your own app can do. It only removes the public-internet hole.
-- Confirmed empirically: `clients` returned real names/emails via the plain
-- anon key before this; it should return [] after.
--
-- IDEMPOTENT: `DROP POLICY IF EXISTS` is safe to re-run.
--
-- STATUS (2026-08-18): run successfully. Verified externally via the public
-- REST endpoint — clients/companies/client_care_reports/accounting tables/
-- bulk-import tables all return [] to the anon key now. See
-- drop_public_rls_policies_batch2.sql for the second pass that caught
-- invoices, journals, vendors, etc.
-- =============================================================================

-- Core client-facing data
DROP POLICY IF EXISTS "Enable all access" ON public.clients;
DROP POLICY IF EXISTS "Enable all access" ON public.companies;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.client_care_reports;

-- Accounting ("ICSS internal" — never meant for anon, misnamed)
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.accounting_events;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.accounting_settings;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.capital_allowance_schedules;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.closed_periods;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.coa_accounts;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.consumed_events;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.depreciation_schedules;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.expense_records;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.fixed_assets;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.gct_config;

-- Bulk import / categorization
DROP POLICY IF EXISTS "Enable all for authenticated users or public depending on setup" ON public.auto_category_rules;
DROP POLICY IF EXISTS "Enable all for authenticated users or public depending on setup" ON public.bulk_import_line_postings;
DROP POLICY IF EXISTS "Enable all for authenticated users or public depending on setup" ON public.bulk_import_lines;
DROP POLICY IF EXISTS "Enable all for authenticated users or public depending on setup" ON public.bulk_imports;


-- ─────────────────────────────────────────────────────────────────────────────
-- DETECT ANY REMAINING "ALLOW EVERYONE" POLICIES (e.g. invoices, leads,
-- reviews, link_hub, contracts — tables not visible in the last pasted batch)
-- ─────────────────────────────────────────────────────────────────────────────
-- Anything this returns still needs its policy identified and dropped the
-- same way as above. `public` in the roles column is the tell — real access
-- control uses {authenticated} plus an auth.uid()/company-role check, not a
-- bare `true` open to `public`.
SELECT
  tablename,
  policyname,
  roles,
  cmd,
  qual AS using_clause,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND 'public' = ANY(roles)
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename;
