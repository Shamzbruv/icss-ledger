-- ============================================================================
-- ICSS COMMAND CENTER — FORCE FIX JOURNAL SCHEMA
-- This script safely drops the broken journal tables and recreates them.
-- ============================================================================
BEGIN;

-- 1. Remove the broken journal_lines table first so we don't have dependency errors
DROP TABLE IF EXISTS journal_lines CASCADE;

-- 2. Create the missing journal_entries table
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    period TEXT NOT NULL,
    description TEXT NOT NULL,
    reference TEXT,
    source_type TEXT,
    source_id UUID,
    accounting_event_id UUID,
    is_reversal BOOLEAN DEFAULT FALSE,
    reverses_entry_id UUID,
    reversed_by_entry_id UUID,
    is_post_close_adjustment BOOLEAN DEFAULT FALSE,
    is_period_locked BOOLEAN DEFAULT FALSE,
    created_by TEXT DEFAULT 'system',
    report_run_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT no_self_reversal CHECK (id <> reverses_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_journal_company_period ON journal_entries(company_id, period);
CREATE INDEX IF NOT EXISTS idx_journal_source ON journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(company_id, entry_date DESC);
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

-- 3. Recreate the journal_lines table with the proper foreign key to journal_entries
CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_code TEXT NOT NULL,
    account_name TEXT NOT NULL,
    debit_amount NUMERIC(15, 2) DEFAULT 0.00,
    credit_amount NUMERIC(15, 2) DEFAULT 0.00,
    currency TEXT DEFAULT 'JMD',
    fx_rate NUMERIC(10, 4) DEFAULT 1.0000,
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
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

-- 4. Safely add journal_entry_id to accounting_events 
-- If accounting_events already has it, this command does nothing.
ALTER TABLE accounting_events ADD COLUMN IF NOT EXISTS journal_entry_id UUID;

-- Now add the foreign key constraint safely
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accounting_events_journal_entry_id_fkey'
    ) THEN
        ALTER TABLE accounting_events 
        ADD CONSTRAINT accounting_events_journal_entry_id_fkey 
        FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id);
    END IF;
END $$;


-- 5. Enable RLS Policies for new tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all (ICSS internal)' AND tablename = 'journal_entries') THEN
        CREATE POLICY "Allow all (ICSS internal)" ON journal_entries FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all (ICSS internal)' AND tablename = 'journal_lines') THEN
        CREATE POLICY "Allow all (ICSS internal)" ON journal_lines FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
