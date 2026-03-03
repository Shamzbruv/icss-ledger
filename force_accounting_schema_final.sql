BEGIN;

-- CLEAR BROKEN EMPTY TABLES
DROP TABLE IF EXISTS fixed_assets CASCADE;
DROP TABLE IF EXISTS expense_records CASCADE;
COMMIT;

-- ============================================================================
-- ICSS COMMAND CENTER — ACCOUNTING & TAX MODULE SCHEMA
-- ============================================================================
-- Run once in Supabase SQL Editor. Fully idempotent (IF NOT EXISTS).
-- Compatible with existing schema (invoices, clients, companies tables).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ACCOUNTING SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    business_type TEXT DEFAULT 'sole_trader', -- 'sole_trader' | 'company'
    nht_category TEXT DEFAULT 'cat1_5',        -- 'cat1_5' (3%) | 'cat6_7' (2%)
    gct_registered BOOLEAN DEFAULT FALSE,
    gct_registration_date DATE,
    gct_filing_frequency TEXT DEFAULT 'monthly', -- 'monthly' | 'quarterly'
    accounting_basis TEXT DEFAULT 'accrual',     -- 'accrual' | 'cash'
    reporting_currency TEXT DEFAULT 'JMD',
    invoice_currency TEXT DEFAULT 'USD',
    fx_rate_usd_to_jmd NUMERIC(10, 4) DEFAULT 158.0000, -- Configurable exchange rate
    owner_email TEXT,
    accountant_email TEXT,
    owner_pack_day_of_month INT DEFAULT 1,       -- Day to auto-send owner pack (1 = 1st of next month)
    trn TEXT,                                    -- Taxpayer Registration Number
    nis_number TEXT,
    nht_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id)
);

-- ============================================================================
-- 2. TAX POLICY STORE (versioned by effective_date)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tax_policy_store (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction TEXT NOT NULL DEFAULT 'JM',    -- ISO country code
    policy_key TEXT NOT NULL,                   -- e.g. 'IT_THRESHOLD_JMD', 'NHT_RATE_CAT1_5'
    policy_value NUMERIC(20, 6) NOT NULL,        -- Numeric value (rate as decimal, amounts in JMD)
    policy_label TEXT,                           -- Human-readable description
    effective_date DATE NOT NULL,                -- This row is active from this date forward
    superseded_date DATE,                        -- NULL means still current
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(jurisdiction, policy_key, effective_date)
);
CREATE INDEX IF NOT EXISTS idx_tax_policy_lookup ON tax_policy_store(jurisdiction, policy_key, effective_date DESC);

-- ============================================================================
-- 3. CHART OF ACCOUNTS (CoA)
-- ============================================================================
CREATE TABLE IF NOT EXISTS coa_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    account_code TEXT NOT NULL,                 -- e.g. '1100'
    account_name TEXT NOT NULL,                 -- e.g. 'Accounts Receivable'
    account_type TEXT NOT NULL,                 -- 'asset'|'liability'|'equity'|'revenue'|'expense'
    account_subtype TEXT,                       -- e.g. 'current_asset', 'contra_revenue'
    normal_balance TEXT NOT NULL DEFAULT 'debit', -- 'debit' | 'credit'
    is_system_account BOOLEAN DEFAULT FALSE,    -- System accounts cannot be deleted
    is_active BOOLEAN DEFAULT TRUE,
    parent_account_code TEXT,                   -- For sub-accounts
    tax_category TEXT,                          -- Maps to S04 section or IT02 schedule
    gct_category TEXT,                          -- Maps to Form 4A box: 'output_standard','input_standard', etc.
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, account_code)
);
CREATE INDEX IF NOT EXISTS idx_coa_company ON coa_accounts(company_id, account_type);

