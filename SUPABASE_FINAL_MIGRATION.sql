-- ============================================================================
-- ICSS COMMAND CENTER - FINAL CONSOLIDATED MIGRATION
-- ============================================================================
-- Run this file in the Supabase SQL editor. It is safe to run more than once.
-- It provisions the subscription, invoicing, PayPal, outbox, and Client Care
-- schema used by the current server and service modules.

BEGIN;
SET LOCAL search_path = public;

-- ============================================================================
-- 1. CORE COMPANIES, CLIENTS, AND INVOICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    name TEXT NOT NULL,
    prefix TEXT DEFAULT 'ICSS'
);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE companies ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS prefix TEXT DEFAULT 'ICSS';

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    billing_email TEXT,
    phone TEXT,
    address TEXT,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE clients ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.clients'::regclass
          AND conname = 'clients_company_id_fkey'
    ) THEN
        ALTER TABLE clients
            ADD CONSTRAINT clients_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES companies(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invoice_number TEXT,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    issue_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    status TEXT DEFAULT 'pending',
    total_amount NUMERIC(10, 2) DEFAULT 0.00,
    currency TEXT NOT NULL DEFAULT 'JMD' CHECK (currency IN ('JMD', 'USD')),
    notes TEXT
);

-- Legacy databases used a SERIAL/integer invoice number. Normalize it before
-- the sequence RPC and text-prefixed invoice numbers are used.
DO $$
DECLARE
    invoice_number_type TEXT;
BEGIN
    SELECT data_type
      INTO invoice_number_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoices'
       AND column_name = 'invoice_number';

    IF invoice_number_type IS NOT NULL THEN
        ALTER TABLE invoices ALTER COLUMN invoice_number DROP DEFAULT;
    END IF;

    IF invoice_number_type IS NOT NULL AND invoice_number_type <> 'text' THEN
        ALTER TABLE invoices
            ALTER COLUMN invoice_number TYPE TEXT USING invoice_number::TEXT;
    END IF;
END $$;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issue_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JMD';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'FULL';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_expected_type TEXT DEFAULT 'FULL';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_expected_percentage INTEGER DEFAULT 100;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'UNPAID';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC(5, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approval_status TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS renewal_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS next_invoice_date DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.invoices'::regclass
          AND conname = 'invoices_currency_check'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT invoices_currency_check
            CHECK (currency IN ('JMD', 'USD'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_company_currency
    ON invoices(company_id, currency);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.invoices'::regclass
          AND conname = 'invoices_client_id_fkey'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT invoices_client_id_fkey
            FOREIGN KEY (client_id) REFERENCES clients(id)
            ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.invoices'::regclass
          AND conname = 'invoices_company_id_fkey'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT invoices_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES companies(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Atomic invoice sequencing used by subscriptionBillingService.js.
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq AS BIGINT START WITH 1 INCREMENT BY 1;

DO $$
DECLARE
    maximum_invoice_suffix BIGINT := 0;
    current_sequence_value BIGINT := 1;
    sequence_was_called BOOLEAN := FALSE;
BEGIN
    SELECT COALESCE(MAX(SUBSTRING(invoice_number FROM '([0-9]+)$')::BIGINT), 0)
      INTO maximum_invoice_suffix
      FROM invoices
     WHERE invoice_number ~ '[0-9]+$';

    SELECT last_value, is_called
      INTO current_sequence_value, sequence_was_called
      FROM public.invoice_number_seq;

    IF maximum_invoice_suffix > current_sequence_value
       OR (
           maximum_invoice_suffix = current_sequence_value
           AND maximum_invoice_suffix > 0
           AND NOT sequence_was_called
       ) THEN
        PERFORM setval('public.invoice_number_seq'::regclass, maximum_invoice_suffix, TRUE);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_next_invoice_sequence()
RETURNS BIGINT
LANGUAGE SQL
VOLATILE
SET search_path = public
AS $$
    SELECT nextval('public.invoice_number_seq'::regclass);
$$;

-- ============================================================================
-- 2. SUBSCRIPTIONS, PAYMENTS, PAYPAL, AND ACCOUNTING OUTBOX
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2),
    -- Billing cadence. The four website plans bill monthly.
    default_frequency TEXT DEFAULT 'monthly',
    -- Client Care report cadence is separate from billing cadence.
    default_care_frequency TEXT DEFAULT 'weekly',
    features_json JSONB DEFAULT '[]'::JSONB
);

ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2);
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS default_frequency TEXT DEFAULT 'monthly';
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS default_care_frequency TEXT DEFAULT 'weekly';
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS features_json JSONB DEFAULT '[]'::JSONB;

