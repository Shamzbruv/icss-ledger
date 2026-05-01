-- =========================================================================
-- ICSS Accounting & Tax Module — Production Schema Migration (v2)
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
  owner_user_id uuid NOT NULL, -- references auth.users(id) in Supabase
  timezone text NOT NULL DEFAULT 'America/Jamaica',
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  legal_name text NOT NULL,
  trade_name text,
  business_type text NOT NULL DEFAULT 'sole_trader', -- sole_trader | company | partnership

  base_currency char(3) NOT NULL DEFAULT 'JMD',
  fiscal_year_start_month int NOT NULL DEFAULT 1, -- 1=Jan

  -- Jamaica identifiers
  trn text,
  nis_number text,
  nht_employer_trn text,
  nht_category text, -- Add standard settings directly

  gct_registered boolean NOT NULL DEFAULT false,
  gct_registration_number text,
  gct_registration_effective_date date
);

CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies(tenant_id);

-- -------------------------------------------------------------------------
-- 2. CHART OF ACCOUNTS
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL, -- asset|liability|equity|income|expense
  normal_balance text NOT NULL, -- debit|credit

  parent_account_id uuid REFERENCES chart_of_accounts(id),
  is_posting boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,

  default_tax_category text,
  default_gct_treatment text, -- standard|zero|exempt|out_of_scope

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coa_company_type ON chart_of_accounts(company_id, account_type);

-- -------------------------------------------------------------------------
-- 3. JOURNALS AND JOURNAL LINES (IMMUTABLE LEDGER)
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  journal_series text NOT NULL, -- INV, PAY, EXP, JNL, FX, DEP, etc.
  journal_date date NOT NULL,
  period_yyyymm int NOT NULL, -- e.g. 202602

  narration text,
  currency char(3) NOT NULL,
  fx_rate numeric(18,8) NOT NULL DEFAULT 1.0,

  source_system text NOT NULL, -- icss
  source_type text NOT NULL,   -- invoice|payment|credit_note|manual
  source_id uuid NOT NULL,
  source_event_version int NOT NULL,
  idempotency_key text NOT NULL,

  status text NOT NULL DEFAULT 'posted', -- posted|reversed
  reversal_of_journal_id uuid REFERENCES journals(id),
  reversed_by_journal_id uuid REFERENCES journals(id),

  -- Hash of canonical representation of journal+lines for tamper-evidence
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
  aggregate_type text NOT NULL, -- invoice, payment, expense
  aggregate_id uuid NOT NULL,
  event_version int NOT NULL,
  
  event_type text NOT NULL, -- invoice.snapshot.upserted, payment.posted
  idempotency_key text NOT NULL,
  payload_jsonb jsonb NOT NULL,
  
  publish_status text NOT NULL DEFAULT 'pending', -- pending | published | failed
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
  doc_type text NOT NULL, -- invoice|credit_note|debit_note
  issued_at date NOT NULL,
  due_at date,
  currency char(3) NOT NULL,

  total_amount numeric(18,2) NOT NULL,
  open_amount numeric(18,2) NOT NULL,
  status text NOT NULL, -- open|partially_paid|paid|void|written_off

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
  status text NOT NULL, -- open|partially_paid|paid|void

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

-- Note: depreciation_schedules and capital_allowance_schedules can be added if itemised schedules are stored vs. computed on-the-fly.

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

  form_type text NOT NULL, -- S04A|S04|GCT_4A|etc
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
-- 8. SECURITY & AUDIT LOG
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  tenant_id uuid NOT NULL,
  company_id uuid,

  actor_user_id uuid,
  actor_ip inet,
  user_agent text,

  action text NOT NULL, -- create|update|delete|login|export|generate_tax_pack|close_period
  entity_type text,
  entity_id uuid,

  before_json jsonb,
  after_json jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_log(tenant_id, created_at desc);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- =========================================================================
-- END OF SCRIPT
-- =========================================================================
