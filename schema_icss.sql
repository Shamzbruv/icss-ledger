-- =============================================
-- ICREATE SOLUTIONS & SERVICES - SUBSCRIPTION & INTELLIGENCE UPGRADE
-- =============================================

-- 1. Add Subscription Tracking columns to Invoices
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS billing_cycle TEXT, -- 'monthly', 'yearly'
ADD COLUMN IF NOT EXISTS plan_name TEXT,     -- e.g. 'Pro Plan'
ADD COLUMN IF NOT EXISTS renewal_date DATE,
ADD COLUMN IF NOT EXISTS next_invoice_date DATE;

-- 2. Indexes for efficient lookup of renewals
CREATE INDEX IF NOT EXISTS idx_invoices_renewal ON invoices(renewal_date);
CREATE INDEX IF NOT EXISTS idx_invoices_is_sub ON invoices(is_subscription);
