BEGIN;

-- 1. Drop the V1 tables that are conflicting with the V3 JS backend
DROP TABLE IF EXISTS journal_lines CASCADE;
DROP TABLE IF EXISTS journal_entries CASCADE;

-- Also remove the FKs in accounting_events and depreciation_schedules that pointed to journal_entries
ALTER TABLE accounting_events DROP COLUMN IF NOT EXISTS journal_entry_id;
ALTER TABLE depreciation_schedules DROP COLUMN IF NOT EXISTS journal_entry_id;

-- 2. Create the V3 journals table
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

-- 3. Create the V3 journal_lines table
CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  line_no int NOT NULL,

  account_id uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  description text,

  debit numeric(18,2) NOT NULL DEFAULT 0,
  credit numeric(18,2) NOT NULL DEFAULT 0,

  customer_id uuid,
  vendor_id uuid,
  invoice_id uuid,
  project_id uuid,
  tax_tag text,
  gct_tag text,

  UNIQUE(journal_id, line_no)
);

-- Re-add FKs using the new journals table
ALTER TABLE accounting_events ADD COLUMN IF NOT EXISTS journal_id uuid REFERENCES journals(id) ON DELETE SET NULL;
ALTER TABLE depreciation_schedules ADD COLUMN IF NOT EXISTS journal_id uuid REFERENCES journals(id) ON DELETE SET NULL;

-- 4. Create consumed_events for idempotency checks
CREATE TABLE IF NOT EXISTS consumed_events (
  company_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, idempotency_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_journals_company_period ON journals(company_id, period_yyyymm, journal_date);
CREATE INDEX IF NOT EXISTS idx_journals_source ON journals(company_id, source_system, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON journal_lines(invoice_id);

-- Enable RLS
ALTER TABLE journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumed_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['journals', 'journal_lines', 'consumed_events'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all (ICSS internal)' AND tablename = tbl) THEN
            EXECUTE format('CREATE POLICY "Allow all (ICSS internal)" ON %I FOR ALL USING (true) WITH CHECK (true)', tbl);
        END IF;
    END LOOP;
END $$;

-- Force Supabase PostgREST to reload the schema cache so the FK relationships are picked up immediately
NOTIFY pgrst, 'reload schema';

COMMIT;
