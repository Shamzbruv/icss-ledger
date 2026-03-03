/**
 * Reporting Service
 * Generates P&L, Balance Sheet, Cash Flow, A/R Aging, A/P Aging,
 * and reconciliation schedules from the journal ledger.
 */

const supabase = require('../db');
const { getTrialBalance } = require('./accountingCoreService');

// ============================================================================
// HELPERS
// ============================================================================

async function getJournalLinesForPeriod(companyId, periodStart, periodEnd) {
    const { data: entries, error: jeErr } = await supabase
        .from('journals')
        .select('id, journal_date, source_type, status')
        .eq('company_id', companyId)
        .gte('journal_date', periodStart)
        .lte('journal_date', periodEnd)
        .eq('status', 'posted');

    if (jeErr) throw new Error(`Journal entries fetch failed: ${jeErr.message}`);
    if (!entries || entries.length === 0) return [];

    const entryIds = entries.map(e => e.id);
    const entryMap = {};
    entries.forEach(e => { entryMap[e.id] = e; });

    const { data: lines, error: lineErr } = await supabase
        .from('journal_lines')
        .select(`
            journal_id, debit, credit, description, account_id,
            chart_of_accounts!account_id(code, name, account_type, normal_balance)
        `)
        .in('journal_id', entryIds);

    if (lineErr) throw new Error(`Journal lines fetch failed: ${lineErr.message}`);

    return (lines || []).map(l => ({ ...l, entry: entryMap[l.journal_id] }));
}

function aggregateByAccount(lines) {
    const aggregated = {};
    lines.forEach(l => {
        const acc = l.chart_of_accounts;
        const code = acc.code;
        if (!aggregated[code]) {
            aggregated[code] = {
                accountCode: code,
                accountName: acc.name,
                accountType: acc.account_type || 'unknown',
                normalBalance: acc.normal_balance || 'debit',
                debits: 0, credits: 0
            };
        }
        aggregated[code].debits += Number(l.debit || 0);
        aggregated[code].credits += Number(l.credit || 0);
    });

    // Compute net balance per account
    return Object.values(aggregated).map(a => ({
        ...a,
        balance: a.normalBalance === 'debit'
            ? Math.round((a.debits - a.credits) * 100) / 100
            : Math.round((a.credits - a.debits) * 100) / 100,
        debits: Math.round(a.debits * 100) / 100,
        credits: Math.round(a.credits * 100) / 100
    }));
}

// ============================================================================
// PROFIT & LOSS
// ============================================================================

/**
 * @param {string} companyId
 * @param {string} start - ISO date (period start)
 * @param {string} end - ISO date (period end)
 * @param {string} basis - 'accrual' | 'cash' (cash basis requires payment-sourced entries only)
 * @param {string} ytdStart - optional YTD start date
 */
