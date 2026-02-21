-- ============================================================================
-- ICSS COMMAND CENTER - COMPLETE SUPABASE MIGRATION SCRIPT (V3)
-- ============================================================================
-- 
-- DESCRIPTION:
-- This script aggregates all necessary tables, columns, and relationships.
-- It ensures tables exist, columns exist, and unique constraints exist
-- to support idempotent inserts.
--
-- INSTRUCTIONS:
-- 1. Run this entire script in the Supabase SQL Editor.
-- 2. It is safe to run multiple times.
-- ============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

BEGIN;

-- ============================================================================
-- 1. CORE & SAAS (Multi-Tenant)
-- ============================================================================

-- Companies Table
CREATE TABLE IF NOT EXISTS companies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL UNIQUE
);

-- Safely Add Columns to Companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_email TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'Free';

-- Ensure Unique Constraint on Prefix (Required for ON CONFLICT)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_prefix_key') THEN
        ALTER TABLE companies ADD CONSTRAINT companies_prefix_key UNIQUE (prefix);
    END IF;
END $$;

-- Seed Default Companies
INSERT INTO companies (name, prefix, email) VALUES 
('iCreate Solutions & Services', 'ICSS', 'admin@icreate.com'),
('Windross Tailoring', 'WIND', 'info@windross.com'),
('Grace Connect', 'GRCE', 'contact@graceconnect.com')
ON CONFLICT (prefix) DO NOTHING;

-- Clients Table
CREATE TABLE IF NOT EXISTS clients (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    address TEXT,
    phone TEXT
);

-- Safely Add Columns to Clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- ============================================================================
-- 2. INVOICING & PAYMENTS
-- ============================================================================

-- Services Catalog
CREATE TABLE IF NOT EXISTS services (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- Safely Add Columns to Services
ALTER TABLE services ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- Ensure Unique/PK Constraint on Code (Required for ON CONFLICT)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_pkey') THEN
        ALTER TABLE services ADD CONSTRAINT services_pkey PRIMARY KEY (code);
    END IF;
END $$;

-- Seed Default Services
INSERT INTO services (code, name) VALUES 
('WEB', 'Website Development'),
('HOST', 'Web Hosting'),
('SUB', 'Subscription'),
('APP', 'App Development'),
('GD', 'Graphic Design'),
('CON', 'Consultation'),
('CUST', 'Custom Service')
ON CONFLICT (code) DO NOTHING;

-- Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    invoice_number TEXT,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    issue_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    status TEXT DEFAULT 'pending',
    total_amount NUMERIC(10, 2) DEFAULT 0.00,
    notes TEXT
);

-- Safely Add Columns to Invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(10, 2) DEFAULT 0.00;
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

-- Ensure invoice_number is TEXT (Fix for legacy SERIAL types)
ALTER TABLE invoices ALTER COLUMN invoice_number TYPE TEXT;

-- Add Unique Constraint to Invoice Number
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_invoice_number_key') THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);
    END IF;
END $$;

-- Invoice Items Table
CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10, 2) DEFAULT 1,
    unit_price NUMERIC(10, 2) DEFAULT 0.00
);

-- Attempt to add generated column for line_total if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'line_total') THEN
        ALTER TABLE invoice_items ADD COLUMN line_total NUMERIC(10, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED;
    END IF;
END $$;


-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    method TEXT NOT NULL,
    reference_id TEXT,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- ============================================================================
-- 3. CLIENT CARE PULSE (Monitoring & Reporting)
-- ============================================================================

-- Service Plans
CREATE TABLE IF NOT EXISTS service_plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    default_frequency TEXT DEFAULT 'monthly',
    price NUMERIC(10, 2),
    features_json JSONB DEFAULT '[]'::JSONB
);

-- Ensure Unique/PK Constraint on Name (Required for ON CONFLICT)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_name_key') THEN
        ALTER TABLE service_plans ADD CONSTRAINT service_plans_name_key UNIQUE (name);
    END IF;
END $$;

-- Seed Service Plans
INSERT INTO service_plans (name, default_frequency) VALUES 
('Standard Care', 'monthly'),
('Premium Care', 'weekly')
ON CONFLICT (name) DO NOTHING;

-- Client Services
CREATE TABLE IF NOT EXISTS client_services (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES service_plans(id),
    status TEXT DEFAULT 'active'
);

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

-- ============================================================================
-- 4. PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_renewal ON invoices(renewal_date);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

CREATE INDEX IF NOT EXISTS idx_checklist_runs_service ON checklist_runs(client_service_id);
CREATE INDEX IF NOT EXISTS idx_client_care_reports_sent ON client_care_reports(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_items_run ON checklist_run_items(checklist_run_id);
CREATE INDEX IF NOT EXISTS idx_client_services_status ON client_services(status);

COMMIT;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
