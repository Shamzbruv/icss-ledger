
-- =============================================
-- FIX INVOICE NUMBER TYPE
-- The 'invoice_number' column was created as SERIAL (Integer), but uses 'INV-ICSS-XXX' formatting.
-- usage: Run this script in your Supabase SQL Editor.
-- =============================================

BEGIN;

-- 1. Change column type to TEXT
-- We use 'USING invoice_number::TEXT' to convert existing numbers to strings safely.
ALTER TABLE invoices
ALTER COLUMN invoice_number TYPE TEXT USING invoice_number::TEXT;

-- 2. Drop the default value (the auto-increment sequence)
-- We are generating the number in the code now, so we don't need the database to auto-increment it.
ALTER TABLE invoices
ALTER COLUMN invoice_number DROP DEFAULT;

COMMIT;