async function getProfitAndLoss(companyId, start, end, basis = 'accrual', ytdStart = null) {
    const lines = await getJournalLinesForPeriod(companyId, start, end);

    // For cash basis, only include lines from entries where source_type is 'PAYMENT' or 'EXPENSE'
    const filteredLines = basis === 'cash'
        ? lines.filter(l => ['PAYMENT', 'EXPENSE'].includes(l.entry?.source_type))
        : lines;

    const accounts = aggregateByAccount(filteredLines);

    const revenue = accounts.filter(a => a.accountType === 'revenue');
    const expenses = accounts.filter(a => a.accountType === 'expense');

    // Contra-revenue (discounts given) treated as reduction to gross revenue (indicated by a debit balance in a revenue account)
    const grossRevenue = revenue
        .filter(a => a.normalBalance === 'credit')
        .reduce((sum, a) => sum + a.balance, 0);

    const discounts = revenue
        .filter(a => a.normalBalance === 'debit')
        .reduce((sum, a) => sum + a.balance, 0);

    const netRevenue = grossRevenue - discounts;

    // Tax expenses usually start with 53 in this CoA
    const totalExpenses = expenses
        .filter(a => !a.accountCode.startsWith('53'))
        .reduce((sum, a) => sum + a.balance, 0);

    const taxExpenses = expenses
        .filter(a => a.accountCode.startsWith('53'))
        .reduce((sum, a) => sum + a.balance, 0);

    const operatingProfit = netRevenue - totalExpenses;
    const netProfit = operatingProfit - taxExpenses;

    // YTD data (if requested)
    let ytd = null;
    if (ytdStart && ytdStart !== start) {
        ytd = await getProfitAndLoss(companyId, ytdStart, end, basis);
    }

    return {
        period: { start, end },
        basis,
        revenue: {
            accounts: revenue.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
            grossRevenue: Math.round(grossRevenue * 100) / 100,
            discounts: Math.round(discounts * 100) / 100,
            netRevenue: Math.round(netRevenue * 100) / 100
        },
        expenses: {
            operating: expenses.filter(a => !a.accountCode.startsWith('53')).sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
            tax: expenses.filter(a => a.accountCode.startsWith('53')),
            totalExpenses: Math.round(totalExpenses * 100) / 100,
            taxExpenses: Math.round(taxExpenses * 100) / 100
        },
        summary: {
            grossRevenue: Math.round(grossRevenue * 100) / 100,
            netRevenue: Math.round(netRevenue * 100) / 100,
            totalExpenses: Math.round(totalExpenses * 100) / 100,
            operatingProfit: Math.round(operatingProfit * 100) / 100,
            taxExpenses: Math.round(taxExpenses * 100) / 100,
            netProfit: Math.round(netProfit * 100) / 100
        },
        ytd: ytd ? ytd.summary : null
    };
}

// ============================================================================
// BALANCE SHEET
// ============================================================================

async function getBalanceSheet(companyId, asOf) {
    // Balance sheet requires cumulative data from inception
    const lines = await getJournalLinesForPeriod(companyId, '2000-01-01', asOf);
    const accounts = aggregateByAccount(lines);

    const assets = accounts.filter(a => a.accountType === 'asset');
    const liabilities = accounts.filter(a => a.accountType === 'liability');
    const equity = accounts.filter(a => a.accountType === 'equity');

    // Compute retained earnings from all P&L accounts to date
    const pnlAccounts = accounts.filter(a => ['revenue', 'expense'].includes(a.accountType));
    const retainedEarnings = pnlAccounts.reduce((sum, a) => {
        return sum + (a.accountType === 'revenue' ? a.balance : -a.balance);
    }, 0);

    const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
    const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0) + retainedEarnings;

    return {
        asOf,
        assets: {
            accounts: assets.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
            total: Math.round(totalAssets * 100) / 100
        },
        liabilities: {
            accounts: liabilities.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
            total: Math.round(totalLiabilities * 100) / 100
        },
        equity: {
            accounts: equity.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
            retainedEarnings: Math.round(retainedEarnings * 100) / 100,
            total: Math.round(totalEquity * 100) / 100
        },
        check: {
            assetsMinusLiabilitiesMinusEquity: Math.round((totalAssets - totalLiabilities - totalEquity) * 100) / 100,
            balanced: Math.abs(totalAssets - totalLiabilities - totalEquity) < 1
        }
    };
}

// ============================================================================
// CASH FLOW SUMMARY
// ============================================================================

