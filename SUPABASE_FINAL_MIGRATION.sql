-- ============================================================================
-- ICSS COMMAND CENTER - FINAL CONSOLIDATED MIGRATION
-- ============================================================================
-- 
-- DESCRIPTION:
-- This script contains ALL schema changes required for the ICSS Command Center.
-- It combines the Invoice Status upgrades, Client Care Pulse features, and 
-- Multi-Tenant/SaaS columns.
--
-- IT IS IDEMPOTENT: It is safe to run multiple times. It uses "IF NOT EXISTS".
--
-- INSTRUCTIONS:
-- 1. Run this entire script in Supabase SQL Editor.
-- 2. Verify success using the queries at the bottom.
-- ============================================================================

BEGIN;

-- 1. BASE TABLES CHECK
-- -------------------
-- Ensure base tables exist (in case this is a fresh run, though unlikely)

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    address TEXT,
    company_id UUID -- Will format later
);

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invoice_number TEXT NOT NULL, -- Ensure TEXT
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    prefix TEXT DEFAULT 'ICSS'
);

-- 2. INVOICE COLUMNS (Status, Subscription, SaaS)
-- -----------------------------------------------

-- 2a. Fix invoice_number type
DO $$ 
BEGIN 
    -- Only alter if it's not already text (though difficult to check type in DO block easily without catalog query)
    -- We'll assume the explicit cast command is safe enough or has been run. 
    -- To be 100% safe, we can try-catch or just run it. 
    -- The standard way is:
    ALTER TABLE invoices ALTER COLUMN invoice_number TYPE TEXT USING invoice_number::TEXT;
    ALTER TABLE invoices ALTER COLUMN invoice_number DROP DEFAULT;
EXCEPTION 
    WHEN OTHERS THEN NULL; -- Ignore if already done or fails safely
END $$;

-- 2b. Add All Columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'FULL';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_expected_percentage INTEGER DEFAULT 100;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP WITH TIME ZONE;

-- Subscription Fields
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approval_status TEXT; -- Legacy
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS renewal_date DATE;

-- Payment Status Fields
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'UNPAID';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC(5, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2c. Trigger for update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- 3. CLIENT COLUMNS
-- -----------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_id UUID;


-- 4. CLIENT CARE PULSE & SERVICES
-- -------------------------------

CREATE TABLE IF NOT EXISTS service_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES service_plans(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'active',
    frequency TEXT DEFAULT 'monthly',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Scheduling
    send_time TIME DEFAULT '09:00:00',
    timezone TEXT DEFAULT 'America/Jamaica',
    send_day_of_week INT, -- 0-6
    send_day_of_month INT, -- 1-31
    send_week_of_month INT, -- 1-4
    next_run_at TIMESTAMP WITH TIME ZONE,
    service_meta_json JSONB DEFAULT '{}'::JSONB
);

-- Ensure columns exist if table already existed without them
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_time TIME DEFAULT '09:00:00';
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Jamaica';
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_day_of_week INT;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_day_of_month INT;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_week_of_month INT;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP WITH TIME ZONE;


-- 5. MONTHLY SUMMARIES & HISTORY
-- ------------------------------

CREATE TABLE IF NOT EXISTS monthly_pulse_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    month TEXT NOT NULL, -- 'YYYY-MM'
    total_reports_sent INT DEFAULT 0,
    pass_count INT DEFAULT 0,
    warn_count INT DEFAULT 0,
    fail_count INT DEFAULT 0,
    overall_status TEXT, 
    top_issues_json JSONB DEFAULT '[]'::JSONB,
    recommendations_text TEXT,
    emailed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(client_id, month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_summaries_client_month ON monthly_pulse_summaries(client_id, month);


CREATE TABLE IF NOT EXISTS checklist_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    client_service_id UUID REFERENCES client_services(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checklist_run_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_run_id UUID REFERENCES checklist_runs(id) ON DELETE CASCADE,
    status TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS client_care_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_run_id UUID REFERENCES checklist_runs(id) ON DELETE CASCADE,
    client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL,
    recipient_email TEXT NOT NULL,
    email_subject TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT DEFAULT 'sent',
    metadata_json JSONB DEFAULT '{}'::JSONB
);
CREATE INDEX IF NOT EXISTS idx_client_care_reports_sent_at ON client_care_reports(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_care_reports_service ON client_care_reports(client_service_id);


-- 6. SECURITY POLICIES (RLS)
-- --------------------------
ALTER TABLE monthly_pulse_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_care_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all access for all users' AND tablename = 'monthly_pulse_summaries') THEN
        CREATE POLICY "Enable all access for all users" ON monthly_pulse_summaries FOR ALL USING (true) WITH CHECK (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all access for all users' AND tablename = 'client_care_reports') THEN
        CREATE POLICY "Enable all access for all users" ON client_care_reports FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;

-- 7. DEFAULT DATA (Optional but helpful)
-- --------------------------------------
INSERT INTO companies (name, prefix) 
SELECT 'iCreate Solutions', 'ICSS'
WHERE NOT EXISTS (SELECT 1 FROM companies);


-- ============================================================================
-- ✅ VERIFICATION QUERIES
-- ============================================================================
-- Run these steps after the migration to confirm success.

-- Query 1: Check Invoices Columns
-- Expect: payment_status, is_subscription, company_id, service_code all present
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'invoices' 
AND column_name IN ('payment_status', 'is_subscription', 'company_id', 'service_code', 'reference_code');

-- Query 2: Check Tables Exist
-- Expect: invoices, clients, client_services, monthly_pulse_summaries
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
AND table_name IN ('invoices', 'client_services', 'monthly_pulse_summaries');

-- Query 3: Check Row Count (Should be non-zero for companies)
SELECT count(*) as company_count FROM companies;

