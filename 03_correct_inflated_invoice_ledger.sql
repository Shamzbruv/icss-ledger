-- Correct invoice journals produced before invoices stored their own currency.
-- The correction is immutable: bad entries are reversed and correct entries replace them.
BEGIN;

CREATE TEMP TABLE _invoice_ledger_repair_targets (
    old_journal_id UUID PRIMARY KEY,
    reversal_journal_id UUID NOT NULL DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    invoice_id UUID,
    correct_amount NUMERIC(18,2)
) ON COMMIT DROP;

-- Ordinary JMD invoices were incorrectly treated as USD and multiplied by 158.
INSERT INTO _invoice_ledger_repair_targets (old_journal_id, action, invoice_id, correct_amount)
SELECT j.id, 'REPLACE_JMD', i.id, round(i.total_amount::numeric, 2)
FROM public.journals j
JOIN public.invoices i ON i.id = j.source_id
WHERE j.status = 'posted'
  AND j.source_type = 'INVOICE'
  AND j.narration LIKE 'Invoice %'
  AND i.currency = 'JMD'
  AND EXISTS (
      SELECT 1
      FROM public.journal_lines jl
      JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
      WHERE jl.journal_id = j.id
        AND coa.code = '4000'
        AND abs((jl.credit - jl.debit) - i.total_amount) > 0.01
  );

-- A deleted duplicate of INV-ICSS-1213 remained in the ledger as INV-ICSS-1212.
INSERT INTO _invoice_ledger_repair_targets (old_journal_id, action)
SELECT j.id, 'REVERSE_ORPHAN'
FROM public.journals j
WHERE j.status = 'posted'
  AND j.source_type = 'INVOICE'
  AND j.narration LIKE 'Invoice INV-ICSS-1212 %'
  AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = j.source_id)
  AND EXISTS (
      SELECT 1 FROM public.journal_lines jl
      WHERE jl.journal_id = j.id
        AND greatest(jl.debit, jl.credit) > 1000000
  )
ON CONFLICT (old_journal_id) DO NOTHING;

-- Void the three automated August subscription invoices created immediately before
-- subscription invoicing was disabled. Paid historical invoices remain untouched.
INSERT INTO _invoice_ledger_repair_targets (old_journal_id, action, invoice_id)
SELECT j.id, 'VOID_SUBSCRIPTION', i.id
FROM public.journals j
JOIN public.invoices i ON i.id = j.source_id
WHERE j.status = 'posted'
  AND j.source_type = 'INVOICE'
  AND i.is_subscription IS TRUE
  AND i.payment_status = 'UNPAID'
  AND i.status = 'pending'
  AND i.created_at >= TIMESTAMPTZ '2026-08-21 17:28:00+00'
  AND i.created_at <  TIMESTAMPTZ '2026-08-21 17:29:00+00'
ON CONFLICT (old_journal_id) DO NOTHING;

-- Add equal-and-opposite entries and link them to their originals.
INSERT INTO public.journals (
    id, company_id, journal_series, journal_date, period_yyyymm, narration,
    currency, fx_rate, source_system, source_type, source_id,
    source_event_version, idempotency_key, status,
    reversal_of_journal_id, content_sha256
)
SELECT t.reversal_journal_id, j.company_id, j.journal_series, j.journal_date,
       j.period_yyyymm, 'REVERSAL: ' || coalesce(j.narration, 'invoice journal') ||
           ' | Reason: invoice currency integrity repair',
       j.currency, j.fx_rate, j.source_system, j.source_type, j.source_id,
       j.source_event_version,
       'invoice-ledger-repair-reversal-' || j.id::text,
       'reversed', j.id,
       repeat(md5('invoice-ledger-repair-reversal-' || j.id::text), 2)
FROM _invoice_ledger_repair_targets t
JOIN public.journals j ON j.id = t.old_journal_id;

INSERT INTO public.journal_lines (
    journal_id, line_no, account_id, description, debit, credit,
    customer_id, vendor_id, invoice_id, project_id, tax_tag, gct_tag
)
SELECT t.reversal_journal_id, jl.line_no, jl.account_id,
       '[REVERSAL] ' || coalesce(jl.description, ''), jl.credit, jl.debit,
       jl.customer_id, jl.vendor_id, jl.invoice_id, jl.project_id, jl.tax_tag, jl.gct_tag
FROM _invoice_ledger_repair_targets t
JOIN public.journal_lines jl ON jl.journal_id = t.old_journal_id;

UPDATE public.journals j
SET status = 'reversed', reversed_by_journal_id = t.reversal_journal_id
FROM _invoice_ledger_repair_targets t
WHERE j.id = t.old_journal_id;

-- Repost only the affected project invoices at their actual JMD amounts.
CREATE TEMP TABLE _invoice_ledger_replacements (
    old_journal_id UUID PRIMARY KEY,
    replacement_journal_id UUID NOT NULL DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL,
    correct_amount NUMERIC(18,2) NOT NULL
) ON COMMIT DROP;

INSERT INTO _invoice_ledger_replacements (old_journal_id, invoice_id, correct_amount)
SELECT old_journal_id, invoice_id, correct_amount
FROM _invoice_ledger_repair_targets
WHERE action = 'REPLACE_JMD';

INSERT INTO public.journals (
    id, company_id, journal_series, journal_date, period_yyyymm, narration,
    currency, fx_rate, source_system, source_type, source_id,
    source_event_version, idempotency_key, status, content_sha256
)
SELECT r.replacement_journal_id, j.company_id, j.journal_series, j.journal_date,
       j.period_yyyymm, j.narration || ' [JMD currency correction]',
       'JMD', 1, j.source_system, j.source_type, j.source_id,
       j.source_event_version + 1,
       'invoice-ledger-repair-replacement-' || j.id::text,
       'posted', repeat(md5('invoice-ledger-repair-replacement-' || j.id::text), 2)
FROM _invoice_ledger_replacements r
JOIN public.journals j ON j.id = r.old_journal_id;

INSERT INTO public.journal_lines (
    journal_id, line_no, account_id, description, debit, credit,
    customer_id, invoice_id
)
SELECT r.replacement_journal_id,
       CASE coa.code WHEN '1100' THEN 1 ELSE 2 END,
       coa.id,
       CASE coa.code WHEN '1100' THEN 'Accounts receivable - corrected JMD invoice'
                     ELSE 'Service revenue - corrected JMD invoice' END,
       CASE coa.code WHEN '1100' THEN r.correct_amount ELSE 0 END,
       CASE coa.code WHEN '4000' THEN r.correct_amount ELSE 0 END,
       i.client_id, i.id
FROM _invoice_ledger_replacements r
JOIN public.invoices i ON i.id = r.invoice_id
JOIN public.journals j ON j.id = r.old_journal_id
JOIN public.chart_of_accounts coa
  ON coa.company_id = j.company_id AND coa.code IN ('1100', '4000');

UPDATE public.invoices i
SET status = 'void', payment_status = 'VOID', balance_due = 0, remaining_amount = 0,
    updated_at = now()
WHERE i.id IN (
    SELECT invoice_id FROM _invoice_ledger_repair_targets
    WHERE action = 'VOID_SUBSCRIPTION'
);

COMMIT;
