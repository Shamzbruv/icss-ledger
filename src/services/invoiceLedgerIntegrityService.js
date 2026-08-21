const supabase = require('../db');
const { reversalEntry, postJournalEntry, getAccountingSettings } = require('./accountingCoreService');

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

async function inspectInvoiceLedger(companyId) {
    const [{ data: invoices, error: invoiceError }, { data: journals, error: journalError }, settings] = await Promise.all([
        supabase.from('invoices').select('id, invoice_number, total_amount, currency, issue_date, company_id').eq('company_id', companyId),
        supabase.from('journals')
            .select('id, source_id, source_event_version, journal_date, narration, created_at, status')
            .eq('company_id', companyId)
            .eq('source_type', 'INVOICE')
            .eq('status', 'posted')
            .like('narration', 'Invoice%'),
        getAccountingSettings(companyId)
    ]);
    if (invoiceError) throw invoiceError;
    if (journalError) throw journalError;

    const invoiceMap = new Map((invoices || []).map(invoice => [invoice.id, invoice]));
    const journalIds = (journals || []).map(journal => journal.id);
    let lines = [];
    if (journalIds.length) {
        const { data, error } = await supabase.from('journal_lines')
            .select('journal_id, debit, credit, chart_of_accounts(code)')
            .in('journal_id', journalIds);
        if (error) throw error;
        lines = data || [];
    }

    const debitByJournal = new Map();
    lines.forEach(line => debitByJournal.set(line.journal_id,
        roundMoney((debitByJournal.get(line.journal_id) || 0) + Number(line.debit || 0))));
    const byInvoice = new Map();
    (journals || []).forEach(journal => {
        const list = byInvoice.get(journal.source_id) || [];
        list.push(journal);
        byInvoice.set(journal.source_id, list);
    });

    const fxRate = Number(settings?.fx_rate_usd_to_jmd || 158);
    const issues = [];
    for (const journal of journals || []) {
        if (!invoiceMap.has(journal.source_id)) {
            issues.push({ type: 'orphan', journalId: journal.id, sourceId: journal.source_id, narration: journal.narration });
        }
    }
    for (const [invoiceId, invoiceJournals] of byInvoice.entries()) {
        const invoice = invoiceMap.get(invoiceId);
        if (!invoice) continue;
        invoiceJournals.sort((a, b) => new Date(b.created_at || b.journal_date) - new Date(a.created_at || a.journal_date));
        invoiceJournals.slice(1).forEach(journal => issues.push({
            type: 'duplicate', journalId: journal.id, invoiceId, invoiceNumber: invoice.invoice_number
        }));
        const current = invoiceJournals[0];
        const currency = String(invoice.currency || 'JMD').toUpperCase() === 'USD' ? 'USD' : 'JMD';
        const expectedJMD = roundMoney(Number(invoice.total_amount || 0) * (currency === 'USD' ? fxRate : 1));
        const actualJMD = roundMoney(debitByJournal.get(current.id) || 0);
        if (Math.abs(expectedJMD - actualJMD) > 0.01) {
            issues.push({
                type: 'amount_mismatch', journalId: current.id, invoiceId,
                invoiceNumber: invoice.invoice_number, currency, expectedJMD, actualJMD
            });
        }
    }

    return {
        companyId,
        fxRate,
        invoiceCount: (invoices || []).length,
        activeInvoiceJournalCount: (journals || []).length,
        issueCount: issues.length,
        issues
    };
}

async function repairInvoiceLedger(companyId) {
    const audit = await inspectInvoiceLedger(companyId);
    const reversed = new Set();
    const replacements = [];

    for (const issue of audit.issues) {
        if (!reversed.has(issue.journalId)) {
            await reversalEntry(issue.journalId, `Invoice ledger integrity repair: ${issue.type}`, companyId);
            reversed.add(issue.journalId);
        }
        if (issue.type !== 'amount_mismatch') continue;

        const { data: invoice, error } = await supabase.from('invoices')
            .select('id, invoice_number, issue_date, total_amount, currency, clients(name)')
            .eq('id', issue.invoiceId).single();
        if (error || !invoice) continue;
        const amountJMD = issue.expectedJMD;
        const rate = issue.currency === 'USD' ? audit.fxRate : 1;
        const replacement = await postJournalEntry({
            companyId,
            entryDate: invoice.issue_date || new Date().toISOString().split('T')[0],
            description: `Invoice ${invoice.invoice_number} — ${invoice.clients?.name || 'Client'} [currency corrected]`,
            sourceType: 'INVOICE',
            sourceId: invoice.id,
            sourceEventVersion: Date.now(),
            accountingEventId: `invoice-integrity-${invoice.id}-${Date.now()}`,
            reference: invoice.invoice_number,
            lines: [
                { accountCode: '1100', debitAmount: amountJMD, creditAmount: 0, currency: 'JMD', fxRate: rate, memo: `Invoice ${invoice.invoice_number} (${issue.currency})` },
                { accountCode: '4000', debitAmount: 0, creditAmount: amountJMD, currency: 'JMD', fxRate: rate, memo: `Revenue — Invoice ${invoice.invoice_number} (${issue.currency})` }
            ]
        });
        replacements.push(replacement.id);
    }

    return {
        ...audit,
        repaired: true,
        reversedJournalCount: reversed.size,
        replacementJournalCount: replacements.length,
        replacementJournalIds: replacements
    };
}

module.exports = { inspectInvoiceLedger, repairInvoiceLedger };
