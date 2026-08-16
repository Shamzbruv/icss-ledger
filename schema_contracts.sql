-- =============================================================================
-- Contracts: Admin-managed digital Project Service Agreements with e-signature
-- =============================================================================
-- Run this once in Supabase (SQL Editor) alongside the other schema_*.sql files.

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_sign_token ON contracts(sign_token);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_email ON contracts(client_email);
CREATE INDEX IF NOT EXISTS idx_contracts_created_at ON contracts(created_at DESC);
