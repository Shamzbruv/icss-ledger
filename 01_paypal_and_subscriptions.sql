BEGIN;
SET LOCAL search_path = public;

-- 1. Create the paypal_webhook_events idempotency table
CREATE TABLE IF NOT EXISTS paypal_webhook_events (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    paypal_event_id TEXT NOT NULL UNIQUE,
    event_type      TEXT NOT NULL,
    resource_id     TEXT,
    custom_id       TEXT,
    payload_jsonb   JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'received',
    processed_at    TIMESTAMPTZ,
    last_error      TEXT,
    recovery_attempt_count INTEGER NOT NULL DEFAULT 0,
    recovery_last_requested_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS recovery_attempt_count INTEGER DEFAULT 0;
ALTER TABLE paypal_webhook_events ADD COLUMN IF NOT EXISTS recovery_last_requested_at TIMESTAMPTZ;
UPDATE paypal_webhook_events SET recovery_attempt_count = 0 WHERE recovery_attempt_count IS NULL;
ALTER TABLE paypal_webhook_events ALTER COLUMN recovery_attempt_count SET DEFAULT 0;
ALTER TABLE paypal_webhook_events ALTER COLUMN recovery_attempt_count SET NOT NULL;

-- 2. Create the payments table if it doesn't exist
CREATE TABLE IF NOT EXISTS payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    method TEXT,
    reference_id TEXT,
    payment_date TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    receipt_email_status TEXT,
    receipt_email_claimed_at TIMESTAMPTZ,
    receipt_email_sent_at TIMESTAMPTZ,
    receipt_email_last_error TEXT
);

-- Existing installs may predate the webhook claim timestamp. The server uses
-- created_at to distinguish an active claim from a stale delivery retry.
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_email_status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_email_claimed_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_email_sent_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_email_last_error TEXT;

-- 2.1 Create the unique index to prevent duplicate payments
DROP INDEX IF EXISTS idx_payments_reference_id;
CREATE UNIQUE INDEX idx_payments_reference_id
ON payments(reference_id)
WHERE reference_id IS NOT NULL;

-- Durable email and subscription claims required by current webhook handling.
CREATE TABLE IF NOT EXISTS client_relationship_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL,
    message_type TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    sent_at TIMESTAMPTZ,
    last_error TEXT
);
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS client_service_id UUID;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS message_type TEXT;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS occurrence_key TEXT;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'processing';
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE client_relationship_messages ADD COLUMN IF NOT EXISTS last_error TEXT;

DROP INDEX IF EXISTS idx_client_services_paypal_subscription_id_unique;
CREATE UNIQUE INDEX idx_client_services_paypal_subscription_id_unique
ON client_services ((NULLIF(BTRIM(service_meta_json ->> 'paypal_subscription_id'), '')))
WHERE NULLIF(BTRIM(service_meta_json ->> 'paypal_subscription_id'), '') IS NOT NULL;

DROP INDEX IF EXISTS idx_client_relationship_messages_occurrence_unique;
CREATE UNIQUE INDEX idx_client_relationship_messages_occurrence_unique
ON client_relationship_messages(client_id, message_type, occurrence_key);
CREATE INDEX IF NOT EXISTS idx_client_relationship_messages_status
ON client_relationship_messages(status, updated_at);
ALTER TABLE client_relationship_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE client_relationship_messages FROM anon;

CREATE TABLE IF NOT EXISTS consumed_events (
    company_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, idempotency_key)
);
DROP INDEX IF EXISTS idx_consumed_events_company_idempotency;
CREATE UNIQUE INDEX idx_consumed_events_company_idempotency
ON consumed_events(company_id, idempotency_key);
ALTER TABLE consumed_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE consumed_events FROM anon;

-- Railway checks this exact database guarantee before asking PayPal to
-- redeliver failed payment events. This prevents recovery from running against
-- an older installation where duplicate transaction claims are still possible.
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

-- 3. Backfill next_renewal_date for existing active subscriptions that are missing it
-- Note: 'monthly' adds 1 month, 'yearly' adds 1 year. Other intervals can be added if needed.
UPDATE client_services 
SET next_renewal_date = 
    CASE 
        WHEN lower(frequency) = 'yearly' THEN COALESCE(start_date, CURRENT_DATE) + interval '1 year'
        ELSE COALESCE(start_date, CURRENT_DATE) + interval '1 month'
    END
WHERE status = 'active' AND next_renewal_date IS NULL;

COMMIT;
