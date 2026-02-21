-- =============================================
-- INVOICE STATUS & PAYMENT TRACKING UPGRADE
-- =============================================

BEGIN;

-- Add new fields to invoices table
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'UNPAID',
ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

-- Add check constraint for payment_status
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_payment_status'
    ) THEN
        ALTER TABLE invoices ADD CONSTRAINT check_payment_status 
        CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'DEPOSIT', 'PAID'));
    END IF;
END $$;

-- Update existing records: if status is 'paid', set payment_status to 'PAID'
UPDATE invoices SET payment_status = 'PAID' WHERE status = 'paid';
UPDATE invoices SET payment_status = 'UNPAID' WHERE status != 'paid' OR status IS NULL;

-- Initialize balance_due for existing records
UPDATE invoices SET balance_due = total_amount - amount_paid WHERE balance_due IS NULL;

COMMIT;
