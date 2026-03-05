/**
 * GCT (General Consumption Tax) Service — Jamaica
 * Tracks trailing 12-month turnover, threshold warnings, and builds Form 4A data.
 * Only active when gct_registered = true in accounting_settings.
 */

const supabase = require('../db');
const { getTaxPolicy } = require('./taxEngineService');
const { postJournalEntry } = require('./accountingCoreService');

// ============================================================================
// GCT CONFIGURATION
// ============================================================================

async function getGCTConfig(companyId) {
    const { data, error } = await supabase
        .from('companies')
        .select('gct_registered, gct_registration_number, gct_registration_effective_date')
        .eq('id', companyId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
        company_id: companyId,
        is_registered: data.gct_registered,
        registration_number: data.gct_registration_number,
        effective_date: data.gct_registration_effective_date
    };
}

async function upsertGCTConfig(companyId, config) {
    const updateData = {
        gct_registered: config.is_registered,
        gct_registration_number: config.registration_number,
        gct_registration_effective_date: config.effective_date
    };
    const { data, error } = await supabase
        .from('companies')
        .update(updateData)
        .eq('id', companyId)
        .select('gct_registered, gct_registration_number, gct_registration_effective_date')
        .single();

    if (error) throw new Error(error.message);
    return {
        company_id: companyId,
        is_registered: data.gct_registered,
        registration_number: data.gct_registration_number,
        effective_date: data.gct_registration_effective_date
    };
}

// ============================================================================
// TRAILING 12-MONTH TURNOVER (for threshold monitoring)
// ============================================================================

/**
 * Sum all revenue journal lines for the trailing 12 months.
 * Revenue accounts are those with account_type = 'revenue' (codes starting with '4').
 */
async function getTrailingTwelveMonthTurnover(companyId) {
    const today = new Date();
    const twelveMothsAgo = new Date(today);
    twelveMothsAgo.setFullYear(twelveMothsAgo.getFullYear() - 1);

    const periodStart = twelveMothsAgo.toISOString().split('T')[0];
    const periodEnd = today.toISOString().split('T')[0];

    // Get journal entries in range
    const { data: entries, error: jeErr } = await supabase
        .from('journals')
        .select('id')
        .eq('company_id', companyId)
        .gte('journal_date', periodStart)
        .lte('journal_date', periodEnd);

    if (jeErr) throw new Error(`Turnover fetch failed: ${jeErr.message}`);
    if (!entries || entries.length === 0) return { turnover: 0, periodStart, periodEnd };

    const entryIds = entries.map(e => e.id);

    // Sum credit amounts on revenue accounts (4xxx)
    const { data: lines, error: lineErr } = await supabase
        .from('journal_lines')
        .select('credit, chart_of_accounts!inner(code)')
        .in('journal_id', entryIds)
        .like('chart_of_accounts.code', '4%'); // Revenue accounts

    if (lineErr) throw new Error(`Turnover lines fetch failed: ${lineErr.message}`);

    const turnover = (lines || []).reduce((sum, l) => sum + Number(l.credit || 0), 0);

    return {
        turnover: Math.round(turnover * 100) / 100,
        periodStart,
        periodEnd,
        currency: 'JMD'
    };
}

// ============================================================================
// GCT THRESHOLD CHECK
// ============================================================================

/**
 * Check where the business stands relative to the GCT registration threshold.
 * @returns {{ currentTurnover, threshold, percentageOfThreshold, warningLevel, message }}
 */
async function checkGCTThreshold(companyId) {
    const today = new Date().toISOString().split('T')[0];
    const threshold = await getTaxPolicy('JM', 'GCT_REGISTRATION_THRESHOLD_JMD', today);
    const { turnover, periodStart, periodEnd } = await getTrailingTwelveMonthTurnover(companyId);

    const percentage = threshold > 0 ? (turnover / threshold) * 100 : 0;

    let warningLevel = 'ok';
    let message = null;

    if (turnover > threshold) {
        warningLevel = 'exceeded';
        message = `⚠️ MANDATORY REGISTRATION REQUIRED: Your trailing 12-month taxable turnover (JMD ${turnover.toLocaleString()}) exceeds the GCT registration threshold of JMD ${threshold.toLocaleString()}. You must register for GCT with TAJ immediately.`;
    } else if (percentage >= 80) {
        warningLevel = 'approaching';
        message = `⚡ GCT Threshold Warning: You are at ${percentage.toFixed(1)}% of the JMD ${threshold.toLocaleString()} GCT threshold. Consider preparing for voluntary or mandatory registration.`;
    } else if (percentage >= 60) {
        warningLevel = 'watch';
        message = `ℹ️ GCT Monitor: Trailing turnover is at ${percentage.toFixed(1)}% of the registration threshold.`;
    }

    return {
        currentTurnover: turnover,
        threshold,
        percentageOfThreshold: Math.round(percentage * 100) / 100,
        warningLevel,
        message,
        periodStart,
        periodEnd,
        currency: 'JMD'
    };
}

