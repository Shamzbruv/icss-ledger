-- =============================================================================
-- Partner Contracts: Admin-managed revenue-share partnership agreements (e.g. for
-- HaloManage and other companies iCreate Solutions & Services owns/operates), with
-- the same e-signature lifecycle as `contracts` (see schema_contracts.sql).
-- =============================================================================
-- Run this once in Supabase (SQL Editor) alongside the other schema_*.sql files.

CREATE TABLE IF NOT EXISTS partner_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Lifecycle: draft -> sent -> viewed -> signed  (or -> void at any point before signing)
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'void')),
  sign_token VARCHAR(64) NOT NULL,
  agreement_reference VARCHAR(50),
  contract_version VARCHAR(20) DEFAULT 'v1',

  -- Which iCreate-owned company/product this agreement is for. Only 'halomanage' exists
  -- today; a future company just needs a new slug + template set, no schema change.
  company_slug VARCHAR(50) NOT NULL DEFAULT 'halomanage',
  template_id VARCHAR(50) NOT NULL,

  -- The contracting/owner entity (usually iCreate itself) and the product/business line
  company_name VARCHAR(255) NOT NULL DEFAULT 'iCreate Solutions & Services',
  product_name VARCHAR(255) NOT NULL DEFAULT 'HaloManage',

  -- Partner (the counterparty signing)
  partner_name VARCHAR(255) NOT NULL,
  partner_email VARCHAR(255) NOT NULL,
  partner_phone VARCHAR(50),
  partner_address TEXT,

  -- Commercial terms (the fields the admin customizes per partner before sending)
  effective_date DATE,
  term_text TEXT,
  revenue_share_percent NUMERIC(5,2) NOT NULL DEFAULT 10,
  payment_frequency VARCHAR(100) DEFAULT 'Monthly',
  revenue_scope TEXT,
  payment_due_days INTEGER DEFAULT 10,
  termination_notice_days INTEGER DEFAULT 14,
  expense_approval_threshold VARCHAR(100) DEFAULT 'JMD $25,000',
  tail_period_text VARCHAR(100) DEFAULT '90 days',
  relationship_type VARCHAR(20) NOT NULL DEFAULT 'commercial'
    CHECK (relationship_type IN ('commercial', 'formal')),
  additional_duties TEXT,

  -- Company signer — auto-applied so every agreement goes out already "signed" by the Company
  company_signer_name VARCHAR(150) DEFAULT 'S. Baker',
  company_signature_path VARCHAR(255) DEFAULT '/assets/signature.png',
  company_signed_at TIMESTAMPTZ,

  -- Lifecycle timestamps
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  void_at TIMESTAMPTZ,

  -- Partner's electronic signature
  signature_type VARCHAR(20) CHECK (signature_type IS NULL OR signature_type IN ('drawn', 'typed')),
  signature_data TEXT,                 -- base64 PNG data URL (drawn) or the typed name (typed)
  signer_legal_name VARCHAR(255),
  signer_ip VARCHAR(64),
  signer_user_agent TEXT,

  acknowledgements JSONB DEFAULT '{}', -- { relationship_ack, revenue_share_ack, duties_and_authority_ack, signature_confirmation }

  -- Frozen snapshot of the figures the partner actually saw/signed, so later edits to a
  -- since-edited draft never retroactively change an already-sent agreement.
  terms_snapshot_json JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_contracts_sign_token ON partner_contracts(sign_token);
CREATE INDEX IF NOT EXISTS idx_partner_contracts_status ON partner_contracts(status);
CREATE INDEX IF NOT EXISTS idx_partner_contracts_email ON partner_contracts(partner_email);
CREATE INDEX IF NOT EXISTS idx_partner_contracts_company_slug ON partner_contracts(company_slug);
CREATE INDEX IF NOT EXISTS idx_partner_contracts_created_at ON partner_contracts(created_at DESC);

-- RLS: same posture as `contracts` — enabled, with no permissive policy for anon/public.
-- The backend uses the Supabase service_role key (src/db.js), which bypasses RLS entirely,
-- so all admin CRUD and the public sign-token routes (server-mediated, not direct DB access)
-- continue to work unaffected.
ALTER TABLE partner_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on partner_contracts" ON partner_contracts;
DROP POLICY IF EXISTS "Anon cannot access partner_contracts" ON partner_contracts;
