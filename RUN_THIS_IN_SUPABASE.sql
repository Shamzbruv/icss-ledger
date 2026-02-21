-- =============================================
-- FIX INVOICE NUMBER TYPE
-- =============================================
-- INSTRUCTIONS:
-- 1. Go to Supabase Dashboard (https://supabase.com)
-- 2. Select your project
-- 3. Click on "SQL Editor" in the left sidebar
-- 4. Click "New Query"
-- 5. Copy and paste the SQL below
-- 6. Click "Run" or press Cmd+Enter
-- =============================================

BEGIN;

-- Change invoice_number column from SERIAL (integer) to TEXT
ALTER TABLE invoices
ALTER COLUMN invoice_number TYPE TEXT USING invoice_number::TEXT;

-- Remove the auto-increment default since we generate the number in code
ALTER TABLE invoices
ALTER COLUMN invoice_number DROP DEFAULT;

COMMIT;

-- =============================================
-- After running this, your invoices will use the INV-ICSS-XXX format!
-- =============================================