// ============================================================================
// FORM 4A DATA BUILDER
// ============================================================================

/**
 * Build Form 4A data for a given period (month or quarter).
 * Returns structured data matching TAJ Form 4A boxes.
 * @param {string} companyId
 * @param {string} periodStart - ISO date
 * @param {string} periodEnd - ISO date
 */
async function computeForm4A(companyId, periodStart, periodEnd, gctConfig) {
    const today = new Date().toISOString().split('T')[0];
    const gctRate = await getTaxPolicy('JM', 'GCT_STANDARD_RATE', today);

    // Get all journal entries in period
    const { data: entries, error: jeErr } = await supabase
        .from('journals')
        .select('id')
        .eq('company_id', companyId)
        .gte('journal_date', periodStart)
        .lte('journal_date', periodEnd);

    if (jeErr) throw new Error(`Form 4A entries fetch failed: ${jeErr.message}`);
    const entryIds = (entries || []).map(e => e.id);

    if (entryIds.length === 0) {
        return buildEmptyForm4A(periodStart, periodEnd);
    }

    const { data: lines, error: lineErr } = await supabase
        .from('journal_lines')
        .select('debit, credit, description, chart_of_accounts!inner(code)')
        .in('journal_id', entryIds);

    if (lineErr) throw new Error(`Form 4A lines fetch failed: ${lineErr.message}`);

    // Aggregate by GCT category
    let outputGCT = 0;        // Account 2200: Output GCT Payable (credits)
    let inputGCT = 0;         // Account 1200: Input GCT Receivable (debits)
    let standardRatedSupplies = 0; // Revenue × 1/gctRate (exclusive supplies)
    let zeroRatedSupplies = 0;
    let exemptSupplies = 0;

    (lines || []).forEach(l => {
        const code = l.chart_of_accounts?.code;
        if (code === '2200') {
            outputGCT += Number(l.credit || 0);
        }
        if (code === '1200') {
            inputGCT += Number(l.debit || 0);
        }
        if (code === '4000') {
            standardRatedSupplies += Number(l.credit || 0);
        }
    });

    // Net payable (positive = remit to TAJ, negative = receive credit)
    const netPayable = Math.round((outputGCT - inputGCT) * 100) / 100;

    // Determine filing and payment due dates
    const periodEndDate = new Date(periodEnd);
    const filingYear = periodEndDate.getFullYear();
    const filingMonth = periodEndDate.getMonth() + 2; // Next month
    const filingDueDate = `${filingYear}-${String(filingMonth).padStart(2, '0')}-30`; // Approx end of next month
    const paymentDueDate = filingDueDate; // Per spec: payment deadline may differ if TAJ extends filing

    return {
        period: { start: periodStart, end: periodEnd },
        filingDueDate,
        paymentDueDate,
        gctRate,
        registrationNumber: gctConfig?.registration_number || 'NOT REGISTERED',

        // Output Tax Section (Box 1 area)
        outputTax: {
            standardRatedSupplies: Math.round(standardRatedSupplies * 100) / 100,
            zeroRatedSupplies: Math.round(zeroRatedSupplies * 100) / 100,
            exemptSupplies: Math.round(exemptSupplies * 100) / 100,
            totalOutputGCT: Math.round(outputGCT * 100) / 100
        },

        // Input Tax Section (Box 2 area)
        inputTax: {
            totalInputGCT: Math.round(inputGCT * 100) / 100,
            capitalGoodsCredit: 0,    // Subset of inputGCT for capital goods
            importsGCT: 0              // GCT paid on imports
        },

        // Net Position
        netPayable: netPayable,
        reconciliation: {
            outputMinusInput: netPayable,
            creditCarriedForward: netPayable < 0 ? Math.abs(netPayable) : 0,
            amountDueToTAJ: netPayable > 0 ? netPayable : 0
        }
    };
}