-- ============================================================================
-- 4. JOURNAL ENTRIES (IMMUTABLE — never UPDATE or DELETE rows here)
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    period TEXT NOT NULL,                       -- 'YYYY-MM' for period locking
    description TEXT NOT NULL,
    reference TEXT,                             -- e.g. Invoice number, expense ref
    source_type TEXT,                           -- 'INVOICE'|'PAYMENT'|'EXPENSE'|'ASSET'|'MANUAL'|'DEPRECIATION'|'TAX_ACCRUAL'|'PERIOD_CLOSE'
    source_id UUID,                             -- FK to originating record (invoice_id, expense_id, etc.)
    accounting_event_id UUID,                   -- FK to accounting_events for traceability
    is_reversal BOOLEAN DEFAULT FALSE,
    reverses_entry_id UUID,                     -- Points to the original entry this reverses
    reversed_by_entry_id UUID,                  -- Points to the reversal entry (if this was reversed)
    is_post_close_adjustment BOOLEAN DEFAULT FALSE,
    is_period_locked BOOLEAN DEFAULT FALSE,
    created_by TEXT DEFAULT 'system',           -- 'system' | user identifier
    report_run_id TEXT,                         -- For reproducibility: links to owner_pack_reports
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- No updated_at — this table is append-only
    CONSTRAINT no_self_reversal CHECK (id <> reverses_entry_id)
);
CREATE INDEX IF NOT EXISTS idx_journal_company_period ON journal_entries(company_id, period);
CREATE INDEX IF NOT EXISTS idx_journal_source ON journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(company_id, entry_date DESC);

-- ============================================================================
-- 5. JOURNAL LINES (Debit/Credit lines per entry — always balanced)
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_code TEXT NOT NULL,                 -- References coa_accounts.account_code
    account_name TEXT NOT NULL,                 -- Denormalized for auditing
    debit_amount NUMERIC(15, 2) DEFAULT 0.00,
    credit_amount NUMERIC(15, 2) DEFAULT 0.00,
    currency TEXT DEFAULT 'JMD',
    fx_rate NUMERIC(10, 4) DEFAULT 1.0000,      -- Rate used for conversion (1.0 if already JMD)
    memo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT debit_or_credit CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR
        (credit_amount > 0 AND debit_amount = 0)
    ),
    CONSTRAINT positive_amounts CHECK (debit_amount >= 0 AND credit_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code);

