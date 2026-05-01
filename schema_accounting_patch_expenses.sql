-- =========================================================================
-- ICSS Accounting & Tax Module — Production Schema Expansion (v4)
-- Execute this script in your Supabase SQL Editor.
-- Idempotent setup (IF NOT EXISTS).
-- =========================================================================

-- 1. ACCOUNTING SETTINGS
CREATE TABLE IF NOT EXISTS accounting_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    business_type TEXT DEFAULT 'sole_trader',
    nht_category TEXT DEFAULT 'cat1_5',
    gct_registered BOOLEAN DEFAULT FALSE,
    gct_registration_date DATE,
    gct_filing_frequency TEXT DEFAULT 'monthly',
    accounting_basis TEXT DEFAULT 'accrual',
    reporting_currency TEXT DEFAULT 'JMD',
    invoice_currency TEXT DEFAULT 'USD',
    fx_rate_usd_to_jmd NUMERIC(10, 4) DEFAULT 158.0000,
    owner_email TEXT,
    accountant_email TEXT,
    owner_pack_day_of_month INT DEFAULT 1,
    trn TEXT,
    nis_number TEXT,
    nht_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id)
);

-- 2. EXPENSE RECORDS
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

-- 3. ACCOUNTING EVENTS (Legacy Idempotency Log required by some services)
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

-- 4. GCT CONFIGURATION
CREATE TABLE IF NOT EXISTS gct_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    registration_date DATE,
    registration_number TEXT,
    filing_frequency TEXT DEFAULT 'monthly',
    activity_type TEXT DEFAULT 'standard',
    tracks_imports BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id)
);

-- 5. DEPRECIATION SCHEDULES
CREATE TABLE IF NOT EXISTS depreciation_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    fiscal_year INT NOT NULL,
    depreciation_amount NUMERIC(15, 2) NOT NULL,
    accumulated_depreciation NUMERIC(15, 2) NOT NULL,
    net_book_value NUMERIC(15, 2) NOT NULL,
    journal_entry_id UUID,
    posted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(asset_id, fiscal_year)
);

-- 6. TAX PACK REPORTS (Archive)
CREATE TABLE IF NOT EXISTS tax_pack_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    tax_year INT NOT NULL,
    form_type TEXT NOT NULL,
    report_run_id TEXT NOT NULL,
    pdf_path TEXT,
    json_path TEXT,
    pdf_hash TEXT,
    policy_version_snapshot JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, tax_year, form_type, report_run_id)
);

-- 7. OWNER PACK REPORTS (Archive)
CREATE TABLE IF NOT EXISTS owner_pack_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    report_period TEXT NOT NULL,
    report_run_id TEXT NOT NULL,
    pdf_path TEXT,
    pdf_hash TEXT,
    policy_version_snapshot JSONB DEFAULT '{}',
    emailed_to TEXT[],
    emailed_at TIMESTAMP WITH TIME ZONE,
    email_status TEXT DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, report_period, report_run_id)
);

ALTER TABLE accounting_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gct_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_pack_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_pack_reports ENABLE ROW LEVEL SECURITY;

DO $$ 
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'accounting_settings', 'expense_records', 'accounting_events', 'gct_config',
        'depreciation_schedules', 'tax_pack_reports', 'owner_pack_reports'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE policyname = 'Allow all (ICSS internal)' AND tablename = tbl
        ) THEN
            EXECUTE format(
                'CREATE POLICY "Allow all (ICSS internal)" ON %I FOR ALL USING (true) WITH CHECK (true)', tbl
            );
        END IF;
    END LOOP;
END $$;
