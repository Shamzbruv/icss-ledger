-- Restore company ownership for legacy invoices from their linked client.
-- Only fills missing values; existing invoice ownership is never overwritten.
BEGIN;

UPDATE public.invoices invoice
SET company_id = client.company_id,
    updated_at = now()
FROM public.clients client
WHERE invoice.client_id = client.id
  AND invoice.company_id IS NULL
  AND client.company_id IS NOT NULL;

COMMIT;
