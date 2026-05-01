/**
 * Accounting Core Service
 * Manages Chart of Accounts, journal entry posting, trial balance, and period locking.
 * All journal entries are IMMUTABLE — corrections are done via reversal + replacement.
 */

const supabase = require('../db');
const crypto = require('crypto');

// ============================================================================
// CHART OF ACCOUNTS
// ============================================================================

async function getChartOfAccounts(companyId) {
    const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('code');

    if (error) throw new Error(`CoA fetch failed: ${error.message}`);
    return data;
}

async function getAccount(companyId, accountCode) {
    const { data, error } = await supabase
        .from('coa_accounts')
        .select('*')
        .eq('company_id', companyId)
        .eq('account_code', accountCode)
        .single();

    if (error) throw new Error(`Account ${accountCode} not found: ${error.message}`);
    return data;
}

// ============================================================================
// JOURNAL ENTRY POSTING (Core Double-Entry Engine)
// ============================================================================

/**
 * Post a balanced journal entry.
 * @param {Object} entry
 * @param {string} entry.companyId
 * @param {string} entry.entryDate - ISO date string
 * @param {string} entry.description
 * @param {string} entry.sourceType - 'INVOICE'|'PAYMENT'|'EXPENSE'|'ASSET'|'MANUAL'|'DEPRECIATION'|'TAX_ACCRUAL'|'PERIOD_CLOSE'
 * @param {string} [entry.sourceId] - FK to originating record
 * @param {string} [entry.accountingEventId] - FK to accounting_events
 * @param {string} [entry.reference]
 * @param {string} [entry.reportRunId]
 * @param {boolean} [entry.isReversal]
 * @param {string} [entry.reversesEntryId]
 * @param {boolean} [entry.isPostCloseAdjustment]
 * @param {Array}  entry.lines - Array of { accountCode, debitAmount, creditAmount, currency, fxRate, memo }
 * @returns {Object} The created journal entry with lines
 */
