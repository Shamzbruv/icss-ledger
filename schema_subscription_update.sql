-- =============================================
-- SUBSCRIPTION FEATURE UPDATES
-- Run this in your Supabase SQL Editor to enable subscription tracking.
-- =============================================

ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS billing_cycle TEXT, -- 'Monthly', 'Yearly', etc.
ADD COLUMN IF NOT EXISTS plan_name TEXT,
ADD COLUMN IF NOT EXISTS renewal_date TIMESTAMP WITH TIME ZONE;

-- Optional: Create an index on is_subscription for faster filtering
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices(is_subscription);
