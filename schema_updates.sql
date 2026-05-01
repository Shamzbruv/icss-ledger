-- =============================================
-- SMART BANK REFERENCE FEATURE UPDATES
-- Run this if you have already set up the initial tables.
-- =============================================

-- 1. Create Services Table (Optional, or just use as lookup)
CREATE TABLE IF NOT EXISTS services (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

INSERT INTO services (code, name) VALUES 
('WEB', 'Website Development'),
('HOST', 'Web Hosting'),
('SUB', 'Subscription'),
('APP', 'App Development'),
('GD', 'Graphic Design'),
('CON', 'Consultation'),
('CUST', 'Custom Service')
ON CONFLICT (code) DO NOTHING;

-- 2. Update Invoices Table with new columns
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS service_code TEXT DEFAULT 'CUST',
ADD COLUMN IF NOT EXISTS payment_expected_type TEXT DEFAULT 'FULL', -- 'FULL' or 'PARTIAL'
ADD COLUMN IF NOT EXISTS payment_expected_percentage INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS reference_code TEXT,
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(10, 2) DEFAULT 0.00;

-- 3. Update Invoices Table to support "PARTIAL" status tracking if not already present
-- (Already have 'status' text, can use 'partial' as a value)

-- 4. Initial update for existing invoices (optional cleanup)
UPDATE invoices SET remaining_amount = total_amount WHERE remaining_amount = 0 AND status = 'pending';