-- ============================================================================
-- 6. ACCOUNTING EVENTS (Idempotency Log — event sourcing)
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    source_id UUID NOT NULL,                    -- invoice_id, expense_id, etc.
    source_type TEXT NOT NULL,                  -- 'INVOICE' | 'EXPENSE' | 'ASSET' | 'MANUAL'
    event_type TEXT NOT NULL,                   -- 'INVOICE_CREATED', 'PAYMENT_APPLIED', etc.
    event_version INT NOT NULL DEFAULT 1,       -- Monotonic per source_id — incremented on change
    payload JSONB NOT NULL DEFAULT '{}',        -- Snapshot of source data at event time
    journal_entry_id UUID REFERENCES journal_entries(id), -- Resulting journal entry (null until processed)
    processed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,                                 -- Processing error if any
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, source_id, source_type, event_version) -- Idempotency key
);
CREATE INDEX IF NOT EXISTS idx_accounting_events_source ON accounting_events(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_accounting_events_company ON accounting_events(company_id, created_at DESC);

-- ============================================================================
-- 7. CLOSED PERIODS (Period locking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS closed_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    period TEXT NOT NULL,                      -- 'YYYY-MM'
    closed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_by TEXT DEFAULT 'owner',
    notes TEXT,
    UNIQUE(company_id, period)
);

-- ============================================================================
-- 8. EXPENSE RECORDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS expense_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    expense_date DATE NOT NULL,
    vendor TEXT,
    description TEXT NOT NULL,
    expense_type TEXT NOT NULL DEFAULT 'cash', -- 'cash' | 'bill' (bill-then-pay)
    status TEXT DEFAULT 'posted',              -- 'draft' | 'posted' | 'paid' (for bills)
    coa_account_code TEXT NOT NULL,            -- Which expense account
    coa_account_name TEXT,
    total_amount NUMERIC(15, 2) NOT NULL,
    currency TEXT DEFAULT 'JMD',
    fx_rate NUMERIC(10, 4) DEFAULT 1.0000,
    is_gct_inclusive BOOLEAN DEFAULT FALSE,
    gct_amount NUMERIC(15, 2) DEFAULT 0.00,   -- Input GCT claimable
    tax_deductible BOOLEAN DEFAULT TRUE,
    tax_category TEXT,                         -- Maps to allowable deduction category for S04
    receipt_url TEXT,                          -- Attachment storage URL
    bill_due_date DATE,                        -- For bill-type expenses
    bill_paid_date DATE,
    reference TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_company_date ON expense_records(company_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_account ON expense_records(company_id, coa_account_code);

-- ============================================================================
-- 9. FIXED ASSET REGISTER
-- ============================================================================
CREATE TABLE IF NOT EXISTS fixed_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    asset_name TEXT NOT NULL,
    asset_category TEXT NOT NULL,               -- 'computer'|'vehicle'|'furniture'|'equipment'|'building'|'ip'
    purchase_date DATE NOT NULL,
    cost NUMERIC(15, 2) NOT NULL,
    currency TEXT DEFAULT 'JMD',
    fx_rate NUMERIC(10, 4) DEFAULT 1.0000,
    business_use_percent NUMERIC(5, 2) DEFAULT 100.00, -- % used for business (affects capital allowances)
    useful_life_years INT DEFAULT 5,            -- For book depreciation
    residual_value NUMERIC(15, 2) DEFAULT 0.00,
    depreciation_method TEXT DEFAULT 'straight_line', -- 'straight_line' | 'declining_balance'
    coa_account_code TEXT DEFAULT '1500',       -- Fixed Assets account
    disposed BOOLEAN DEFAULT FALSE,
    disposal_date DATE,
    disposal_proceeds NUMERIC(15, 2) DEFAULT 0.00,
    disposal_notes TEXT,
    vendor TEXT,
    serial_number TEXT,
    receipt_url TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assets_company ON fixed_assets(company_id, disposed);

-- ============================================================================
-- 10. DEPRECIATION SCHEDULES (Book depreciation, per asset per year)
-- ============================================================================
CREATE TABLE IF NOT EXISTS depreciation_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    fiscal_year INT NOT NULL,                   -- e.g. 2025
    depreciation_amount NUMERIC(15, 2) NOT NULL,
    accumulated_depreciation NUMERIC(15, 2) NOT NULL,
    net_book_value NUMERIC(15, 2) NOT NULL,
    journal_entry_id UUID REFERENCES journal_entries(id),
    posted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(asset_id, fiscal_year)
);

-- ============================================================================
-- 11. CAPITAL ALLOWANCE SCHEDULES (Tax capital allowances, Jamaica)
-- ============================================================================
CREATE TABLE IF NOT EXISTS capital_allowance_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    tax_year INT NOT NULL,
    initial_allowance NUMERIC(15, 2) DEFAULT 0.00,  -- For assets qualifying for accelerated allowance
    annual_allowance NUMERIC(15, 2) DEFAULT 0.00,
    total_allowance NUMERIC(15, 2) DEFAULT 0.00,
    tax_wdv_opening NUMERIC(15, 2),                 -- Tax Written-Down Value at start of year
    tax_wdv_closing NUMERIC(15, 2),                 -- Tax Written-Down Value at end of year
    policy_version_date DATE,                        -- Which tax_policy_store version used
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(asset_id, tax_year)
);

-- ============================================================================
-- 12. GCT CONFIGURATION
-- ============================================================================
CREATE TABLE IF NOT EXISTS gct_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    registration_date DATE,
    registration_number TEXT,
    filing_frequency TEXT DEFAULT 'monthly',    -- 'monthly' | 'quarterly'
    activity_type TEXT DEFAULT 'standard',      -- 'standard' | 'zero_rated' | 'exempt' | 'mixed'
    tracks_imports BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id)
);

-- ============================================================================
-- 13. OWNER PACK REPORTS (Archive)
-- ============================================================================
CREATE TABLE IF NOT EXISTS owner_pack_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    report_period TEXT NOT NULL,                -- 'YYYY-MM'
    report_run_id TEXT NOT NULL,                -- Unique run identifier (e.g. UUID string)
    pdf_path TEXT,                              -- Server file path or S3 key
    pdf_hash TEXT,                              -- SHA-256 of PDF bytes (for reproducibility)
    policy_version_snapshot JSONB DEFAULT '{}', -- Snapshot of tax_policy_store values used
    emailed_to TEXT[],                          -- Array of email addresses sent to
    emailed_at TIMESTAMP WITH TIME ZONE,
    email_status TEXT DEFAULT 'pending',        -- 'pending' | 'sent' | 'failed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, report_period, report_run_id)
);
CREATE INDEX IF NOT EXISTS idx_owner_packs_company ON owner_pack_reports(company_id, report_period DESC);

