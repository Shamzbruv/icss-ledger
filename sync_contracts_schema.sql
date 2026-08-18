-- =============================================================================
-- CONTRACTS TABLE — Full Sync Migration for Supabase
-- =============================================================================
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- This script is IDEMPOTENT — safe to run multiple times.
-- It creates the table if missing, adds any missing columns, recreates indexes,
-- and sets up RLS policies so the backend (service_role key) has full access
-- while the public (anon key) cannot access contracts directly.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Create the table if it doesn't exist
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Lifecycle: draft -> sent -> viewed -> signed  (or -> void at any point before signing)
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'void')),
  sign_token VARCHAR(64) NOT NULL,
  agreement_reference VARCHAR(50),
  contract_version VARCHAR(20) DEFAULT 'v1',

  -- Client
  client_name VARCHAR(255) NOT NULL,
  business_name VARCHAR(255),
  client_email VARCHAR(255) NOT NULL,
  client_phone VARCHAR(50),

  -- Project
  project_type VARCHAR(150),
  project_description TEXT,

  -- Financials (the fields the admin customizes per client before sending)
  currency VARCHAR(10) NOT NULL DEFAULT 'JMD',
  project_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_percent NUMERIC(5,2) NOT NULL DEFAULT 50,
  payment_arrangement TEXT,

  -- Company signer — auto-applied so every contract goes out already "signed" by the Company
  company_signer_name VARCHAR(150) DEFAULT 'S. Baker',
  company_signature_path VARCHAR(255) DEFAULT '/assets/signature.png',
  company_signed_at TIMESTAMPTZ,

  -- Lifecycle timestamps
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  void_at TIMESTAMPTZ,

  -- Client's electronic signature
  signature_type VARCHAR(20) CHECK (signature_type IS NULL OR signature_type IN ('drawn', 'typed')),
  signature_data TEXT,                 -- base64 PNG data URL (drawn) or the typed name (typed)
  signer_legal_name VARCHAR(255),
  signer_ip VARCHAR(64),
  signer_user_agent TEXT,

  acknowledgements JSONB DEFAULT '{}', -- { deposit_ack, variable_pricing_ack, key_clauses_ack, signature_confirmation }

  -- Frozen snapshot of the figures the client actually saw/signed, so later edits to the
  -- live template or a since-edited draft never retroactively change an already-sent agreement.
  terms_snapshot_json JSONB
);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Add any missing columns (safe — uses IF NOT EXISTS / DO blocks)
-- ─────────────────────────────────────────────────────────────────────────────
-- This handles the case where the table existed but was missing newer columns.

DO $$
BEGIN
  -- Core identity
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='id') THEN
    RAISE NOTICE 'Table contracts is missing id — this should not happen. Recreate the table.';
  END IF;

  -- Timestamps
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='created_at') THEN
    ALTER TABLE contracts ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='updated_at') THEN
    ALTER TABLE contracts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Status & tokens
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='status') THEN
    ALTER TABLE contracts ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='sign_token') THEN
    ALTER TABLE contracts ADD COLUMN sign_token VARCHAR(64) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='agreement_reference') THEN
    ALTER TABLE contracts ADD COLUMN agreement_reference VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='contract_version') THEN
    ALTER TABLE contracts ADD COLUMN contract_version VARCHAR(20) DEFAULT 'v1';
  END IF;

  -- Client fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='client_name') THEN
    ALTER TABLE contracts ADD COLUMN client_name VARCHAR(255) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='business_name') THEN
    ALTER TABLE contracts ADD COLUMN business_name VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='client_email') THEN
    ALTER TABLE contracts ADD COLUMN client_email VARCHAR(255) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='client_phone') THEN
    ALTER TABLE contracts ADD COLUMN client_phone VARCHAR(50);
  END IF;

  -- Project fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='project_type') THEN
    ALTER TABLE contracts ADD COLUMN project_type VARCHAR(150);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='project_description') THEN
    ALTER TABLE contracts ADD COLUMN project_description TEXT;
  END IF;

  -- Financials
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='currency') THEN
    ALTER TABLE contracts ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'JMD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='project_cost') THEN
    ALTER TABLE contracts ADD COLUMN project_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='deposit_percent') THEN
    ALTER TABLE contracts ADD COLUMN deposit_percent NUMERIC(5,2) NOT NULL DEFAULT 50;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='payment_arrangement') THEN
    ALTER TABLE contracts ADD COLUMN payment_arrangement TEXT;
  END IF;

  -- Company signer
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='company_signer_name') THEN
    ALTER TABLE contracts ADD COLUMN company_signer_name VARCHAR(150) DEFAULT 'S. Baker';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='company_signature_path') THEN
    ALTER TABLE contracts ADD COLUMN company_signature_path VARCHAR(255) DEFAULT '/assets/signature.png';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='company_signed_at') THEN
    ALTER TABLE contracts ADD COLUMN company_signed_at TIMESTAMPTZ;
  END IF;

  -- Lifecycle timestamps
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='sent_at') THEN
    ALTER TABLE contracts ADD COLUMN sent_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='viewed_at') THEN
    ALTER TABLE contracts ADD COLUMN viewed_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='signed_at') THEN
    ALTER TABLE contracts ADD COLUMN signed_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='void_at') THEN
    ALTER TABLE contracts ADD COLUMN void_at TIMESTAMPTZ;
  END IF;

  -- Client signature
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='signature_type') THEN
    ALTER TABLE contracts ADD COLUMN signature_type VARCHAR(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='signature_data') THEN
    ALTER TABLE contracts ADD COLUMN signature_data TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='signer_legal_name') THEN
    ALTER TABLE contracts ADD COLUMN signer_legal_name VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='signer_ip') THEN
    ALTER TABLE contracts ADD COLUMN signer_ip VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='signer_user_agent') THEN
    ALTER TABLE contracts ADD COLUMN signer_user_agent TEXT;
  END IF;

  -- Acknowledgements & snapshot
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='acknowledgements') THEN
    ALTER TABLE contracts ADD COLUMN acknowledgements JSONB DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='terms_snapshot_json') THEN
    ALTER TABLE contracts ADD COLUMN terms_snapshot_json JSONB;
  END IF;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Create indexes (IF NOT EXISTS — safe to re-run)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_sign_token ON contracts(sign_token);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_email ON contracts(client_email);
CREATE INDEX IF NOT EXISTS idx_contracts_created_at ON contracts(created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Enable Row Level Security (RLS)
-- ─────────────────────────────────────────────────────────────────────────────
-- RLS must be enabled so that anonymous/public clients cannot read/write contracts
-- directly via the Supabase JS client (PostgREST).  The backend uses the
-- service_role key which bypasses RLS entirely, so all admin CRUD still works.

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first (idempotent cleanup)
DROP POLICY IF EXISTS "Service role full access on contracts" ON contracts;
DROP POLICY IF EXISTS "Anon cannot access contracts" ON contracts;

-- The service_role key bypasses RLS by default, so we only need to make sure
-- no permissive policies accidentally let anon through. This restrictive
-- "allow nothing" approach is the safest default.
-- If you ever need public read access (e.g., for the sign page via PostgREST),
-- add a specific policy for that use case.


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Verify — list all columns in contracts
-- ─────────────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'contracts'
ORDER BY ordinal_position;
