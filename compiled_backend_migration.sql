-- ============================================================================
-- ICSS COMMAND CENTER - COMPILED BACKEND MIGRATION (LAST 3 HOURS)
-- ============================================================================
-- 
-- DESCRIPTION:
-- This script consolidates all schema updates required for:
-- 1. Invoice Status & Payment Tracking (Unpaid, Paid, Deposit, Partial)
-- 2. Client Care Pulse Scheduling (Frequency, Time, Timezones)
-- 3. Monthly Pulse Summaries & Reporting History
-- 4. Database Integrity (Cascade Deletes)
--
-- INSTRUCTIONS:
-- Run this script in your Supabase SQL Editor.
-- ============================================================================

BEGIN;

-- 1. INVOICE STATUS UPGRADE
-- ----------------------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'UNPAID';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC(5, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

-- Ensure subscription fields exist (re-affirming from previous tasks)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS renewal_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Trigger to auto-update updated_at
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

-- 2. CLIENT CARE PULSE SCHEDULING
-- ----------------------------------------------------------------------------
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_time TIME DEFAULT '09:00:00';
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Jamaica';
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_day_of_week INT; -- 0-6 (Sun-Sat)
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_day_of_month INT; -- 1-28
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_week_of_month INT; -- 1-4
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP WITH TIME ZONE;

-- 3. MONTHLY PULSE SUMMARIES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_pulse_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    month TEXT NOT NULL, -- Format: 'YYYY-MM'
    total_reports_sent INT DEFAULT 0,
    pass_count INT DEFAULT 0,
    warn_count INT DEFAULT 0,
    fail_count INT DEFAULT 0,
    overall_status TEXT, -- 'Mostly Healthy', 'Needs Attention', 'Critical Issues'
    top_issues_json JSONB DEFAULT '[]'::JSONB,
    recommendations_text TEXT,
    emailed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(client_id, month)
);

-- Index for faster filtering
CREATE INDEX IF NOT EXISTS idx_monthly_summaries_client_month ON monthly_pulse_summaries(client_id, month);

-- 4. REPORT HISTORY
-- ----------------------------------------------------------------------------
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

-- Indexes for history tracking
CREATE INDEX IF NOT EXISTS idx_client_care_reports_sent_at ON client_care_reports(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_care_reports_service ON client_care_reports(client_service_id);

-- 5. DATABASE INTEGRITY (CASCADE DELETES)
-- ----------------------------------------------------------------------------
-- Safely update foreign keys to ensure cascade delete works for better service cleanup

DO $$
BEGIN
    -- Fix checklist_runs FK
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'checklist_runs_client_service_id_fkey') THEN
        ALTER TABLE checklist_runs DROP CONSTRAINT checklist_runs_client_service_id_fkey;
    END IF;
    ALTER TABLE checklist_runs ADD CONSTRAINT checklist_runs_client_service_id_fkey 
        FOREIGN KEY (client_service_id) REFERENCES client_services(id) ON DELETE CASCADE;

    -- Fix checklist_run_items FK
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'checklist_run_items_checklist_run_id_fkey') THEN
        ALTER TABLE checklist_run_items DROP CONSTRAINT checklist_run_items_checklist_run_id_fkey;
    END IF;
    ALTER TABLE checklist_run_items ADD CONSTRAINT checklist_run_items_checklist_run_id_fkey 
        FOREIGN KEY (checklist_run_id) REFERENCES checklist_runs(id) ON DELETE CASCADE;
END $$;

-- 6. PERMISSIONS & RLS
-- ----------------------------------------------------------------------------
ALTER TABLE monthly_pulse_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_care_reports ENABLE ROW LEVEL SECURITY;

-- Simple public access policy (matching your current dev environment)
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

-- Added 2026-02-21: Add checklist template for Content Refresh Plan
INSERT INTO checklist_templates (plan_id, items_json) 
VALUES (
    '54d88327-e5bd-47d2-95aa-b60bc7baafd5', 
    '[
      {"code": "UPTIME", "type": "auto", "label": "Website Availability"},
      {"code": "PERF_LIGHT", "type": "auto", "label": "Performance Check"},
      {"code": "API_HEALTH", "type": "auto", "label": "API Integrations"}
    ]'::jsonb
);
