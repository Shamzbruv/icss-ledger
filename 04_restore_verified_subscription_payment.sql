-- Restore the one historical subscription payment with independent payment evidence.
-- The original invoice journal used the wrong USD conversion and has already been
-- reversed. Record the proven payment directly as bank-to-service revenue so it
-- does not recreate a subscription receivable or a customer-facing invoice balance.
BEGIN;

CREATE TEMP TABLE _verified_subscription_payment (
    journal_id UUID NOT NULL DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL,
    payment_id UUID NOT NULL,
    company_id UUID NOT NULL,
    client_id UUID,
    payment_date DATE NOT NULL,
    amount_jmd NUMERIC(18,2) NOT NULL,
    reference_id TEXT NOT NULL,
    bank_account_id UUID NOT NULL,
    revenue_account_id UUID NOT NULL
) ON COMMIT DROP;

INSERT INTO _verified_subscription_payment (
    invoice_id, payment_id, company_id, client_id, payment_date,
    amount_jmd, reference_id, bank_account_id, revenue_account_id
)
SELECT i.id, p.id, i.company_id, i.client_id, p.payment_date::date,
       round(p.amount * 158, 2), p.reference_id, bank.id, revenue.id
FROM public.invoices i
JOIN public.payments p ON p.invoice_id = i.id
JOIN public.chart_of_accounts bank
  ON bank.company_id = i.company_id AND bank.code = '1010'
JOIN public.chart_of_accounts revenue
  ON revenue.company_id = i.company_id AND revenue.code = '4000'
WHERE i.invoice_number = 'INV-ICSS-865'
  AND i.is_subscription IS TRUE
  AND upper(i.currency) = 'USD'
  AND i.payment_status = 'PAID'
  AND p.method = 'PayPal'
  AND p.reference_id = '66772221EJ100624K'
  AND p.amount = 78.19
  AND NOT EXISTS (
      SELECT 1 FROM public.journals j
      WHERE j.idempotency_key = 'verified-subscription-payment-66772221EJ100624K'
  );

DO $$
DECLARE
    target_count INTEGER;
BEGIN
    SELECT count(*) INTO target_count FROM _verified_subscription_payment;
    IF target_count NOT IN (0, 1) THEN
        RAISE EXCEPTION 'Expected no more than one verified subscription payment; found %', target_count;
    END IF;
END $$;

INSERT INTO public.journals (
    id, company_id, journal_series, journal_date, period_yyyymm, narration,
    currency, fx_rate, source_system, source_type, source_id,
    source_event_version, idempotency_key, status, content_sha256
)
SELECT journal_id, company_id, 'PAY', payment_date,
       to_char(payment_date, 'YYYYMM')::integer,
       'Verified historical subscription payment — INV-ICSS-865',
       'JMD', 158, 'ICSS', 'PAYMENT', payment_id, 1,
       'verified-subscription-payment-66772221EJ100624K', 'posted',
       repeat(md5('verified-subscription-payment-66772221EJ100624K'), 2)
FROM _verified_subscription_payment;

INSERT INTO public.journal_lines (
    journal_id, line_no, account_id, description, debit, credit,
    customer_id, invoice_id
)
SELECT journal_id, 1, bank_account_id,
       'PayPal receipt for verified historical subscription payment',
       amount_jmd, 0, client_id, invoice_id
FROM _verified_subscription_payment
UNION ALL
SELECT journal_id, 2, revenue_account_id,
       'Service revenue from verified historical subscription payment',
       0, amount_jmd, client_id, invoice_id
FROM _verified_subscription_payment;

COMMIT;