-- ============================================================================
-- 14. TAX PACK REPORTS (Archive)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tax_pack_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    tax_year INT NOT NULL,
    form_type TEXT NOT NULL,                   -- 'S04' | 'S04A' | 'IT02' | 'FORM4A'
    report_run_id TEXT NOT NULL,
    pdf_path TEXT,
    json_path TEXT,                            -- JSON entry assistant export
    pdf_hash TEXT,
    policy_version_snapshot JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, tax_year, form_type, report_run_id)
);

-- ============================================================================
-- 15. ENABLE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE accounting_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_policy_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE coa_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE closed_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_allowance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gct_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_pack_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_pack_reports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'accounting_settings', 'tax_policy_store', 'coa_accounts',
        'journal_entries', 'journal_lines', 'accounting_events', 'closed_periods',
        'expense_records', 'fixed_assets', 'depreciation_schedules',
        'capital_allowance_schedules', 'gct_config', 'owner_pack_reports', 'tax_pack_reports'
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

-- ============================================================================
-- 16. TRIGGERS: updated_at for mutable tables
-- ============================================================================
-- Reuse existing update_updated_at_column() function from SUPABASE_FINAL_MIGRATION.sql

DROP TRIGGER IF EXISTS update_accounting_settings_updated_at ON accounting_settings;
CREATE TRIGGER update_accounting_settings_updated_at
    BEFORE UPDATE ON accounting_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expense_records_updated_at ON expense_records;
CREATE TRIGGER update_expense_records_updated_at
    BEFORE UPDATE ON expense_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_fixed_assets_updated_at ON fixed_assets;
CREATE TRIGGER update_fixed_assets_updated_at
    BEFORE UPDATE ON fixed_assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 17. SEED DATA — CHART OF ACCOUNTS (System Accounts)
-- ============================================================================
-- We use a CTE to get the default company_id and insert CoA only if not already present.

DO $$
DECLARE
    v_company_id UUID;