DO $$
DECLARE
    features_type TEXT;
BEGIN
    SELECT data_type
      INTO features_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'service_plans'
       AND column_name = 'features_json';

    IF features_type = 'json' THEN
        ALTER TABLE service_plans
            ALTER COLUMN features_json TYPE JSONB USING features_json::JSONB;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_plans_name ON service_plans(name);

CREATE TABLE IF NOT EXISTS client_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES service_plans(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'active',
    -- Report/check cadence, not the PayPal billing cadence.
    frequency TEXT DEFAULT 'weekly',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    send_time TIME DEFAULT '09:00:00',
    timezone TEXT DEFAULT 'America/Jamaica',
    send_day_of_week INTEGER,
    send_day_of_month INTEGER,
    send_week_of_month INTEGER,
    next_run_at TIMESTAMP WITH TIME ZONE,
    next_renewal_date DATE,
    next_billing_date DATE,
    last_emailed_at TIMESTAMP WITH TIME ZONE,
    last_renewal_reminder_sent_date DATE,
    service_meta_json JSONB DEFAULT '{}'::JSONB
);

ALTER TABLE client_services ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT 'weekly';
ALTER TABLE client_services ALTER COLUMN frequency SET DEFAULT 'weekly';
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_time TIME DEFAULT '09:00:00';
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Jamaica';
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_day_of_week INTEGER;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_day_of_month INTEGER;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS send_week_of_month INTEGER;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_renewal_date DATE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_billing_date DATE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS last_emailed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS last_renewal_reminder_sent_date DATE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS service_meta_json JSONB DEFAULT '{}'::JSONB;

-- Bring legacy active subscriptions into renewal tracking. `frequency` is the
-- report cadence for website plans, so only an explicit yearly value changes
-- the default monthly billing assumption.
UPDATE client_services
SET next_renewal_date = CASE
    WHEN LOWER(COALESCE(frequency, 'monthly')) = 'yearly'
        THEN COALESCE(start_date, CURRENT_DATE) + INTERVAL '1 year'
    ELSE COALESCE(start_date, CURRENT_DATE) + INTERVAL '1 month'
END
WHERE status = 'active'
  AND next_renewal_date IS NULL;

DO $$
DECLARE
    metadata_type TEXT;
BEGIN
    SELECT data_type
      INTO metadata_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'client_services'
       AND column_name = 'service_meta_json';

    IF metadata_type = 'json' THEN
        ALTER TABLE client_services
            ALTER COLUMN service_meta_json TYPE JSONB USING service_meta_json::JSONB;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.client_services'::regclass
          AND conname = 'client_services_client_id_fkey'
    ) THEN
        ALTER TABLE client_services
            ADD CONSTRAINT client_services_client_id_fkey
            FOREIGN KEY (client_id) REFERENCES clients(id)
            ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.client_services'::regclass
          AND conname = 'client_services_plan_id_fkey'
    ) THEN
        ALTER TABLE client_services
            ADD CONSTRAINT client_services_plan_id_fkey
            FOREIGN KEY (plan_id) REFERENCES service_plans(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
END $$;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_service_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.invoices'::regclass
          AND conname = 'invoices_client_service_id_fkey'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT invoices_client_service_id_fkey
            FOREIGN KEY (client_service_id) REFERENCES client_services(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10, 2) DEFAULT 1,
    unit_price NUMERIC(10, 2) DEFAULT 0.00
);

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS invoice_id UUID;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(10, 2) DEFAULT 1;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10, 2) DEFAULT 0.00;

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    amount NUMERIC(10, 2) NOT NULL,
    method TEXT,
    reference_id TEXT,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    receipt_email_status TEXT,
    receipt_email_claimed_at TIMESTAMP WITH TIME ZONE,
    receipt_email_sent_at TIMESTAMP WITH TIME ZONE,
    receipt_email_last_error TEXT
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_email_status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_email_claimed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_email_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_email_last_error TEXT;