function buildEmptyForm4A(periodStart, periodEnd) {
    return {
        period: { start: periodStart, end: periodEnd },
        outputTax: { standardRatedSupplies: 0, zeroRatedSupplies: 0, exemptSupplies: 0, totalOutputGCT: 0 },
        inputTax: { totalInputGCT: 0, capitalGoodsCredit: 0, importsGCT: 0 },
        netPayable: 0,
        reconciliation: { outputMinusInput: 0, creditCarriedForward: 0, amountDueToTAJ: 0 },
        note: 'No journal entries found for this period.'
    };
}

// ============================================================================
// GENERATE FORM 4A PDF
// ============================================================================

async function generateForm4APDF(form4AData, companyName) {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));

    return new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        // Header
        doc.rect(0, 0, doc.page.width, 70).fill('#002B49');
        doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold')
            .text('GCT FORM 4A — GENERAL CONSUMPTION TAX RETURN', 50, 20);
        doc.fontSize(10).font('Helvetica')
            .text(`${companyName} | Period: ${form4AData.period.start} to ${form4AData.period.end}`, 50, 45);

        let y = 90;

        // Section A: Output Tax
        doc.fillColor('#002B49').fontSize(12).font('Helvetica-Bold').text('SECTION A — OUTPUT TAX', 50, y);
        y += 20;
        const outputRows = [
            ['Standard-Rated Supplies (Value excl. GCT)', `JMD ${form4AData.outputTax.standardRatedSupplies.toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
            ['Zero-Rated Supplies', `JMD ${form4AData.outputTax.zeroRatedSupplies.toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
            ['Exempt Supplies', `JMD ${form4AData.outputTax.exemptSupplies.toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
            ['TOTAL OUTPUT GCT', `JMD ${form4AData.outputTax.totalOutputGCT.toLocaleString('en-US', { minimumFractionDigits: 2 })}`]
        ];

        outputRows.forEach(([label, val], i) => {
            const bg = i % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
            doc.rect(50, y, 510, 20).fill(bg);
            doc.fillColor('#333').fontSize(9).font('Helvetica').text(label, 55, y + 5);
            doc.font('Helvetica-Bold').text(val, 380, y + 5, { width: 175, align: 'right' });
            y += 20;
        });

        y += 15;

        // Section B: Input Tax
        doc.fillColor('#002B49').fontSize(12).font('Helvetica-Bold').text('SECTION B — INPUT TAX CREDITS', 50, y);
        y += 20;

        const inputRows = [
            ['Total Input GCT (Purchases)', `JMD ${form4AData.inputTax.totalInputGCT.toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
            ['Capital Goods Credit', `JMD ${form4AData.inputTax.capitalGoodsCredit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
            ['GCT on Imports', `JMD ${form4AData.inputTax.importsGCT.toLocaleString('en-US', { minimumFractionDigits: 2 })}`]
        ];

        inputRows.forEach(([label, val], i) => {
            const bg = i % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
            doc.rect(50, y, 510, 20).fill(bg);
            doc.fillColor('#333').fontSize(9).font('Helvetica').text(label, 55, y + 5);
            doc.font('Helvetica-Bold').text(val, 380, y + 5, { width: 175, align: 'right' });
            y += 20;
        });

        y += 15;

        // Net Payable
        const netColor = form4AData.netPayable > 0 ? '#DC2626' : '#16A34A';
        doc.rect(50, y, 510, 35).fill(netColor);
        doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica-Bold')
            .text('NET GCT PAYABLE / (CREDIT)', 55, y + 8);
        doc.text(`JMD ${Math.abs(form4AData.netPayable).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${form4AData.netPayable < 0 ? '(CREDIT)' : 'DUE'}`, 380, y + 8, { width: 175, align: 'right' });
        y += 50;

        // Due Dates
        doc.fillColor('#333').fontSize(9).font('Helvetica')
            .text(`Filing Due: ${form4AData.filingDueDate}   |   Payment Due: ${form4AData.paymentDueDate}`, 50, y);
        y += 20;
        doc.text('File via TAJ RAIS eServices portal: https://www.jamaicatax.gov.jm', 50, y);

        doc.end();
    });
}

module.exports = {
    getGCTConfig, upsertGCTConfig,
    getTrailingTwelveMonthTurnover,
    checkGCTThreshold,
    computeForm4A,
    generateForm4APDF
};
