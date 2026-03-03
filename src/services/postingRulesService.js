/**
 * Posting Rules Service
 * Maps operational events (invoice, payment, expense, asset) to balanced journal entries.
 * Uses accounting_events table for idempotency — safe to call multiple times.
 */

const supabase = require('../db');
const { postJournalEntry, reversalEntry, getAccountingSettings } = require('./accountingCoreService');

// ============================================================================
// EVENT EMISSION (write to accounting_events table)
// ============================================================================

/**
 * Emit an accounting event. Returns the newly created event or existing one on conflict.
 */
async function emitAccountingEvent({ companyId, sourceId, sourceType, eventType, eventVersion, payload }) {
    const { data, error } = await supabase
        .from('accounting_events')
        .upsert({
            company_id: companyId,
            source_id: sourceId,
            source_type: sourceType,
            event_type: eventType,
            event_version: eventVersion,
            payload,
            processed_at: null
        }, {
            onConflict: 'company_id,source_id,source_type,event_version',
            ignoreDuplicates: false
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to emit accounting event: ${error.message}`);
    return data;
}

/**
 * Get the latest event version for a source.
 */
async function getLatestEventVersion(companyId, sourceId, sourceType) {
    const { data } = await supabase
        .from('accounting_events')
        .select('event_version')
        .eq('company_id', companyId)
        .eq('source_id', sourceId)
        .eq('source_type', sourceType)
        .order('event_version', { ascending: false })
        .limit(1)
        .maybeSingle();

    return data ? data.event_version : 0;
}

// ============================================================================
// IDEMPOTENT PROJECTOR
// Consumes an accounting_event and posts the correct journal entry.
// If the event already has a journal_entry_id, it's already processed — skip.
// If financial meaning changed (new version), reverse old entry and post new one.
// ============================================================================

async function projectAccountingEvent(event) {
    if (!event.idempotency_key) {
        throw new Error('idempotency_key is required for projection');
    }

    // Strict Idempotency Gate
    const { error: consumeErr } = await supabase
        .from('consumed_events')
        .insert({
            company_id: event.company_id,
            idempotency_key: event.idempotency_key,
            event_id: event.id
        });

    if (consumeErr) {
        if (consumeErr.code === '23505') { // Postgres Unique Violation
            console.log(`[IDEMPOTENCY] Event ${event.idempotency_key} already processed. Skipping.`);
            return null;
        }
        throw new Error(`Idempotency check failed: ${consumeErr.message}`);
    }

    let journalEntry = null;

    try {
        const settings = await getAccountingSettings(event.company_id);
        const fxRate = settings ? Number(settings.fx_rate_usd_to_jmd || 158) : 158;
        const gctRegistered = settings ? settings.gct_registered : false;
        const invoiceCurrency = settings ? settings.invoice_currency : 'USD';

        switch (event.event_type) {
            case 'INVOICE_CREATED':
                journalEntry = await postInvoiceCreated(event, fxRate, gctRegistered, invoiceCurrency);
                break;
            case 'INVOICE_UPDATED':
                journalEntry = await postInvoiceUpdated(event, fxRate, gctRegistered, invoiceCurrency);
                break;
            case 'PAYMENT_APPLIED':
                journalEntry = await postPaymentApplied(event, fxRate, invoiceCurrency);
                break;
            case 'PAYMENT_REVERSED':
                journalEntry = await postPaymentReversed(event, fxRate, invoiceCurrency);
                break;
            case 'INVOICE_VOIDED':
                journalEntry = await postInvoiceVoided(event);
                break;
            case 'CREDIT_NOTE_ISSUED':
                journalEntry = await postCreditNote(event, fxRate, invoiceCurrency);
                break;
            case 'EXPENSE_CASH':
                journalEntry = await postExpenseCash(event, gctRegistered);
                break;
            case 'EXPENSE_BILL_CREATED':
                journalEntry = await postExpenseBillCreated(event);
                break;
            case 'EXPENSE_BILL_PAID':
                journalEntry = await postExpenseBillPaid(event);
                break;
            case 'ASSET_PURCHASE':
                journalEntry = await postAssetPurchase(event);
                break;
            case 'DEPRECIATION_POSTED':
                journalEntry = await postDepreciation(event);
                break;
            case 'TAX_ACCRUAL':
                journalEntry = await postTaxAccrual(event);
                break;
            default:
                console.warn(`Unknown event type: ${event.event_type}`);
                return null;
        }

        // Update consumed_events if needed (already inserted, so we're good)
        return journalEntry;

    } catch (err) {
        // We do *not* delete the consumed_event row here if we failed during DB writing,
        // unless we want it to be retryable. Since outbox will retry, we SHOULD delete the consumed_event 
        // to allow the retry to pass the gate.
        await supabase.from('consumed_events').delete().eq('idempotency_key', event.idempotency_key);

        console.error(`❌ Event projection failed [${event.event_type}/${event.source_id}]: ${err.message}`);
        throw err;
    }
}

// ============================================================================
// POSTING RULE IMPLEMENTATIONS
// ============================================================================

async function postInvoiceCreated(event, fxRate, gctRegistered, invoiceCurrency) {
    const { payload, company_id, source_id } = event;
    const amountUSD = Number(payload.total_amount || 0);
    const amountJMD = Math.round(amountUSD * fxRate * 100) / 100;

    const lines = [
        // Dr Accounts Receivable
        { accountCode: '1100', debitAmount: amountJMD, creditAmount: 0, currency: 'JMD', fxRate, memo: `Invoice ${payload.invoice_number}` },
    ];

    if (gctRegistered && payload.gct_amount > 0) {
        const gctJMD = Math.round(Number(payload.gct_amount) * fxRate * 100) / 100;
        const revenueJMD = amountJMD - gctJMD;
        // Cr Revenue (excluding GCT)
        lines.push({ accountCode: '4000', debitAmount: 0, creditAmount: revenueJMD, currency: 'JMD', fxRate, memo: `Revenue — Invoice ${payload.invoice_number}` });
        // Cr Output GCT Payable
        lines.push({ accountCode: '2200', debitAmount: 0, creditAmount: gctJMD, currency: 'JMD', fxRate, memo: `Output GCT — Invoice ${payload.invoice_number}` });
    } else {
        // Cr Revenue (full amount)
        lines.push({ accountCode: '4000', debitAmount: 0, creditAmount: amountJMD, currency: 'JMD', fxRate, memo: `Revenue — Invoice ${payload.invoice_number}` });
    }

    return postJournalEntry({
        companyId: company_id,
        entryDate: payload.issue_date || new Date().toISOString().split('T')[0],
        description: `Invoice ${payload.invoice_number} — ${payload.client_name || 'Client'}`,
        sourceType: 'INVOICE',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        reference: payload.invoice_number,
        lines
    });
}

async function postInvoiceUpdated(event, fxRate, gctRegistered, invoiceCurrency) {
    // Find the prior journal entry for the previous version of this invoice
    const { data: priorJournal } = await supabase
        .from('journals')
        .select('id, source_event_version')
        .eq('company_id', event.company_id)
        .eq('source_id', event.source_id)
        .eq('source_type', 'INVOICE')
        .eq('status', 'posted')
        .order('source_event_version', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (priorJournal && priorJournal.id) {
        // Reverse the prior entry
        await reversalEntry(priorJournal.id, `Invoice updated to version ${event.event_version}`, event.company_id);
    }

    // Post new entry with updated amounts
    return postInvoiceCreated({ ...event, event_type: 'INVOICE_CREATED' }, fxRate, gctRegistered, invoiceCurrency);
}

async function postPaymentApplied(event, fxRate, invoiceCurrency) {
    const { payload, company_id, source_id } = event;
    const amountPaidUSD = Number(payload.amount_paid_this_payment || payload.amount_paid || 0);
    const amountPaidJMD = Math.round(amountPaidUSD * fxRate * 100) / 100;
    const paymentMethod = payload.payment_method || 'Bank Account (Primary)';
    const bankAccount = paymentMethod.toLowerCase().includes('cash') ? '1000' : '1010';

    // Handle deposit (pre-service) vs regular payment
    const isDeposit = payload.payment_status === 'DEPOSIT' && event.event_version === 1;

    if (isDeposit) {
        // Dr Bank; Cr Customer Deposits / Unearned Revenue (liability until service delivered)
        return postJournalEntry({
            companyId: company_id,
            entryDate: payload.paid_at || new Date().toISOString().split('T')[0],
            description: `Deposit received — Invoice ${payload.invoice_number}`,
            sourceType: 'INVOICE',
            sourceId: source_id,
            sourceEventVersion: event.event_version,
            accountingEventId: event.id,
            reference: payload.invoice_number,
            lines: [
                { accountCode: bankAccount, debitAmount: amountPaidJMD, creditAmount: 0, currency: 'JMD', fxRate, memo: `Deposit — Invoice ${payload.invoice_number}` },
                { accountCode: '2010', debitAmount: 0, creditAmount: amountPaidJMD, currency: 'JMD', fxRate, memo: `Customer Deposit Liability — Invoice ${payload.invoice_number}` }
            ]
        });
    }

    // Regular payment: Dr Bank; Cr Accounts Receivable
    return postJournalEntry({
        companyId: company_id,
        entryDate: payload.paid_at || new Date().toISOString().split('T')[0],
        description: `Payment received — Invoice ${payload.invoice_number} (${payload.payment_status})`,
        sourceType: 'INVOICE',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        reference: payload.invoice_number,
        lines: [
            { accountCode: bankAccount, debitAmount: amountPaidJMD, creditAmount: 0, currency: 'JMD', fxRate, memo: `Payment received — Invoice ${payload.invoice_number}` },
            { accountCode: '1100', debitAmount: 0, creditAmount: amountPaidJMD, currency: 'JMD', fxRate, memo: `A/R cleared — Invoice ${payload.invoice_number}` }
        ]
    });
}

async function postPaymentReversed(event, fxRate, invoiceCurrency) {
    // Find the prior PAYMENT_APPLIED journal entry and reverse it
    // In journals, the source_type for payments would be 'PAYMENT' but in our event system we used 'INVOICE' for payment applied earlier.
    // For reversal, we look up the specific idempotency key or the latest payment entry for this invoice.
    const { data: priorJournal } = await supabase
        .from('journals')
        .select('id')
        .eq('company_id', event.company_id)
        .eq('source_id', event.source_id) // Invoice ID
        .eq('source_type', 'INVOICE') // Match the creation
        .like('narration', '%Payment received%') // Distinguish from the invoice creation itself
        .eq('status', 'posted')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (priorJournal && priorJournal.id) {
        return reversalEntry(priorJournal.id, 'Payment reversed', event.company_id);
    }
    return null;
}

async function postInvoiceVoided(event) {
    // Reverse INVOICE_CREATED entry
    const { data: priorJournal } = await supabase
        .from('journals')
        .select('id')
        .eq('company_id', event.company_id)
        .eq('source_id', event.source_id)
        .eq('source_type', 'INVOICE')
        .like('narration', 'Invoice%')
        .eq('status', 'posted')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (priorJournal && priorJournal.id) {
        return reversalEntry(priorJournal.id, 'Invoice voided', event.company_id);
    }
    return null;
}

async function postCreditNote(event, fxRate, invoiceCurrency) {
    const { payload, company_id, source_id } = event;
    const amountUSD = Number(payload.credit_amount || 0);
    const amountJMD = Math.round(amountUSD * fxRate * 100) / 100;

    // Dr Revenue (reduce revenue); Cr Accounts Receivable (reduce what client owes)
    return postJournalEntry({
        companyId: company_id,
        entryDate: new Date().toISOString().split('T')[0],
        description: `Credit Note — Invoice ${payload.invoice_number}`,
        sourceType: 'INVOICE',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        reference: payload.invoice_number,
        lines: [
            { accountCode: '4000', debitAmount: amountJMD, creditAmount: 0, currency: 'JMD', fxRate, memo: `Credit Note — Revenue reduction` },
            { accountCode: '1100', debitAmount: 0, creditAmount: amountJMD, currency: 'JMD', fxRate, memo: `Credit Note — A/R reduction` }
        ]
    });
}

async function postExpenseCash(event, gctRegistered) {
    const { payload, company_id, source_id } = event;
    const totalAmount = Number(payload.total_amount || 0);
    const gctAmount = gctRegistered ? Number(payload.gct_amount || 0) : 0;
    const expenseAmount = totalAmount - gctAmount;
    const bankAccount = payload.currency === 'USD' ? '1010' : '1000';

    const lines = [
        // Dr Expense account
        { accountCode: payload.coa_account_code || '5000', debitAmount: expenseAmount, creditAmount: 0, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: payload.description }
    ];

    if (gctRegistered && gctAmount > 0) {
        // Dr Input GCT Receivable
        lines.push({ accountCode: '1200', debitAmount: gctAmount, creditAmount: 0, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: `Input GCT — ${payload.description}` });
    }

    // Cr Bank/Cash
    lines.push({ accountCode: bankAccount, debitAmount: 0, creditAmount: totalAmount, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: `Cash paid — ${payload.description}` });

    return postJournalEntry({
        companyId: company_id,
        entryDate: payload.expense_date,
        description: `Cash Expense: ${payload.description}`,
        sourceType: 'EXPENSE',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        reference: payload.reference || null,
        lines
    });
}

async function postExpenseBillCreated(event) {
    const { payload, company_id, source_id } = event;
    const totalAmount = Number(payload.total_amount || 0);

    // Dr Expense; Cr Accounts Payable
    return postJournalEntry({
        companyId: company_id,
        entryDate: payload.expense_date,
        description: `Bill Created: ${payload.description} — ${payload.vendor || 'Vendor'}`,
        sourceType: 'EXPENSE',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        lines: [
            { accountCode: payload.coa_account_code || '5000', debitAmount: totalAmount, creditAmount: 0, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: payload.description },
            { accountCode: '2000', debitAmount: 0, creditAmount: totalAmount, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: `A/P — ${payload.vendor}` }
        ]
    });
}

async function postExpenseBillPaid(event) {
    const { payload, company_id, source_id } = event;
    const totalAmount = Number(payload.total_amount || 0);

    // Dr Accounts Payable; Cr Bank
    return postJournalEntry({
        companyId: company_id,
        entryDate: payload.bill_paid_date || new Date().toISOString().split('T')[0],
        description: `Bill Paid: ${payload.description} — ${payload.vendor || 'Vendor'}`,
        sourceType: 'EXPENSE',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        lines: [
            { accountCode: '2000', debitAmount: totalAmount, creditAmount: 0, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: `A/P cleared — ${payload.vendor}` },
            { accountCode: '1010', debitAmount: 0, creditAmount: totalAmount, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: `Paid — ${payload.vendor}` }
        ]
    });
}

async function postAssetPurchase(event) {
    const { payload, company_id, source_id } = event;
    const cost = Number(payload.cost || 0);
    const isBillBased = payload.asset_payment_method === 'bill';
    const creditAccount = isBillBased ? '2000' : '1010'; // A/P or Bank

    return postJournalEntry({
        companyId: company_id,
        entryDate: payload.purchase_date,
        description: `Asset Purchase: ${payload.asset_name}`,
        sourceType: 'ASSET',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        lines: [
            { accountCode: '1500', debitAmount: cost, creditAmount: 0, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: payload.asset_name },
            { accountCode: creditAccount, debitAmount: 0, creditAmount: cost, currency: payload.currency || 'JMD', fxRate: payload.fx_rate || 1, memo: `Asset purchase — ${payload.asset_name}` }
        ]
    });
}

async function postDepreciation(event) {
    const { payload, company_id, source_id } = event;
    const depAmount = Number(payload.depreciation_amount || 0);

    return postJournalEntry({
        companyId: company_id,
        entryDate: payload.period_end_date || `${payload.fiscal_year}-12-31`,
        description: `Book Depreciation: ${payload.asset_name} (FY ${payload.fiscal_year})`,
        sourceType: 'DEPRECIATION',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        lines: [
            { accountCode: '5120', debitAmount: depAmount, creditAmount: 0, currency: 'JMD', fxRate: 1, memo: `Depreciation — ${payload.asset_name} FY${payload.fiscal_year}` },
            { accountCode: '1510', debitAmount: 0, creditAmount: depAmount, currency: 'JMD', fxRate: 1, memo: `Accumulated depreciation — ${payload.asset_name}` }
        ]
    });
}

async function postTaxAccrual(event) {
    const { payload, company_id, source_id } = event;
    // payload.accruals: [{ expenseAccount, payableAccount, amount, label }]
    const lines = [];
    for (const accrual of (payload.accruals || [])) {
        lines.push({ accountCode: accrual.expenseAccount, debitAmount: Number(accrual.amount), creditAmount: 0, currency: 'JMD', fxRate: 1, memo: accrual.label });
        lines.push({ accountCode: accrual.payableAccount, debitAmount: 0, creditAmount: Number(accrual.amount), currency: 'JMD', fxRate: 1, memo: accrual.label });
    }

    if (lines.length === 0) return null;

    return postJournalEntry({
        companyId: company_id,
        entryDate: payload.accrual_date || new Date().toISOString().split('T')[0],
        description: `Tax Accrual — ${payload.period || ''}`,
        sourceType: 'TAX_ACCRUAL',
        sourceId: source_id,
        sourceEventVersion: event.event_version,
        accountingEventId: event.id,
        lines
    });
}

// ============================================================================
// INVOICE INTEGRATION — Main entry point called from server.js
// ============================================================================

/**
 * Called after every invoice create/update in server.js.
 * Determines event type, emits event, and projects it to a journal entry.
 */
async function handleInvoiceEvent(companyId, invoice, eventType) {
    try {
        const currentVersion = await getLatestEventVersion(companyId, invoice.id, 'INVOICE');
        const newVersion = currentVersion + 1;

        const payload = {
            invoice_number: invoice.invoice_number,
            client_name: invoice.client_name || '',
            total_amount: invoice.total_amount,
            amount_paid: invoice.amount_paid,
            amount_paid_this_payment: invoice.amount_paid_this_payment || invoice.amount_paid,
            payment_status: invoice.payment_status,
            deposit_percent: invoice.deposit_percent,
            issue_date: invoice.issue_date || new Date().toISOString().split('T')[0],
            paid_at: invoice.paid_at,
            payment_method: invoice.payment_method || 'bank',
            gct_amount: invoice.gct_amount || 0,
            invoice_currency: 'USD'
        };

        const event = await emitAccountingEvent({
            companyId, sourceId: invoice.id, sourceType: 'INVOICE',
            eventType, eventVersion: newVersion, payload
        });

        // Project immediately (synchronous for reliability)
        await projectAccountingEvent(event);

        return event;
    } catch (err) {
        // Don't fail the invoice operation due to accounting errors — log and continue
        console.error(`⚠️ Accounting event failed for invoice ${invoice.id}: ${err.message}`);
        return null;
    }
}

module.exports = {
    emitAccountingEvent,
    getLatestEventVersion,
    projectAccountingEvent,
    handleInvoiceEvent
};
