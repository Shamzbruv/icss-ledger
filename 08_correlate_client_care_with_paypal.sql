-- Backfill PayPal subscription identity only from signature-verified,
-- successfully processed PayPal subscription webhook records.
BEGIN;

WITH ranked_subscription_events AS (
    SELECT
        custom_id,
        resource_id AS paypal_subscription_id,
        row_number() OVER (
            PARTITION BY custom_id
            ORDER BY processed_at DESC NULLS LAST
        ) AS event_rank
    FROM public.paypal_webhook_events
    WHERE status = 'processed'
      AND custom_id IS NOT NULL
      AND resource_id ~ '^I-[A-Z0-9]+$'
      AND event_type LIKE 'BILLING.SUBSCRIPTION.%'
), verified_identity AS (
    SELECT custom_id, paypal_subscription_id
    FROM ranked_subscription_events
    WHERE event_rank = 1
)
UPDATE public.client_services service
SET service_meta_json = jsonb_set(
        coalesce(service.service_meta_json, '{}'::jsonb),
        '{paypal_subscription_id}',
        to_jsonb(identity.paypal_subscription_id),
        true
    ),
    updated_at = now()
FROM verified_identity identity
WHERE service.id::text = identity.custom_id
  AND service.status = 'active'
  AND coalesce(service.service_meta_json->>'paypal_subscription_id', '') = '';

-- A manually sent ordinary-invoice balance notice is not evidence that a
-- payment processor declined a charge. Restore those records to their actual
-- balance-derived state.
UPDATE public.invoices
SET payment_status = CASE
        WHEN coalesce(balance_due, remaining_amount, total_amount, 0) <= 0 THEN 'PAID'
        WHEN coalesce(amount_paid, 0) > 0 THEN 'PARTIAL'
        ELSE 'UNPAID'
    END,
    status = CASE
        WHEN coalesce(balance_due, remaining_amount, total_amount, 0) <= 0 THEN 'paid'
        ELSE 'pending'
    END,
    updated_at = now()
WHERE coalesce(is_subscription, false) = false
  AND payment_status = 'FAILED';

COMMIT;