CREATE TABLE IF NOT EXISTS paypal_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paypal_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    resource_id TEXT,
    custom_id TEXT,
    payload_jsonb JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    processed_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    recovery_attempt_count INTEGER NOT NULL DEFAULT 0,
    recovery_last_requested_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS paypal_event_id TEXT;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS resource_id TEXT;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS custom_id TEXT;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS payload_jsonb JSONB;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'received';
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS recovery_attempt_count INTEGER DEFAULT 0;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS recovery_last_requested_at TIMESTAMP WITH TIME ZONE;
UPDATE paypal_webhook_events SET recovery_attempt_count = 0 WHERE recovery_attempt_count IS NULL;
ALTER TABLE paypal_webhook_events ALTER COLUMN recovery_attempt_count SET DEFAULT 0;
ALTER TABLE paypal_webhook_events ALTER COLUMN recovery_attempt_count SET NOT NULL;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    company_id UUID NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_version INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_jsonb JSONB NOT NULL,
    publish_status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS aggregate_type TEXT;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS aggregate_id UUID;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS event_version INTEGER;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS payload_jsonb JSONB;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS publish_status TEXT DEFAULT 'pending';
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP WITH TIME ZONE;

-- Accounting projector idempotency gate. Without this table, every queued
-- invoice/payment event fails before journal projection.
CREATE TABLE IF NOT EXISTS consumed_events (
    company_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_id UUID NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, idempotency_key)
);
ALTER TABLE consumed_events ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE consumed_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE consumed_events ADD COLUMN IF NOT EXISTS event_id UUID;
ALTER TABLE consumed_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
DROP INDEX IF EXISTS idx_consumed_events_company_idempotency;
CREATE UNIQUE INDEX idx_consumed_events_company_idempotency
    ON consumed_events(company_id, idempotency_key);

-- Public Link Hub content is read through GET /api/link-hub and edited only
-- through the authenticated admin endpoint. Keeping the source row private
-- prevents visitors from bypassing the server-side content contract.
CREATE TABLE IF NOT EXISTS link_hub_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    content JSONB NOT NULL DEFAULT '{}'::JSONB,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE link_hub_settings ADD COLUMN IF NOT EXISTS id INTEGER;
ALTER TABLE link_hub_settings ADD COLUMN IF NOT EXISTS content JSONB DEFAULT '{}'::JSONB;
ALTER TABLE link_hub_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

DO $$
DECLARE
    content_type TEXT;
BEGIN
    SELECT data_type
      INTO content_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'link_hub_settings'
       AND column_name = 'content';

    IF content_type = 'json' THEN
        ALTER TABLE link_hub_settings
            ALTER COLUMN content TYPE JSONB USING content::JSONB;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_link_hub_settings_singleton
    ON link_hub_settings(id);

-- ============================================================================
-- 3. CLIENT CARE CHECKLISTS, REPORTS, AND MONTHLY SUMMARIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID REFERENCES service_plans(id) ON DELETE CASCADE,
    name TEXT,
    items_json JSONB DEFAULT '[]'::JSONB
);

ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS items_json JSONB DEFAULT '[]'::JSONB;

-- An older checklist migration used title NOT NULL instead of name. Retain the
-- legacy column but remove its insert blocker.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'checklist_templates'
          AND column_name = 'title'
    ) THEN
        ALTER TABLE checklist_templates ALTER COLUMN title DROP NOT NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS checklist_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    client_service_id UUID REFERENCES client_services(id) ON DELETE CASCADE,
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    run_status TEXT DEFAULT 'completed',
    score INTEGER DEFAULT 0,
    results_json JSONB DEFAULT '[]'::JSONB,
    emailed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE checklist_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE checklist_runs ADD COLUMN IF NOT EXISTS client_service_id UUID;