BEGIN
    SELECT id INTO v_company_id FROM companies LIMIT 1;
    IF v_company_id IS NULL THEN
        RETURN; -- No company yet, skip seed
    END IF;

    -- Only seed if CoA is empty for this company
    IF (SELECT COUNT(*) FROM coa_accounts WHERE company_id = v_company_id) > 0 THEN
        RETURN;
    END IF;

    -- ASSETS
    INSERT INTO coa_accounts (company_id, account_code, account_name, account_type, account_subtype, normal_balance, is_system_account, tax_category) VALUES
        (v_company_id, '1000', 'Cash on Hand', 'asset', 'current_asset', 'debit', TRUE, NULL),
        (v_company_id, '1010', 'Bank Account (Primary)', 'asset', 'current_asset', 'debit', TRUE, NULL),
        (v_company_id, '1020', 'Bank Account (Secondary)', 'asset', 'current_asset', 'debit', FALSE, NULL),
        (v_company_id, '1100', 'Accounts Receivable', 'asset', 'current_asset', 'debit', TRUE, NULL),
        (v_company_id, '1110', 'Prepaid Expenses', 'asset', 'current_asset', 'debit', FALSE, NULL),
        (v_company_id, '1200', 'Input GCT Receivable', 'asset', 'current_asset', 'debit', TRUE, 'gct_input'),
        (v_company_id, '1210', 'GCT Withheld Receivable', 'asset', 'current_asset', 'debit', FALSE, 'gct_withheld'),
        (v_company_id, '1500', 'Fixed Assets (Cost)', 'asset', 'non_current_asset', 'debit', TRUE, NULL),
        (v_company_id, '1510', 'Accumulated Depreciation', 'asset', 'contra_asset', 'credit', TRUE, NULL),

    -- LIABILITIES
        (v_company_id, '2000', 'Accounts Payable', 'liability', 'current_liability', 'credit', TRUE, NULL),
        (v_company_id, '2010', 'Customer Deposits / Unearned Revenue', 'liability', 'current_liability', 'credit', TRUE, NULL),
        (v_company_id, '2100', 'Income Tax Payable', 'liability', 'current_liability', 'credit', TRUE, 'income_tax'),
        (v_company_id, '2110', 'Education Tax Payable', 'liability', 'current_liability', 'credit', TRUE, 'education_tax'),
        (v_company_id, '2120', 'NHT Contributions Payable', 'liability', 'current_liability', 'credit', TRUE, 'nht'),
        (v_company_id, '2130', 'NIS Contributions Payable', 'liability', 'current_liability', 'credit', TRUE, 'nis'),
        (v_company_id, '2200', 'Output GCT Payable', 'liability', 'current_liability', 'credit', TRUE, 'gct_output'),

    -- EQUITY
        (v_company_id, '3000', 'Owner''s Capital', 'equity', 'owner_equity', 'credit', TRUE, NULL),
        (v_company_id, '3010', 'Owner''s Drawings', 'equity', 'owner_drawings', 'debit', TRUE, NULL),
        (v_company_id, '3020', 'Retained Earnings', 'equity', 'retained_earnings', 'credit', FALSE, NULL),

    -- REVENUE
        (v_company_id, '4000', 'Service Revenue', 'revenue', 'operating_revenue', 'credit', TRUE, 's04_gross_income'),
        (v_company_id, '4010', 'Other Income', 'revenue', 'other_revenue', 'credit', FALSE, 's04_other_income'),
        (v_company_id, '4020', 'Discounts Given', 'revenue', 'contra_revenue', 'debit', FALSE, NULL),

    -- EXPENSES
        (v_company_id, '5000', 'Advertising & Marketing', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5010', 'Software & Subscriptions', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5020', 'Telephone & Internet', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5030', 'Vehicle & Transport', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5040', 'Rent & Occupancy', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5050', 'Professional Fees', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5060', 'Bank Charges & Fees', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5070', 'Repairs & Maintenance', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5080', 'Office Supplies & Stationery', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5090', 'Insurance', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5100', 'Utilities', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5110', 'Meals & Entertainment (50% deductible)', 'expense', 'operating_expense', 'debit', FALSE, 's04_allowable_deductions'),
        (v_company_id, '5120', 'Depreciation (Book Only — NOT tax deductible)', 'expense', 'non_cash_expense', 'debit', TRUE, 'non_deductible'),
        (v_company_id, '5200', 'Non-Deductible Expenses', 'expense', 'non_deductible_expense', 'debit', TRUE, 'non_deductible'),
        (v_company_id, '5300', 'Income Tax Expense', 'expense', 'tax_expense', 'debit', TRUE, NULL),
        (v_company_id, '5310', 'Education Tax Expense', 'expense', 'tax_expense', 'debit', TRUE, NULL),
        (v_company_id, '5320', 'NHT Contributions Expense', 'expense', 'tax_expense', 'debit', TRUE, NULL),
        (v_company_id, '5330', 'NIS Contributions Expense', 'expense', 'tax_expense', 'debit', TRUE, NULL);

END $$;

-- ============================================================================
-- 18. SEED DATA — ACCOUNTING SETTINGS
-- ============================================================================
DO $$
DECLARE
    v_company_id UUID;
BEGIN
    SELECT id INTO v_company_id FROM companies LIMIT 1;
    IF v_company_id IS NULL THEN RETURN; END IF;

    INSERT INTO accounting_settings (company_id, business_type, nht_category, gct_registered, accounting_basis)
    VALUES (v_company_id, 'sole_trader', 'cat1_5', FALSE, 'accrual')
    ON CONFLICT (company_id) DO NOTHING;
END $$;

-- ============================================================================
-- 19. SEED DATA — TAX POLICY STORE (Jamaica 2025 & 2026)
-- ============================================================================
INSERT INTO tax_policy_store (jurisdiction, policy_key, policy_value, policy_label, effective_date, notes)
VALUES
    -- Income Tax Thresholds
    ('JM', 'IT_THRESHOLD_JMD', 1500096, 'Annual Income Tax Free Threshold (JMD)', '2024-04-01', 'FY 2024/25 threshold'),
    ('JM', 'IT_THRESHOLD_JMD', 1902360, 'Annual Income Tax Free Threshold (JMD)', '2026-04-01', 'FY 2026/27 threshold effective April 1 2026 — use blended calc for calendar year 2026'),

    -- Income Tax Rates
    ('JM', 'IT_RATE_STANDARD', 0.25, 'Income Tax Rate (standard band)', '2020-01-01', '25% on chargeable income up to high band'),
    ('JM', 'IT_RATE_HIGH', 0.30, 'Income Tax Rate (high band)', '2020-01-01', '30% on chargeable income above 6M JMD'),
    ('JM', 'IT_HIGH_BAND_JMD', 6000000, 'Income Tax Higher Band Threshold (JMD)', '2020-01-01', '25% applies up to this; 30% above'),

    -- NHT
    ('JM', 'NHT_RATE_CAT1_5', 0.03, 'NHT Self-Employed Rate (Categories 1–5)', '2020-01-01', '3% of income for most self-employed categories'),
    ('JM', 'NHT_RATE_CAT6_7', 0.02, 'NHT Self-Employed Rate (Categories 6–7)', '2020-01-01', '2% of income for categories 6 and 7'),

    -- NIS
    ('JM', 'NIS_RATE_SELF_EMPLOYED', 0.03, 'NIS Self-Employed Contribution Rate', '2024-01-01', 'Confirm current rate with MLSS'),
    ('JM', 'NIS_WAGE_CEILING_JMD', 1500000, 'NIS Annual Wage Ceiling (JMD)', '2024-01-01', 'NIS contributions capped at this income level — confirm with MLSS'),

    -- Education Tax
    ('JM', 'EDU_TAX_RATE_SELF', 0.0225, 'Education Tax Rate (self-employed / employee)', '2020-01-01', '2.25% on statutory income'),
    ('JM', 'EDU_TAX_RATE_EMPLOYER', 0.035, 'Education Tax Rate (employer)', '2020-01-01', '3.5% — relevant once payroll is introduced'),

    -- GCT
    ('JM', 'GCT_STANDARD_RATE', 0.15, 'GCT Standard Rate', '2020-01-01', '15% on standard-rated supplies'),
    ('JM', 'GCT_REGISTRATION_THRESHOLD_JMD', 10000000, 'GCT Registration Threshold (JMD)', '2020-01-01', 'Old threshold'),
    ('JM', 'GCT_REGISTRATION_THRESHOLD_JMD', 15000000, 'GCT Registration Threshold (JMD)', '2025-04-01', 'Increased to JMD 15M effective April 1 2025'),

    -- Filing Deadlines (stored as day-of-year pattern, 'MM-DD')
    ('JM', 'SOLE_TRADER_S04_DEADLINE', 315, 'Sole Trader S04 Filing Deadline (MMDD)', '2020-01-01', 'March 15 each year'),
    ('JM', 'SOLE_TRADER_S04A_DEADLINE', 315, 'Sole Trader S04A (Estimate) Filing Deadline (MMDD)', '2020-01-01', 'March 15 each year'),
    ('JM', 'CORPORATE_FILING_DEADLINE', 415, 'Corporate IT02 Filing Deadline (MMDD)', '2025-01-01', 'Moved from March 15 to April 15 effective YA 2025 (first affected: April 15 2026)')

ON CONFLICT (jurisdiction, policy_key, effective_date) DO NOTHING;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after the migration to confirm success.

-- 1. Check all new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
    'accounting_settings','tax_policy_store','coa_accounts',
    'journal_entries','journal_lines','accounting_events',
    'closed_periods','expense_records','fixed_assets',
    'depreciation_schedules','capital_allowance_schedules',
    'gct_config','owner_pack_reports','tax_pack_reports'
)
ORDER BY table_name;

-- 2. CoA Row Count (should be 36 for default company)
SELECT COUNT(*) as coa_count FROM coa_accounts;

-- 3. Tax Policy Row Count (should be ~16)
SELECT COUNT(*) as policy_count FROM tax_policy_store;

-- 4. Sample CoA
SELECT account_code, account_name, account_type, normal_balance
FROM coa_accounts ORDER BY account_code LIMIT 10;
