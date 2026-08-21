-- Invoice currency migration. Run once in Supabase before deploying this release.
BEGIN;

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'JMD';
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Historical subscriptions were priced in USD. The two legacy manual invoices below
-- USD 1,000 are also USD (one item is explicitly labelled USD). Project invoices are JMD.
UPDATE public.invoices
SET currency = CASE
    WHEN is_subscription IS TRUE OR total_amount < 1000 THEN 'USD'
    ELSE 'JMD'
END;

UPDATE public.invoices SET currency = upper(currency) WHERE upper(currency) IN ('JMD', 'USD');
UPDATE public.invoices SET currency = 'JMD' WHERE currency IS NULL OR currency NOT IN ('JMD', 'USD');

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_currency_check;
ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_currency_check CHECK (currency IN ('JMD', 'USD'));

CREATE INDEX IF NOT EXISTS idx_invoices_company_currency
    ON public.invoices(company_id, currency);

ALTER TABLE IF EXISTS public.accounting_settings
    ALTER COLUMN invoice_currency SET DEFAULT 'JMD';

COMMIT;