async function getCashFlowSummary(companyId, start, end) {
    const lines = await getJournalLinesForPeriod(companyId, start, end);

    let operatingCashIn = 0;     // Payments received (Cr bank by payments)
    let operatingCashOut = 0;    // Cash expenses (Dr expense / Cr bank)
    let investingCashOut = 0;    // Asset purchases (Dr asset / Cr bank)
    let financingCashIn = 0;     // Capital injections (Dr bank / Cr owner capital)
    let financingCashOut = 0;    // Owner drawings (Dr drawings / Cr bank)

    lines.forEach(l => {
        const code = l.chart_of_accounts?.code;
        if (!code) return;
        if (code === '1010' || code === '1000') { // Bank/Cash accounts
            // Net movement in bank
            operatingCashIn += Number(l.debit || 0);
            operatingCashOut += Number(l.credit || 0);
        }
        if (code === '1500') { // Fixed assets purchased via bank
            investingCashOut += Number(l.debit || 0);
        }
        if (code === '3000' || code === '3010') { // Owner capital / drawings
            if (Number(l.credit) > 0) financingCashIn += Number(l.credit);
            if (Number(l.debit) > 0) financingCashOut += Number(l.debit);
        }
    });

    const netCash = operatingCashIn - operatingCashOut - investingCashOut + financingCashIn - financingCashOut;

    return {
        period: { start, end },
        operating: {
            cashIn: Math.round(operatingCashIn * 100) / 100,
            cashOut: Math.round(operatingCashOut * 100) / 100,
            net: Math.round((operatingCashIn - operatingCashOut) * 100) / 100
        },
        investing: {
            assetPurchases: Math.round(investingCashOut * 100) / 100,
            net: Math.round(-investingCashOut * 100) / 100
        },
        financing: {
            capitalInjections: Math.round(financingCashIn * 100) / 100,
            ownerDrawings: Math.round(financingCashOut * 100) / 100,
            net: Math.round((financingCashIn - financingCashOut) * 100) / 100
        },
        netCashMovement: Math.round(netCash * 100) / 100
    };
}

// ============================================================================
// A/R AGING REPORT
// ============================================================================

async function getARAgingReport(companyId) {
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('*, clients(name, email)')
        .eq('company_id', companyId)
        .not('payment_status', 'eq', 'PAID')
        .order('issue_date', { ascending: true });

    if (error) throw new Error(error.message);

    const today = new Date();
    const buckets = { current: [], days0_30: [], days31_60: [], days61_90: [], over90: [] };

    (invoices || []).forEach(inv => {
        const dueDate = inv.due_date ? new Date(inv.due_date) : null;
        const balance = Number(inv.balance_due || inv.total_amount || 0);
        if (balance <= 0) return;

        const daysOverdue = dueDate ? Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24)) : 0;

        const record = {
            invoiceNumber: inv.invoice_number,
            clientName: inv.clients?.name || 'N/A',
            clientEmail: inv.clients?.email,
            issueDate: inv.issue_date,
            dueDate: inv.due_date,
            balance,
            daysOverdue: Math.max(0, daysOverdue),
            paymentStatus: inv.payment_status
        };

        if (!dueDate || daysOverdue <= 0) buckets.current.push(record);
        else if (daysOverdue <= 30) buckets.days0_30.push(record);
        else if (daysOverdue <= 60) buckets.days31_60.push(record);
        else if (daysOverdue <= 90) buckets.days61_90.push(record);
        else buckets.over90.push(record);
    });

    const sumBucket = (arr) => arr.reduce((sum, r) => sum + r.balance, 0);

    return {
        asOf: today.toISOString().split('T')[0],
        buckets,
        totals: {
            current: Math.round(sumBucket(buckets.current) * 100) / 100,
            days0_30: Math.round(sumBucket(buckets.days0_30) * 100) / 100,
            days31_60: Math.round(sumBucket(buckets.days31_60) * 100) / 100,
            days61_90: Math.round(sumBucket(buckets.days61_90) * 100) / 100,
            over90: Math.round(sumBucket(buckets.over90) * 100) / 100,
            grandTotal: Math.round(sumBucket(Object.values(buckets).flat()) * 100) / 100
        }
    };
}

// ============================================================================
// REVENUE RECONCILIATION (Invoices vs Ledger)
// ============================================================================

