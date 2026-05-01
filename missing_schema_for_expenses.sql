-- =========================================================================
-- ICSS Accounting & Tax Module — Expenses Schema Patch
-- Execute this script in your Supabase SQL Editor.
-- =========================================================================

-- 1. EXPENSE RECORDS
CREATE TABLE IF NOT EXISTS expense_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    expense_date DATE NOT NULL,
    vendor TEXT,
    description TEXT NOT NULL,
    expense_type TEXT NOT NULL DEFAULT 'cash',
    status TEXT DEFAULT 'posted',
    coa_account_code TEXT NOT NULL,
    coa_account_name TEXT,
    total_amount NUMERIC(15, 2) NOT NULL,
    currency TEXT DEFAULT 'JMD',
    fx_rate NUMERIC(10, 4) DEFAULT 1.0000,
    is_gct_inclusive BOOLEAN DEFAULT FALSE,
    gct_amount NUMERIC(15, 2) DEFAULT 0.00,
    tax_deductible BOOLEAN DEFAULT TRUE,
    tax_category TEXT,
    receipt_url TEXT,
    bill_due_date DATE,
    bill_paid_date DATE,
    reference TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_company_date ON expense_records(company_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_account ON expense_records(company_id, coa_account_code);

-- 2. ACCOUNTING EVENTS (Legacy Idempotency Log required by Expenses API)
CREATE TABLE IF NOT EXISTS accounting_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    source_id UUID NOT NULL,
    source_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_version INT NOT NULL DEFAULT 1,
    payload JSONB NOT NULL DEFAULT '{}',
    journal_entry_id UUID,
    processed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, source_id, source_type, event_version)
);
CREATE INDEX IF NOT EXISTS idx_accounting_events_source ON accounting_events(source_type, source_id);

-- 3. ENABLE ROW LEVEL SECURITY
ALTER TABLE expense_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_events ENABLE ROW LEVEL SECURITY;

-- 4. APPLY BYPASS POLICIES FOR ICSS BACKEND
DO $$ 
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['expense_records', 'accounting_events'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE policyname = 'Allow all (ICSS internal)' AND tablename = tbl
        ) THEN
            EXECUTE format(
                'CREATE POLICY "Allow all (ICSS internal)" ON %I FOR ALL USING (true) WITH CHECK (true)', tbl
            );
        END IF;
    END LOOP;
END $$;
