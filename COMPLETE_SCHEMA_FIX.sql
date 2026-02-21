-- =============================================
-- ADD MISSING COLUMNS TO INVOICES TABLE
-- =============================================
-- INSTRUCTIONS:
-- 1. Go to Supabase Dashboard (https://supabase.com)
-- 2. Select your project: "iCreate Solutions & Services"
-- 3. Click on "SQL Editor" in the left sidebar  
-- 4. Click "New Query"
-- 5. Copy and paste ALL the SQL below
-- 6. Click "Run" or press Cmd+Enter
-- =============================================

BEGIN;

-- First, change invoice_number from SERIAL to TEXT
ALTER TABLE invoices
ALTER COLUMN invoice_number TYPE TEXT USING invoice_number::TEXT;

ALTER TABLE invoices
ALTER COLUMN invoice_number DROP DEFAULT;

-- Now add all the missing columns needed for subscriptions and renewals
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS company_id UUID,
ADD COLUMN IF NOT EXISTS service_code TEXT,
ADD COLUMN IF NOT EXISTS reference_code TEXT,
ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'FULL',
ADD COLUMN IF NOT EXISTS payment_expected_percentage INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS plan_name TEXT,
ADD COLUMN IF NOT EXISTS billing_cycle TEXT,
ADD COLUMN IF NOT EXISTS renewal_date DATE;

COMMIT;

-- =============================================
-- ALL DONE! Now you can create invoices with subscriptions and renewals!
-- =============================================