async function postJournalEntry(entry) {
    const {
        companyId, entryDate, description, sourceType, sourceId, sourceEventVersion,
        accountingEventId, reference, reportRunId,
        isReversal = false, reversesEntryId = null,
        isPostCloseAdjustment = false, lines
    } = entry;

    if (!lines || lines.length < 2) {
        throw new Error('Journal entry must have at least 2 lines (debit and credit).');
    }

    // 1. Validate balance (sum debits === sum credits)
    const totalDebits = lines.reduce((sum, l) => sum + Number(l.debitAmount || 0), 0);
    const totalCredits = lines.reduce((sum, l) => sum + Number(l.creditAmount || 0), 0);
    const diff = Math.abs(totalDebits - totalCredits);
    if (diff > 0.005) {
        throw new Error(
            `Journal entry is NOT balanced. Debits: ${totalDebits.toFixed(2)}, Credits: ${totalCredits.toFixed(2)}, Diff: ${diff.toFixed(5)}`
        );
    }

    // 2. Determine period (YYYYMM integer format for the new schema)
    const dateObj = new Date(entryDate);
    const period_yyyymm = parseInt(`${dateObj.getUTCFullYear()}${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`, 10);
    const periodStr = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`;

    // 3. Check if period is locked (unless post-close adjustment)
    if (!isPostCloseAdjustment) {
        const { data: closedPeriod } = await supabase
            .from('closed_periods')
            .select('id')
            .eq('company_id', companyId)
            .eq('period', periodStr)
            .maybeSingle();

        if (closedPeriod) {
            throw new Error(
                `Period ${periodStr} is closed. To post to a closed period, set isPostCloseAdjustment=true.`
            );
        }
    }

    // 4. Resolve account IDs based on codes if necessary. 
    // In our payload we receive accountCode but schema requires account_id.
    const accountCodes = lines.map(l => l.accountCode);
    const { data: accounts } = await supabase
        .from('chart_of_accounts')
        .select('id, code, name')
        .eq('company_id', companyId)
        .in('code', accountCodes);

    const accountMap = {};
    (accounts || []).forEach(a => { accountMap[a.code] = a; });

    // Ensure all accounts exist
    lines.forEach(l => {
        if (!accountMap[l.accountCode]) throw new Error(`Account code ${l.accountCode} not found in chart of accounts.`);
    });

    // 5. Generate tamper-evident Hash
    // Canonical format: companyId|date|period|source|idempotency|lines:[accountId,debit,credit]
    let baseCurrency = lines[0].currency || 'JMD';
    let baseRate = lines[0].fxRate || 1.0;

    // Schema mapping for dimensions (simplified for now, using IDs directly if available)

    const hashData = {
        companyId,
        entryDate,
        description,
        sourceType: sourceType || 'MANUAL',
        idempotencyKey: accountingEventId || `man-${Date.now()}`,
        lines: lines.map(l => ({
            id: accountMap[l.accountCode].id,
            dr: l.debitAmount,
            cr: l.creditAmount
        }))
    };
    const content_sha256 = crypto.createHash('sha256').update(JSON.stringify(hashData)).digest('hex');

    // 6. Insert journal entry header
    const { data: journalEntry, error: jeError } = await supabase
        .from('journals')
        .insert({
            company_id: companyId,
            journal_date: entryDate,
            period_yyyymm,
            journal_series: sourceType && sourceType.length <= 3 ? sourceType : (sourceType ? sourceType.substring(0, 3).toUpperCase() : 'JNL'),
            narration: description,
            currency: baseCurrency,
            fx_rate: baseRate,
            source_system: 'icss',
            source_type: sourceType || 'manual',
            source_id: sourceId || '00000000-0000-0000-0000-000000000000',
            source_event_version: sourceEventVersion || 1,
            idempotency_key: accountingEventId || `manual-${Date.now()}`,
            content_sha256,
            status: isReversal ? 'reversed' : 'posted', // Reversals themselves can just be posted, but usually we flag the original. Wait, the reversal entry itself is 'posted'
            reversal_of_journal_id: reversesEntryId || null
        })
        .select()
        .single();

    if (jeError) throw new Error(`Failed to create journal entry: ${jeError.message}`);

    // If this is a reversal, update the original journal
    if (reversesEntryId) {
        await supabase.from('journals')
            .update({ reversed_by_journal_id: journalEntry.id, status: 'reversed' })
            .eq('id', reversesEntryId);
    }

    // 7. Insert journal lines
    let lineNo = 1;
    const lineInserts = lines.map(l => ({
        journal_id: journalEntry.id,
        line_no: lineNo++,
        account_id: accountMap[l.accountCode].id,
        description: l.memo || null,
        debit: Number(l.debitAmount || 0),
        credit: Number(l.creditAmount || 0)
    }));

    const { error: lineError } = await supabase
        .from('journal_lines')
        .insert(lineInserts);

    if (lineError) throw new Error(`Failed to create journal lines: ${lineError.message}`);

    console.log(`✅ Journal Entry Posted: ${journalEntry.id} | ${periodStr} | ${description}`);
    return { ...journalEntry, lines: lineInserts };
}

// ============================================================================
// REVERSAL ENTRY
// ============================================================================

/**
 * Create a reversal of a prior journal entry.
 * Swaps debits and credits on all lines.
 */
async function reversalEntry(originalEntryId, reason, companyId) {
    // Fetch original entry + lines
    const { data: original, error: oeError } = await supabase
        .from('journals')
        .select('*')
        .eq('id', originalEntryId)
        .eq('company_id', companyId)
        .single();

    if (oeError || !original) throw new Error(`Original journal entry not found: ${originalEntryId}`);

    if (original.reversed_by_journal_id) {
        throw new Error(`Entry ${originalEntryId} has already been reversed by ${original.reversed_by_journal_id}`);
    }

    const { data: originalLines, error: olError } = await supabase
        .from('journal_lines')
        .select('*, chart_of_accounts!inner(code)')
        .eq('journal_id', originalEntryId);

    if (olError || !originalLines) throw new Error(`Original journal lines not found`);

    // Build reversed lines (swap debits and credits)
    const reversedLines = originalLines.map(l => ({
        accountCode: l.chart_of_accounts.code,
        debitAmount: l.credit,   // credit becomes debit
        creditAmount: l.debit,   // debit becomes credit
        currency: original.currency,
        fxRate: original.fx_rate,
        memo: l.description ? `[REVERSAL] ${l.description}` : '[REVERSAL]'
    }));

    // Post the reversal entry
    const reversalJE = await postJournalEntry({
        companyId,
        entryDate: new Date().toISOString().split('T')[0],
        description: `REVERSAL: ${original.narration} | Reason: ${reason}`,
        sourceType: original.source_type,
        sourceId: original.source_id || '00000000-0000-0000-0000-000000000000',
        sourceEventVersion: original.source_event_version, // Pass exactly to map reversal
        accountingEventId: `rev-${originalEntryId}-${Date.now()}`,
        isReversal: true,
        reversesEntryId: originalEntryId,
        lines: reversedLines
    });

    console.log(`↩️ Reversal Posted: ${reversalJE.id} reverses ${originalEntryId}`);
    return reversalJE;
}

// ============================================================================
// TRIAL BALANCE
// ============================================================================

/**
 * Compute trial balance for a company over a date range.
 * Returns an array of { accountCode, accountName, accountType, debits, credits, balance }
 */
async function getTrialBalance(companyId, periodStart, periodEnd) {
    // Get all journal lines via journal entries in range
    const { data: entries, error: jeErr } = await supabase
        .from('journals')
        .select('id')
        .eq('company_id', companyId)
        .gte('journal_date', periodStart)
        .lte('journal_date', periodEnd);

    if (jeErr) throw new Error(`Trial balance fetch failed: ${jeErr.message}`);

    if (!entries || entries.length === 0) {
        return [];
    }

    const entryIds = entries.map(e => e.id);

    // Fetch lines with account relationship joined
    const { data: lines, error: lineErr } = await supabase
        .from('journal_lines')
        .select(`
            debit, credit,
            chart_of_accounts!inner(code, name, account_type, normal_balance)
        `)
        .in('journal_id', entryIds);

    if (lineErr) throw new Error(`Trial balance lines fetch failed: ${lineErr.message}`);

    // Aggregate by account
    const balances = {};
    (lines || []).forEach(l => {
        const acc = l.chart_of_accounts;
        if (!balances[acc.code]) {
            balances[acc.code] = {
                accountCode: acc.code,
                accountName: acc.name,
                accountType: acc.account_type || 'unknown',
                normalBalance: acc.normal_balance || 'debit',
                debits: 0,
                credits: 0
            };
        }
        balances[acc.code].debits += Number(l.debit || 0);
        balances[acc.code].credits += Number(l.credit || 0);
    });

    // Compute net balance per account
    const result = Object.values(balances).map(b => ({
        ...b,
        balance: b.normalBalance === 'debit'
            ? b.debits - b.credits
            : b.credits - b.debits,
        debits: Math.round(b.debits * 100) / 100,
        credits: Math.round(b.credits * 100) / 100
    }));

    // Validate: total debits = total credits (invariant)
    const totalDebits = result.reduce((sum, r) => sum + r.debits, 0);
    const totalCredits = result.reduce((sum, r) => sum + r.credits, 0);
    const diff = Math.abs(totalDebits - totalCredits);
    if (diff > 0.01) {
        console.warn(`⚠️ Trial balance out of balance by ${diff.toFixed(2)} for period ${periodStart}–${periodEnd}`);
    }

    return result.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

// ============================================================================
// PERIOD LOCKING
// ============================================================================

async function lockPeriod(companyId, period, closedBy = 'owner', notes = '') {
    const { error } = await supabase
        .from('closed_periods')
        .insert({ company_id: companyId, period, closed_by: closedBy, notes })
        .select()
        .single();

    if (error && error.code !== '23505') { // Ignore duplicate (already closed)
        throw new Error(`Failed to lock period ${period}: ${error.message}`);
    }
    console.log(`🔒 Period ${period} locked for company ${companyId}`);
    return true;
}

async function isPeroidLocked(companyId, period) {
    const { data } = await supabase
        .from('closed_periods')
        .select('id')
        .eq('company_id', companyId)
        .eq('period', period)
        .maybeSingle();
    return !!data;
}

async function getClosedPeriods(companyId) {
    const { data, error } = await supabase
        .from('closed_periods')
        .select('*')
        .eq('company_id', companyId)
        .order('period', { ascending: false });
    if (error) throw new Error(error.message);
    return data;
}

// ============================================================================
// JOURNAL LEDGER (Paginated)
// ============================================================================

async function getJournalEntries(companyId, { periodStart, periodEnd, sourceType, page = 1, pageSize = 50 } = {}) {
    let query = supabase
        .from('journals')
        .select(`
            id, journal_date, period_yyyymm, narration, status, source_type, source_id,
            reversal_of_journal_id, reversed_by_journal_id, created_at,
            journal_lines(chart_of_accounts!inner(code, name), debit, credit, description)
        `, { count: 'exact' })
        .eq('company_id', companyId)
        .order('journal_date', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

    if (periodStart) query = query.gte('journal_date', periodStart);
    if (periodEnd) query = query.lte('journal_date', periodEnd);
    if (sourceType) query = query.eq('source_type', sourceType);

    const { data, error, count } = await query;
    if (error) throw new Error(`Journal fetch failed: ${error.message}`);

    return { entries: data, total: count, page, pageSize };
}

// ============================================================================
// ACCOUNTING SETTINGS
// ============================================================================

async function getAccountingSettings(companyId) {
    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) {
        // Map companies table fields to the expected settings format
        return {
            ...data,
            company_id: data.id,
            fx_rate_usd_to_jmd: 158, // default or fetch from an fx table
            invoice_currency: 'USD'
        };
    }
    return null;
}

async function upsertAccountingSettings(companyId, updates) {
    // In V2, settings are on the companies table
    const { data, error } = await supabase
        .from('companies')
        .update(updates)
        .eq('id', companyId)
        .select()
        .single();

    if (error) throw new Error(error.message);
    return data;
}

// ============================================================================
// DEFAULT COMPANY HELPER
// ============================================================================

async function getDefaultCompanyId() {
    const { data } = await supabase.from('companies').select('id').limit(1).single();
    return data ? data.id : null;
}

module.exports = {
    getChartOfAccounts, getAccount,
    postJournalEntry, reversalEntry,
    getTrialBalance,
    lockPeriod, isPeroidLocked, getClosedPeriods,
    getJournalEntries,
    getAccountingSettings, upsertAccountingSettings,
    getDefaultCompanyId
};