async function getRevenueReconciliation(companyId, start, end) {
    // Revenue per invoices (operational)
    const { data: invoices } = await supabase
        .from('invoices')
        .select('total_amount, invoice_number, issue_date')
        .eq('company_id', companyId)
        .gte('issue_date', start)
        .lte('issue_date', end);

    const invoiceTotal = (invoices || []).reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    // Revenue per ledger (accounting)
    const pnl = await getProfitAndLoss(companyId, start, end);
    const ledgerRevenue = pnl.revenue.grossRevenue;

    const difference = Math.round((invoiceTotal - ledgerRevenue) * 100) / 100;

    return {
        period: { start, end },
        invoiceTotal: Math.round(invoiceTotal * 100) / 100,
        ledgerRevenue: Math.round(ledgerRevenue * 100) / 100,
        difference,
        reconciled: Math.abs(difference) < 1,
        note: difference !== 0
            ? `Difference of ${difference} may indicate unposted accounting events or FX conversion differences.`
            : 'Reconciled.'
    };
}

// ============================================================================
// DASHBOARD WIDGETS (MRR, CHURN, AGING, RUNWAY)
// ============================================================================

async function getDashboardWidgets(companyId) {
    const today = new Date();
    const currentYear = today.getFullYear();
    const ytdStart = `${currentYear}-01-01`;

    // 1. Runway Calculation
    // Cash balance / Average Monthly Burn (last 3 months)
    const { data: cashAccounts } = await supabase
        .from('chart_of_accounts')
        .select('id')
        .eq('company_id', companyId)
        .in('code', ['1000', '1010']); // Bank and Cash

    let cashBalance = 0;
    if (cashAccounts && cashAccounts.length > 0) {
        const cashIds = cashAccounts.map(a => a.id);
        const { data: cashLines, error } = await supabase
            .from('journal_lines')
            .select(`debit, credit, journals!inner(status)`)
            .in('account_id', cashIds)
            .eq('journals.status', 'posted');

        if (error) {
            console.error('Error fetching cash lines:', error);
            throw new Error('Journal entries fetch failed: ' + error.message);
        }

        cashBalance = (cashLines || []).reduce((sum, l) => sum + (Number(l.debit) - Number(l.credit)), 0);
    }

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const pnl90 = await getProfitAndLoss(companyId, ninetyDaysAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    const monthlyBurn = (pnl90.summary.totalExpenses || 0) / 3;
    const runwayMonths = monthlyBurn > 0 ? (cashBalance / monthlyBurn) : 999;

    // 2. MRR (Monthly Recurring Revenue)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const pnl30 = await getProfitAndLoss(companyId, thirtyDaysAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    const mrr = pnl30.summary.netRevenue || 0;

    // 3. A/R Aging Summary
    const arAging = await getARAgingReport(companyId);

    // 4. Net Profit Margin (YTD)
    const pnlYTD = await getProfitAndLoss(companyId, ytdStart, today.toISOString().split('T')[0]);
    const netProfitMargin = pnlYTD.summary.netRevenue > 0
        ? (pnlYTD.summary.netProfit / pnlYTD.summary.netRevenue) * 100
        : 0;

    // Expense breakdown for donut chart
    const expenseBreakdown = pnlYTD.expenses.operating.map(e => ({
        name: e.accountName,
        amount: e.balance
    })).sort((a, b) => b.amount - a.amount).slice(0, 5); // top 5 expenses

    return {
        asOf: today.toISOString().split('T')[0],
        cashBalance: Math.round(cashBalance * 100) / 100,
        monthlyBurn: Math.round(monthlyBurn * 100) / 100,
        runwayMonths: Math.round(runwayMonths * 10) / 10,
        mrr: Math.round(mrr * 100) / 100,
        ytdNetProfitMargin: Math.round(netProfitMargin * 10) / 10,
        arAgingTotals: arAging.totals,
        expenseBreakdown
    };
}

module.exports = {
    getJournalLinesForPeriod,
    getProfitAndLoss,
    getBalanceSheet,
    getCashFlowSummary,
    getARAgingReport,
    getRevenueReconciliation,
    getDashboardWidgets
};
