-- Reconcile historical subscription payments supported by the invoice's full
-- amount_paid and paid_at values. Existing invoice revenue is cleared from A/R;
-- payments with no invoice journal are recorded directly as service revenue.
BEGIN;

CREATE TEMP TABLE _recorded_subscription_payments (
    journal_id UUID NOT NULL DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL,
    company_id UUID NOT NULL,
    client_id UUID,
    invoice_number TEXT NOT NULL,
    paid_date DATE NOT NULL,
    amount_jmd NUMERIC(18,2) NOT NULL,
    bank_account_id UUID NOT NULL,
    offset_account_id UUID NOT NULL,
    posting_kind TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _recorded_subscription_payments (
    invoice_id, company_id, client_id, invoice_number, paid_date,
    amount_jmd, bank_account_id, offset_account_id, posting_kind
)
SELECT i.id, i.company_id, i.client_id, i.invoice_number, i.paid_at::date,
       round(i.amount_paid * CASE WHEN upper(i.currency) = 'USD' THEN 158 ELSE 1 END, 2),
       bank.id,
       CASE WHEN EXISTS (
           SELECT 1 FROM public.journals invoice_journal
           WHERE invoice_journal.source_id = i.id
             AND invoice_journal.source_type = 'INVOICE'
             AND invoice_journal.status = 'posted'
             AND invoice_journal.narration LIKE 'Invoice%'
       ) THEN receivable.id ELSE revenue.id END,
       CASE WHEN EXISTS (
           SELECT 1 FROM public.journals invoice_journal
           WHERE invoice_journal.source_id = i.id
             AND invoice_journal.source_type = 'INVOICE'
             AND invoice_journal.status = 'posted'
             AND invoice_journal.narration LIKE 'Invoice%'
       ) THEN 'AR_CLEARING' ELSE 'DIRECT_REVENUE' END
FROM public.invoices i
JOIN public.chart_of_accounts bank
  ON bank.company_id = i.company_id AND bank.code = '1010'
JOIN public.chart_of_accounts receivable
  ON receivable.company_id = i.company_id AND receivable.code = '1100'
JOIN public.chart_of_accounts revenue
  ON revenue.company_id = i.company_id AND revenue.code = '4000'
WHERE i.is_subscription IS TRUE
  AND i.payment_status = 'PAID'
  AND i.amount_paid = i.total_amount
  AND i.amount_paid > 0
  AND i.paid_at IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.journals payment_journal
      JOIN public.journal_lines payment_line ON payment_line.journal_id = payment_journal.id
      WHERE payment_line.invoice_id = i.id
        AND payment_journal.source_type = 'PAYMENT'
        AND payment_journal.status = 'posted'
  )
  AND NOT EXISTS (
      SELECT 1 FROM public.journals prior
      WHERE prior.idempotency_key = 'recorded-subscription-payment-' || i.id::text
  );

DO $$
DECLARE
    invalid_count INTEGER;
BEGIN
    SELECT count(*) INTO invalid_count
    FROM _recorded_subscription_payments
    WHERE amount_jmd <= 0 OR posting_kind NOT IN ('AR_CLEARING', 'DIRECT_REVENUE');
    IF invalid_count > 0 THEN
        RAISE EXCEPTION 'Historical subscription reconciliation found % invalid target(s)', invalid_count;
    END IF;
END $$;

INSERT INTO public.journals (
    id, company_id, journal_series, journal_date, period_yyyymm, narration,
    currency, fx_rate, source_system, source_type, source_id,
    source_event_version, idempotency_key, status, content_sha256
)
SELECT journal_id, company_id, 'PAY', paid_date,
       to_char(paid_date, 'YYYYMM')::integer,
       'Recorded historical subscription payment — ' || invoice_number,
       'JMD', 1, 'ICSS', 'PAYMENT', invoice_id, 1,
       'recorded-subscription-payment-' || invoice_id::text, 'posted',
       repeat(md5('recorded-subscription-payment-' || invoice_id::text), 2)
FROM _recorded_subscription_payments;

INSERT INTO public.journal_lines (
    journal_id, line_no, account_id, description, debit, credit,
    customer_id, invoice_id
)
SELECT journal_id, 1, bank_account_id,
       'Recorded historical subscription receipt',
       amount_jmd, 0, client_id, invoice_id
FROM _recorded_subscription_payments
UNION ALL
SELECT journal_id, 2, offset_account_id,
       CASE posting_kind
           WHEN 'AR_CLEARING' THEN 'Clear paid historical subscription receivable'
           ELSE 'Service revenue from recorded historical subscription payment'
       END,
       0, amount_jmd, client_id, invoice_id
FROM _recorded_subscription_payments;

COMMIT;
