-- =========================================================================
-- ICSS Accounting & Tax Module — Production Schema Migration (v3)
-- Execute this script in your Supabase SQL Editor.
-- Idempotent setup (IF NOT EXISTS).
-- =========================================================================

-- Enable pgcrypto for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------------------
-- 1. TENANTS AND COMPANIES
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL, 
  timezone text NOT NULL DEFAULT 'America/Jamaica',
  status text NOT NULL DEFAULT 'active'
);

-- CREATE TABLE IF NOT EXISTS for companies in case this is a fresh database
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  prefix text UNIQUE
);

-- SAFELY ADD ACCOUNTING COLUMNS TO EXISTING COMPANIES TABLE
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_name text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_type text DEFAULT 'sole_trader'; 
ALTER TABLE companies ADD COLUMN IF NOT EXISTS base_currency char(3) DEFAULT 'JMD';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fiscal_year_start_month int DEFAULT 1; 
ALTER TABLE companies ADD COLUMN IF NOT EXISTS trn text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS nis_number text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS nht_employer_trn text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS nht_category text; 
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gct_registered boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gct_registration_number text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gct_registration_effective_date date;

-- -------------------------------------------------------------------------
-- 2. CHART OF ACCOUNTS
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL, 
  normal_balance text NOT NULL, 

  parent_account_id uuid REFERENCES chart_of_accounts(id),
  is_posting boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,

  default_tax_category text,
  default_gct_treatment text, 

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(company_id, code)
);

-- Note: company_id existed when chart_of_accounts was created, so this index parse is safe
CREATE INDEX IF NOT EXISTS idx_coa_company_type ON chart_of_accounts(company_id, account_type);

-- -------------------------------------------------------------------------
-- 3. JOURNALS AND JOURNAL LINES (IMMUTABLE LEDGER)
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  journal_series text NOT NULL, 
  journal_date date NOT NULL,
  period_yyyymm int NOT NULL, 

  narration text,
  currency char(3) NOT NULL,
  fx_rate numeric(18,8) NOT NULL DEFAULT 1.0,

  source_system text NOT NULL, 
  source_type text NOT NULL,   
  source_id uuid NOT NULL,
  source_event_version int NOT NULL,
  idempotency_key text NOT NULL,

  status text NOT NULL DEFAULT 'posted', 
  reversal_of_journal_id uuid REFERENCES journals(id),
  reversed_by_journal_id uuid REFERENCES journals(id),

  content_sha256 text NOT NULL,

  UNIQUE(company_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  line_no int NOT NULL,

  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  description text,

  debit numeric(18,2) NOT NULL DEFAULT 0,
  credit numeric(18,2) NOT NULL DEFAULT 0,

  -- Dimensions
  customer_id uuid,
  vendor_id uuid,
  invoice_id uuid,
  project_id uuid,

  tax_tag text,
  gct_tag text,

  UNIQUE(journal_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_journals_company_period ON journals(company_id, period_yyyymm, journal_date);
CREATE INDEX IF NOT EXISTS idx_journals_source ON journals(company_id, source_system, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON journal_lines(invoice_id);

-- -------------------------------------------------------------------------
-- 4. OUTBOX AND EVENT CONSUMPTION (IDEMPOTENCY)
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  
  company_id uuid NOT NULL,
  aggregate_type text NOT NULL, 
  aggregate_id uuid NOT NULL,
  event_version int NOT NULL,
  
  event_type text NOT NULL, 
  idempotency_key text NOT NULL,
  payload_jsonb jsonb NOT NULL,
  
  publish_status text NOT NULL DEFAULT 'pending', 
  attempt_count int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz
);

CREATE TABLE IF NOT EXISTS consumed_events (
  company_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  
  PRIMARY KEY (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(publish_status, occurred_at) WHERE publish_status = 'pending';

-- -------------------------------------------------------------------------
-- 5. SUBLEDGERS: A/R AND A/P
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ar_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  source_invoice_id uuid NOT NULL, 
  doc_type text NOT NULL, 
  issued_at date NOT NULL,
  due_at date,
  currency char(3) NOT NULL,

  total_amount numeric(18,2) NOT NULL,
  open_amount numeric(18,2) NOT NULL,
  status text NOT NULL, 

  customer_id uuid,
  last_event_version int NOT NULL,

  UNIQUE(company_id, source_invoice_id, doc_type)
);

CREATE TABLE IF NOT EXISTS ap_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  vendor_id uuid,
  bill_number text,
  bill_date date NOT NULL,
  due_at date,
  currency char(3) NOT NULL DEFAULT 'JMD',

  total_amount numeric(18,2) NOT NULL,
  open_amount numeric(18,2) NOT NULL,
  status text NOT NULL, 

  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  last_event_version int NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ar_open_due ON ar_documents(company_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_ap_open_due ON ap_documents(company_id, status, due_at);

-- -------------------------------------------------------------------------
-- 6. FIXED ASSETS
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  asset_name text NOT NULL,
  asset_category text NOT NULL,
  acquisition_date date NOT NULL,
  acquisition_cost numeric(18,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'JMD',

  business_use_pct numeric(5,2) NOT NULL DEFAULT 100.00,

  depreciation_method text NOT NULL DEFAULT 'straight_line',
  useful_life_months int,
  salvage_value numeric(18,2) NOT NULL DEFAULT 0,

  disposed boolean NOT NULL DEFAULT false,
  disposal_date date,
  disposal_proceeds numeric(18,2),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_company_active ON fixed_assets(company_id, disposed);

-- -------------------------------------------------------------------------
-- 7. TAX COMPLIANCE
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction text NOT NULL DEFAULT 'JM',
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),

  name text NOT NULL, 
  policy_json jsonb NOT NULL,
  policy_sha256 text NOT NULL,

  UNIQUE(jurisdiction, effective_from)
);

CREATE TABLE IF NOT EXISTS tax_forms_generated (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  form_type text NOT NULL, 
  tax_year int NOT NULL,
  period_start date,
  period_end date,

  policy_version_id uuid NOT NULL REFERENCES tax_policy_versions(id),

  output_pdf_storage_key text,
  output_json_storage_key text,

  report_run_id text NOT NULL,
  output_sha256 text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tax_policy_effective ON tax_policy_versions(jurisdiction, effective_from);
CREATE INDEX IF NOT EXISTS idx_tax_forms_company_year ON tax_forms_generated(company_id, form_type, tax_year);

-- -------------------------------------------------------------------------
-- 8. SECURITY & AUDIT LOG (FIXED FOR EXISTING TABLES)
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Force add columns in case the table already existed from before
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_ip inet;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS before_json jsonb;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS after_json jsonb;

-- Run index creation dynamically so PostgreSQL parser doesn't crash 
-- if tenant_id didn't exist when the script started
DO $$ 
BEGIN 
    -- Indexes for Companies
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_companies_tenant') THEN
        EXECUTE 'CREATE INDEX idx_companies_tenant ON companies(tenant_id)';
    END IF;

    -- Indexes for Audit Log
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_tenant_time') THEN
        EXECUTE 'CREATE INDEX idx_audit_tenant_time ON audit_log(tenant_id, created_at desc)';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_entity') THEN
        EXECUTE 'CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id)';
    END IF;
END $$;

-- =========================================================================
-- END OF SCRIPT
-- =========================================================================
