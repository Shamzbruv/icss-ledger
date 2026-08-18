-- =============================================================================
-- ENABLE ROW LEVEL SECURITY ON EVERY TABLE IN THE PUBLIC SCHEMA
-- =============================================================================
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- WHY: Any table without RLS is fully readable/writable by anyone on the
-- internet via Supabase's public REST API, using nothing but the anon key —
-- which is already public in public/js/config.js (that's normal for Supabase,
-- RLS is the thing that's supposed to make it safe). Confirmed live and
-- exposed: `clients` (real names + emails came back with zero auth).
--
-- WHY IT'S SAFE TO RUN: this backend (src/db.js) always connects with
-- SUPABASE_SERVICE_KEY when it's set, and the service_role key bypasses RLS
-- entirely. Nothing your own app does will break. This only blocks the public
-- anon/PostgREST path that your frontend never actually uses (it talks to
-- your own /api/* backend instead, confirmed by searching public/*.html and
-- public/js/* for direct `.from(...)` table queries — there are none).
--
-- IDEMPOTENT: enabling RLS on a table that already has it is a harmless no-op,
-- so this is safe to run more than once, and safe even where fix_rls.sql or
-- sync_contracts_schema.sql already covered a given table.
--
-- NOTE (2026-08-18): running this alone was NOT enough — several tables had
-- RLS enabled but still leaked data because a pre-existing policy granted
-- role `public` (= everyone, including anon) full access regardless. See
-- drop_public_rls_policies.sql and drop_public_rls_policies_batch2.sql for
-- the follow-up that actually closed the hole.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY — should return zero rows once this has run successfully.
-- Anything listed here still has no RLS (e.g. a table created after this ran).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT tablename
FROM pg_tables t
WHERE schemaname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = t.tablename AND c.relrowsecurity
  );