ALTER TABLE checklist_runs ADD COLUMN IF NOT EXISTS period_start TIMESTAMP WITH TIME ZONE;
ALTER TABLE checklist_runs ADD COLUMN IF NOT EXISTS period_end TIMESTAMP WITH TIME ZONE;
ALTER TABLE checklist_runs ADD COLUMN IF NOT EXISTS run_status TEXT DEFAULT 'completed';
ALTER TABLE checklist_runs ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0;
ALTER TABLE checklist_runs ADD COLUMN IF NOT EXISTS results_json JSONB DEFAULT '[]'::JSONB;
ALTER TABLE checklist_runs ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS checklist_run_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_run_id UUID REFERENCES checklist_runs(id) ON DELETE CASCADE,
    item_code TEXT,
    label TEXT,
    status TEXT,
    details TEXT,
    notes TEXT,
    evidence_json JSONB DEFAULT '{}'::JSONB
);

ALTER TABLE checklist_run_items ADD COLUMN IF NOT EXISTS checklist_run_id UUID;
ALTER TABLE checklist_run_items ADD COLUMN IF NOT EXISTS item_code TEXT;
ALTER TABLE checklist_run_items ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE checklist_run_items ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE checklist_run_items ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE checklist_run_items ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE checklist_run_items ADD COLUMN IF NOT EXISTS evidence_json JSONB DEFAULT '{}'::JSONB;

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

ALTER TABLE client_care_reports ADD COLUMN IF NOT EXISTS checklist_run_id UUID;
ALTER TABLE client_care_reports ADD COLUMN IF NOT EXISTS client_service_id UUID;
ALTER TABLE client_care_reports ADD COLUMN IF NOT EXISTS recipient_email TEXT;
ALTER TABLE client_care_reports ADD COLUMN IF NOT EXISTS email_subject TEXT;
ALTER TABLE client_care_reports ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE client_care_reports ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';
ALTER TABLE client_care_reports ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::JSONB;

CREATE TABLE IF NOT EXISTS monthly_pulse_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    total_reports_sent INTEGER DEFAULT 0,
    pass_count INTEGER DEFAULT 0,
    warn_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    overall_status TEXT,
    top_issues_json JSONB DEFAULT '[]'::JSONB,
    recommendations_text TEXT,
    emailed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (client_id, month)
);

ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS month TEXT;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS total_reports_sent INTEGER DEFAULT 0;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS pass_count INTEGER DEFAULT 0;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS warn_count INTEGER DEFAULT 0;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS fail_count INTEGER DEFAULT 0;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS overall_status TEXT;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS top_issues_json JSONB DEFAULT '[]'::JSONB;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS recommendations_text TEXT;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE monthly_pulse_summaries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Durable welcome/birthday email claims prevent duplicate sends when webhook
-- retries or overlapping schedulers process the same client event.
CREATE TABLE IF NOT EXISTS client_relationship_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL,
    message_type TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    sent_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT
);

ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS client_service_id UUID;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS message_type TEXT;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS occurrence_key TEXT;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'processing';
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS last_error TEXT;

-- ============================================================================
-- 4. CANONICAL WEBSITE PLANS AND DEFAULT HEALTH CHECKLISTS
-- ============================================================================

-- default_frequency remains monthly because it is the billing cadence.
-- default_care_frequency records the separate weekly report/check cadence.
WITH canonical_plans AS (
    SELECT *
    FROM jsonb_to_recordset($plans$
    [
      {
        "name": "Hosting Only",
        "description": "Managed hosting for clients who already own their domain.",
        "price": 30.00,
        "default_frequency": "monthly",
        "default_care_frequency": "weekly",
        "features_json": ["Managed website hosting", "cPanel when supported by the website stack", "Weekly website health report", "Google Analytics traffic analysis", "SSL and backups"]
      },
      {
        "name": "Hosting + Domain Management",
        "description": "Managed hosting plus domain registration, renewal, and billing handled by the developer.",
        "price": 38.00,
        "default_frequency": "monthly",
        "default_care_frequency": "weekly",
        "features_json": ["Managed website hosting", "Domain registration, renewals and billing managed by iCreate", "cPanel when supported by the website stack", "Weekly website health report", "Google Analytics traffic analysis", "SSL and backups"]
      },
      {
        "name": "Web Maintenance",
        "description": "Managed hosting and domain care with up to five website patches or updates each month.",
        "price": 49.99,
        "default_frequency": "monthly",
        "default_care_frequency": "weekly",
        "features_json": ["Everything in Hosting + Domain Management", "Up to five website patches or updates monthly", "Cloudflare security monitoring", "Performance monitoring", "Weekly website health report", "Google Analytics traffic analysis"]
      },
      {
        "name": "Content Refresh",
        "description": "Full website care with unlimited edits and content updates.",
        "price": 67.99,
        "default_frequency": "monthly",
        "default_care_frequency": "weekly",
        "features_json": ["Everything in Web Maintenance", "Unlimited edits and content updates to the existing website", "Cloudflare security integration and monitoring", "Weekly website health report", "Google Analytics traffic analysis"]
      }
    ]
    $plans$::JSONB) AS plan_data(
        name TEXT,
        description TEXT,
        price NUMERIC,
        default_frequency TEXT,
        default_care_frequency TEXT,
        features_json JSONB
    )
)
INSERT INTO service_plans (
    name,
    description,
    price,
    default_frequency,
    default_care_frequency,
    features_json
)
SELECT
    canonical_plans.name,
    canonical_plans.description,
    canonical_plans.price,
    canonical_plans.default_frequency,
    canonical_plans.default_care_frequency,
    canonical_plans.features_json
