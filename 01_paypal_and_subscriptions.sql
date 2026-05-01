-- 1. Create the paypal_webhook_events idempotency table
CREATE TABLE IF NOT EXISTS paypal_webhook_events (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    paypal_event_id TEXT NOT NULL UNIQUE,
    event_type      TEXT NOT NULL,
    resource_id     TEXT,
    custom_id       TEXT,
    payload_jsonb   JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'received',
    processed_at    TIMESTAMPTZ
);

-- 2. Create the payments table if it doesn't exist
CREATE TABLE IF NOT EXISTS payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    method TEXT,
    reference_id TEXT,
    payment_date TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.1 Create the unique index to prevent duplicate payments
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference_id
ON payments(reference_id)
WHERE reference_id IS NOT NULL;

-- 3. Backfill next_renewal_date for existing active subscriptions that are missing it
-- Note: 'monthly' adds 1 month, 'yearly' adds 1 year. Other intervals can be added if needed.
UPDATE client_services 
SET next_renewal_date = 
    CASE 
        WHEN lower(frequency) = 'yearly' THEN created_at + interval '1 year'
        ELSE created_at + interval '1 month'
    END
WHERE status = 'active' AND next_renewal_date IS NULL;
