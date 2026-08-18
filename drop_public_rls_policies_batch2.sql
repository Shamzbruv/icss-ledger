-- =============================================================================
-- REMOVE "ALLOW EVERYONE" RLS POLICIES — BATCH 2
-- =============================================================================
-- Same issue as the first batch (clients, companies, accounting_*, etc.):
-- each of these tables has a catch-all policy granting role `public` (i.e.
-- anyone, including unauthenticated anon requests) full CRUD. All ten are
-- confirmed as ICSS Command Center's own tables (grepped for in src/), so
-- this is safe the same way the first batch was: your backend uses the
-- service_role key and bypasses RLS/policies entirely.
--
-- STATUS (2026-08-18): run successfully. Verified externally via the public
-- REST endpoint — invoices/invoice_items/journals/journal_lines/
-- monthly_pulse_summaries/owner_pack_reports/tax_pack_reports/
-- tax_policy_store/vendors/vendor_aliases all return [] to the anon key now.
--
-- Remaining rows returned by the verify query below belong to a different
-- app sharing this same Supabase project (hm_* HR/payroll tables, a church/
-- community app: church_locations, study_groups, community_posts, events,
-- comments, group_messages, attendance, priority_follow_ups, users,
-- public_holidays) — confirmed with the user, left untouched intentionally.
-- Two are still worth that app's owner looking at: hm_audit_log lets role
-- `public` INSERT audit-log rows (anyone can forge entries), and
-- study_groups lets role `public` UPDATE any group (not just members,
-- despite the policy name) — neither is this codebase's to fix.
-- =============================================================================

DROP POLICY IF EXISTS "Enable all access" ON public.invoice_items;
DROP POLICY IF EXISTS "Enable all access" ON public.invoices;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.journal_lines;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.journals;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.monthly_pulse_summaries;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.owner_pack_reports;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.tax_pack_reports;
DROP POLICY IF EXISTS "Allow all (ICSS internal)" ON public.tax_policy_store;
DROP POLICY IF EXISTS "Enable all for authenticated users or public depending on setup" ON public.vendor_aliases;
DROP POLICY IF EXISTS "Enable all for authenticated users or public depending on setup" ON public.vendors;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY — should return 0 rows for anything under this app's ownership.
-- Rows belonging to the other app (hm_*, church/community tables) are
-- expected and untouched — see the note below.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT tablename, policyname, roles, cmd, qual AS using_clause, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND 'public' = ANY(roles)
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename;