FROM canonical_plans
WHERE NOT EXISTS (
    SELECT 1
    FROM service_plans
    WHERE service_plans.name = canonical_plans.name
);

WITH canonical_plans AS (
    SELECT *
    FROM jsonb_to_recordset($plans$
    [
      {"name":"Hosting Only","description":"Managed hosting for clients who already own their domain.","price":30.00,"default_frequency":"monthly","default_care_frequency":"weekly","features_json":["Managed website hosting","cPanel when supported by the website stack","Weekly website health report","Google Analytics traffic analysis","SSL and backups"]},
      {"name":"Hosting + Domain Management","description":"Managed hosting plus domain registration, renewal, and billing handled by the developer.","price":38.00,"default_frequency":"monthly","default_care_frequency":"weekly","features_json":["Managed website hosting","Domain registration, renewals and billing managed by iCreate","cPanel when supported by the website stack","Weekly website health report","Google Analytics traffic analysis","SSL and backups"]},
      {"name":"Web Maintenance","description":"Managed hosting and domain care with up to five website patches or updates each month.","price":49.99,"default_frequency":"monthly","default_care_frequency":"weekly","features_json":["Everything in Hosting + Domain Management","Up to five website patches or updates monthly","Cloudflare security monitoring","Performance monitoring","Weekly website health report","Google Analytics traffic analysis"]},
      {"name":"Content Refresh","description":"Full website care with unlimited edits and content updates.","price":67.99,"default_frequency":"monthly","default_care_frequency":"weekly","features_json":["Everything in Web Maintenance","Unlimited edits and content updates to the existing website","Cloudflare security integration and monitoring","Weekly website health report","Google Analytics traffic analysis"]}
    ]
    $plans$::JSONB) AS plan_data(
        name TEXT,
        description TEXT,
        price NUMERIC,
        default_frequency TEXT,
        default_care_frequency TEXT,
        features_json JSONB
    )
)
UPDATE service_plans
SET description = canonical_plans.description,
    price = canonical_plans.price,
    default_frequency = canonical_plans.default_frequency,
    default_care_frequency = canonical_plans.default_care_frequency,
    features_json = canonical_plans.features_json
FROM canonical_plans
WHERE service_plans.name = canonical_plans.name;

-- Seed only when a plan has no template, preserving any customized checklist.
-- These codes map to real automated checks in clientCarePulseService.js.
INSERT INTO checklist_templates (plan_id, name, items_json)
SELECT
    service_plans.id,
    'Weekly Website Health',
    $checks$
    [
      {"code":"UPTIME","label":"Website availability"},
      {"code":"SSL","label":"SSL certificate"},
      {"code":"DNS","label":"DNS health"},
      {"code":"REDIRECT","label":"HTTPS redirect"},
      {"code":"PERF_LIGHT","label":"Website performance"},
      {"code":"GA_TRAFFIC","label":"Google Analytics Traffic Analysis"}
    ]
    $checks$::JSONB
