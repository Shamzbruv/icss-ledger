-- ===================================================================
-- CRITICAL: ADD MISSING COLUMNS TO INVOICES TABLE
-- ===================================================================
-- Copy EXACTLY from line 10 to line 34 (everything between the lines)
-- ===================================================================

-- Convert invoice_number to TEXT
ALTER TABLE invoices ALTER COLUMN invoice_number TYPE TEXT USING invoice_number::TEXT;
ALTER TABLE invoices ALTER COLUMN invoice_number DROP DEFAULT;

-- Add all missing columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'FULL';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_expected_percentage INTEGER DEFAULT 100;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS renewal_date DATE;

-- ===================================================================
-- AFTER RUNNING: Check that columns exist by running this query:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices';
-- ===================================================================
