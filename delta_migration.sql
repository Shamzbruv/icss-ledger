-- ============================================================================
-- ICSS COMMAND CENTER - BULLETPROOF DELTA MIGRATION SCRIPT
-- ============================================================================
-- 
-- DESCRIPTION:
-- This script fixes partial states where tables exist but columns are missing.
-- It aggressively checks for every required column and adds it if missing.
--
-- INSTRUCTIONS:
-- 1. Run this script in Supabase SQL Editor.
-- ============================================================================

BEGIN;

-- 1. FIX SERVICE PLANS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    default_frequency TEXT DEFAULT 'monthly',
    price NUMERIC(10, 2) DEFAULT 0.00,
    features_json JSONB DEFAULT '[]'::JSONB
);

-- Safely add columns if missing in existing table
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS default_frequency TEXT DEFAULT 'monthly';
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS features_json JSONB DEFAULT '[]'::JSONB;

-- Safely add UNIQUE constraint to 'name'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_name_key') THEN
        ALTER TABLE service_plans ADD CONSTRAINT service_plans_name_key UNIQUE (name);
    END IF;
END $$;

-- Insert Plans
INSERT INTO service_plans (name, default_frequency, price) VALUES 
('Standard Care', 'monthly', 29.99),
('Premium Care', 'weekly', 99.99)
ON CONFLICT (name) DO UPDATE 
SET price = EXCLUDED.price WHERE service_plans.price IS NULL;


-- 2. CLIENT CARE PULSE TABLES
-- ----------------------------------------------------------------------------

-- Client Services
CREATE TABLE IF NOT EXISTS client_services (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES service_plans(id),
    status TEXT DEFAULT 'active'
);

-- Ensure all columns exist
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS last_emailed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS frequency TEXT;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS service_meta_json JSONB DEFAULT '{}'::JSONB;


-- Checklist Templates
CREATE TABLE IF NOT EXISTS checklist_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    plan_id UUID REFERENCES service_plans(id) ON DELETE CASCADE,
    name TEXT,
    items_json JSONB DEFAULT '[]'::JSONB
);

-- Ensure 'name' column exists (Fix for the specific error encountered)
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS items_json JSONB DEFAULT '[]'::JSONB;

-- Fix for "title" column constraint error if it exists (Legacy column)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'checklist_templates' AND column_name = 'title') THEN
        ALTER TABLE checklist_templates ALTER COLUMN title DROP NOT NULL;
    END IF;
END $$;


-- Checklist Runs
CREATE TABLE IF NOT EXISTS checklist_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    client_service_id UUID REFERENCES client_services(id) ON DELETE CASCADE,
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    run_status TEXT DEFAULT 'completed',
    score INTEGER DEFAULT 0,
    results_json JSONB DEFAULT '[]'::JSONB,
    emailed_at TIMESTAMP WITH TIME ZONE
);

-- Checklist Run Items
CREATE TABLE IF NOT EXISTS checklist_run_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    checklist_run_id UUID REFERENCES checklist_runs(id) ON DELETE CASCADE,
    item_code TEXT,
    label TEXT,
    status TEXT,
    details TEXT,
    evidence_json JSONB DEFAULT '{}'::JSONB
);

-- Client Care Reports
CREATE TABLE IF NOT EXISTS client_care_reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    checklist_run_id UUID REFERENCES checklist_runs(id) ON DELETE CASCADE,
    client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL,
    recipient_email TEXT NOT NULL,
    email_subject TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT DEFAULT 'sent',
    metadata_json JSONB DEFAULT '{}'::JSONB
);


-- 3. MISSING COLUMNS FOR INVOICES (Subscription & Multi-tenant)
-- ----------------------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_code TEXT DEFAULT 'CUST';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'FULL';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_expected_percentage INTEGER DEFAULT 100;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS renewal_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS next_invoice_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(10, 2) DEFAULT 0.00;

-- 4. MISSING COLUMNS FOR COMPANIES
-- ----------------------------------------------------------------------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_email TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'Free';


-- 5. SEED DATA FOR TEMPLATES
-- ----------------------------------------------------------------------------
-- Standard Checks
INSERT INTO checklist_templates (plan_id, name, items_json)
SELECT id, 'Standard Checks', '[
    {"code": "UPTIME", "label": "Website Uptime"},
    {"code": "SSL", "label": "SSL Certificate"},
    {"code": "DNS", "label": "DNS Health"}
]'::JSONB
FROM service_plans WHERE name = 'Standard Care'
AND NOT EXISTS (
    SELECT 1 FROM checklist_templates 
    WHERE plan_id = service_plans.id AND name = 'Standard Checks'
);

-- Premium Checks
INSERT INTO checklist_templates (plan_id, name, items_json)
SELECT id, 'Premium Checks', '[
    {"code": "UPTIME", "label": "Website Uptime"},
    {"code": "SSL", "label": "SSL Certificate"},
    {"code": "DNS", "label": "DNS Health"},
    {"code": "PERF_LIGHT", "label": "Lighthouse Performance"},
    {"code": "API_HEALTH", "label": "API Endpoint Health"}
]'::JSONB
FROM service_plans WHERE name = 'Premium Care'
AND NOT EXISTS (
    SELECT 1 FROM checklist_templates 
    WHERE plan_id = service_plans.id AND name = 'Premium Checks'
);


COMMIT;