FROM service_plans
WHERE service_plans.name IN (
    'Hosting Only',
    'Hosting + Domain Management',
    'Web Maintenance',
    'Content Refresh'
)
AND NOT EXISTS (
    SELECT 1
    FROM checklist_templates
    WHERE checklist_templates.plan_id = service_plans.id
);

-- Ensure the application always has a company for invoice/outbox ownership.
INSERT INTO companies (name, prefix)
SELECT 'iCreate Solutions', 'ICSS'
WHERE NOT EXISTS (SELECT 1 FROM companies);

-- ============================================================================
-- 5. INDEXES AND PRIVATE BACKEND-ONLY TABLE ACCESS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_billing_email ON clients(billing_email);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_service ON invoices(client_service_id);
CREATE INDEX IF NOT EXISTS idx_invoices_renewal ON invoices(renewal_date);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
-- An older install created this name as a non-unique index. Recreate it so
-- concurrent PayPal deliveries cannot record the same transaction twice.
DROP INDEX IF EXISTS idx_payments_reference_id;
CREATE UNIQUE INDEX idx_payments_reference_id
    ON payments(reference_id)
    WHERE reference_id IS NOT NULL;

-- The application calls this service-role-only readiness check before asking
-- PayPal to redeliver failed events. Recovery stays disabled until the unique
-- transaction claim is genuinely installed and valid.
CREATE OR REPLACE FUNCTION public.has_safe_paypal_processing_schema()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_index AS index_meta
          JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_meta.indexrelid
          JOIN pg_catalog.pg_class AS table_class ON table_class.oid = index_meta.indrelid
          JOIN pg_catalog.pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
         WHERE table_namespace.nspname = 'public'
           AND table_class.relname = 'payments'
           AND index_class.relname = 'idx_payments_reference_id'
           AND index_meta.indisunique
           AND index_meta.indisvalid
    ) AND (
        SELECT COUNT(*) = 4
          FROM pg_catalog.pg_attribute AS attribute_meta
          JOIN pg_catalog.pg_class AS payment_table ON payment_table.oid = attribute_meta.attrelid
          JOIN pg_catalog.pg_namespace AS payment_namespace ON payment_namespace.oid = payment_table.relnamespace
         WHERE payment_namespace.nspname = 'public'
           AND payment_table.relname = 'payments'
           AND attribute_meta.attname IN (
               'receipt_email_status',
               'receipt_email_claimed_at',
               'receipt_email_sent_at',
               'receipt_email_last_error'
           )
           AND NOT attribute_meta.attisdropped
    ) AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_index AS service_index_meta
          JOIN pg_catalog.pg_class AS service_index ON service_index.oid = service_index_meta.indexrelid
          JOIN pg_catalog.pg_class AS service_table ON service_table.oid = service_index_meta.indrelid
          JOIN pg_catalog.pg_namespace AS service_namespace ON service_namespace.oid = service_table.relnamespace
         WHERE service_namespace.nspname = 'public'
           AND service_table.relname = 'client_services'
           AND service_index.relname = 'idx_client_services_paypal_subscription_id_unique'
           AND service_index_meta.indisunique
           AND service_index_meta.indisvalid
    ) AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_index AS message_index_meta
          JOIN pg_catalog.pg_class AS message_index ON message_index.oid = message_index_meta.indexrelid
          JOIN pg_catalog.pg_class AS message_table ON message_table.oid = message_index_meta.indrelid
          JOIN pg_catalog.pg_namespace AS message_namespace ON message_namespace.oid = message_table.relnamespace
         WHERE message_namespace.nspname = 'public'
           AND message_table.relname = 'client_relationship_messages'
           AND message_index.relname = 'idx_client_relationship_messages_occurrence_unique'
           AND message_index_meta.indisunique
           AND message_index_meta.indisvalid
    ) AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_index AS consumed_index_meta
          JOIN pg_catalog.pg_class AS consumed_index ON consumed_index.oid = consumed_index_meta.indexrelid
          JOIN pg_catalog.pg_class AS consumed_table ON consumed_table.oid = consumed_index_meta.indrelid
          JOIN pg_catalog.pg_namespace AS consumed_namespace ON consumed_namespace.oid = consumed_table.relnamespace
         WHERE consumed_namespace.nspname = 'public'
           AND consumed_table.relname = 'consumed_events'
           AND consumed_index.relname = 'idx_consumed_events_company_idempotency'
           AND consumed_index_meta.indisunique
           AND consumed_index_meta.indisvalid
    );
