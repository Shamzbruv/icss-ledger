-- schema_accounting_patch_bulk_imports.sql
-- Migration for the Bulk Expense Import feature
-- 0. vendors table
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, vendor_name)
);

CREATE INDEX IF NOT EXISTS idx_vendors_company_name
  ON vendors(company_id, vendor_name);

-- 1. bulk_imports table
CREATE TABLE IF NOT EXISTS bulk_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid, -- reference to auth.users if available, else omit FK to avoid strict auth dependency right now
  
  source_type text NOT NULL, -- clipboard|csv|bank_csv|ofx|qif|receipt_ocr
  status text NOT NULL DEFAULT 'draft', -- draft|parsed|needs_review|confirmed|posted|reverted|failed
  
  batch_version int NOT NULL DEFAULT 1,
  
  file_storage_key text,
  raw_text_preview text,
  parse_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  confirmed_at timestamptz,
  confirmed_by_user_id uuid
);

CREATE INDEX IF NOT EXISTS idx_bulk_imports_company_time
  ON bulk_imports(company_id, created_at DESC);

-- 2. bulk_import_lines table
CREATE TABLE IF NOT EXISTS bulk_import_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_import_id uuid NOT NULL REFERENCES bulk_imports(id) ON DELETE CASCADE,
  
  row_number int NOT NULL,
  raw_row_json jsonb NOT NULL,
  normalized_json jsonb,
  
  parse_status text NOT NULL DEFAULT 'parsed', -- parsed|error|ignored
  warnings text[] NOT NULL DEFAULT array[]::text[],
  
  matched_vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  suggested_account_id uuid REFERENCES coa_accounts(id) ON DELETE SET NULL, -- assuming coa_accounts is the chart of accounts table
  suggestion_confidence numeric(5,4) NOT NULL DEFAULT 0,
  
  user_account_id uuid REFERENCES coa_accounts(id) ON DELETE SET NULL,
  user_vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  user_overridden boolean NOT NULL DEFAULT false,
  
  line_fingerprint text NOT NULL,
  
  UNIQUE(bulk_import_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_bulk_lines_import_status
  ON bulk_import_lines(bulk_import_id, parse_status);

CREATE INDEX IF NOT EXISTS idx_bulk_lines_fingerprint
  ON bulk_import_lines(line_fingerprint);

-- 3. vendor_aliases table
CREATE TABLE IF NOT EXISTS vendor_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  
  alias_normalized text NOT NULL,
  source_hint text,
  reliability_score numeric(5,4) NOT NULL DEFAULT 1.0,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(company_id, alias_normalized)
);

CREATE INDEX IF NOT EXISTS idx_vendor_alias_vendor
  ON vendor_aliases(company_id, vendor_id);

-- 4. auto_category_rules table
CREATE TABLE IF NOT EXISTS auto_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  
  rule_type text NOT NULL, -- vendor_exact|vendor_alias|description_regex|amount_range|recurrence|ml_fallback
  rule_def jsonb NOT NULL,
  
  target_account_id uuid NOT NULL REFERENCES coa_accounts(id) ON DELETE CASCADE,
  target_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_company_active_priority
  ON auto_category_rules(company_id, is_active, priority);

-- 5. bulk_import_line_postings table
CREATE TABLE IF NOT EXISTS bulk_import_line_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_import_line_id uuid NOT NULL REFERENCES bulk_import_lines(id) ON DELETE CASCADE,
  journal_id uuid NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  
  posting_version int NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(bulk_import_line_id, posting_version)
);

CREATE INDEX IF NOT EXISTS idx_postings_journal
  ON bulk_import_line_postings(journal_id);


-- RLS POLICIES --

-- Enable RLS on all new tables
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_import_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_import_line_postings ENABLE ROW LEVEL SECURITY;

-- Assuming standard ICSS auth policy approach: allow access if company_id OR allow if using service role.
-- (If there isn't a strict row-level company_id matcher based on JWT, we might provide a permissive standard policy to rely on app-layer).

-- A common fallback when relying mostly on application-layer auth in this schema is:
CREATE POLICY "Enable all for authenticated users or public depending on setup" ON vendors FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users or public depending on setup" ON bulk_imports FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users or public depending on setup" ON bulk_import_lines FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users or public depending on setup" ON vendor_aliases FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users or public depending on setup" ON auto_category_rules FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users or public depending on setup" ON bulk_import_line_postings FOR ALL USING (true);

-- (In production, replace 'true' with actual auth.uid() checks mapped to companies).