$$;
REVOKE ALL ON FUNCTION public.has_safe_paypal_processing_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_safe_paypal_processing_schema() TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_paypal_webhook_events_event_id
    ON paypal_webhook_events(paypal_event_id);

CREATE INDEX IF NOT EXISTS idx_client_services_status ON client_services(status);
CREATE INDEX IF NOT EXISTS idx_client_services_next_run ON client_services(next_run_at);
CREATE INDEX IF NOT EXISTS idx_client_services_next_billing ON client_services(next_billing_date);
CREATE INDEX IF NOT EXISTS idx_client_services_meta_gin
    ON client_services USING GIN (service_meta_json);

-- Multiple rows may omit the ID (or contain a blank ID), but a real PayPal
-- subscription ID can belong to only one client service.
DROP INDEX IF EXISTS idx_client_services_paypal_subscription_id_unique;
CREATE UNIQUE INDEX idx_client_services_paypal_subscription_id_unique
    ON client_services (
        (NULLIF(BTRIM(service_meta_json ->> 'paypal_subscription_id'), ''))
    )
    WHERE NULLIF(BTRIM(service_meta_json ->> 'paypal_subscription_id'), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_templates_plan_unique
    ON checklist_templates(plan_id)
    WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checklist_runs_service ON checklist_runs(client_service_id);
CREATE INDEX IF NOT EXISTS idx_checklist_run_items_run ON checklist_run_items(checklist_run_id);
CREATE INDEX IF NOT EXISTS idx_client_care_reports_sent_at ON client_care_reports(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_care_reports_service ON client_care_reports(client_service_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_summaries_client_month_unique
    ON monthly_pulse_summaries(client_id, month);
DROP INDEX IF EXISTS idx_client_relationship_messages_occurrence_unique;
CREATE UNIQUE INDEX idx_client_relationship_messages_occurrence_unique
    ON client_relationship_messages(client_id, message_type, occurrence_key);
CREATE INDEX IF NOT EXISTS idx_client_relationship_messages_status
    ON client_relationship_messages(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox_events(publish_status, occurred_at)
    WHERE publish_status = 'pending';

-- These records contain customer, billing, and operational data. The Express
-- backend uses the service role and remains unaffected; the public anon key
-- must never be able to query the tables directly.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE paypal_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_care_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_pulse_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_relationship_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_hub_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access" ON clients;
DROP POLICY IF EXISTS "Enable all access" ON invoices;
DROP POLICY IF EXISTS "Enable all access for all users" ON monthly_pulse_summaries;
DROP POLICY IF EXISTS "Enable all access for all users" ON client_care_reports;

REVOKE ALL ON TABLE companies, clients, invoices, invoice_items, payments,
    paypal_webhook_events, service_plans, client_services, checklist_templates,
    checklist_runs, checklist_run_items, client_care_reports,
    monthly_pulse_summaries, client_relationship_messages, outbox_events,
    consumed_events, link_hub_settings
FROM anon;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
      'clients',
      'invoices',
      'invoice_items',
      'payments',
      'paypal_webhook_events',
      'service_plans',
      'client_services',
      'checklist_templates',
      'checklist_runs',
      'checklist_run_items',
      'client_care_reports',
      'client_relationship_messages',
      'outbox_events',
      'consumed_events',
      'link_hub_settings'
  )
ORDER BY table_name;

SELECT name, price, default_frequency, default_care_frequency
FROM service_plans
WHERE name IN (
    'Hosting Only',
    'Hosting + Domain Management',
    'Web Maintenance',
    'Content Refresh'
)
ORDER BY price;

SELECT service_plans.name, checklist_templates.name AS checklist_name
FROM service_plans
LEFT JOIN checklist_templates ON checklist_templates.plan_id = service_plans.id
WHERE service_plans.name IN (
    'Hosting Only',
    'Hosting + Domain Management',
    'Web Maintenance',
    'Content Refresh'
)
ORDER BY service_plans.price;
