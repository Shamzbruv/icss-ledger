/**
 * Tax Form Service
 * Generates S04, S04A workpapers and full tax pack for Jamaica sole traders.
 * Produces both PDF workpapers and structured JSON "entry assistants."
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const supabase = require('../db');
const { getProfitAndLoss, getRevenueReconciliation } = require('./reportingService');
const { computeSoleTraderContributions, estimateAnnualIncome, getAllPoliciesAsOf } = require('./taxEngineService');
const { getCapitalAllowanceReport } = require('./assetRegisterService');
const { getAccountingSettings, getJournalEntries } = require('./accountingCoreService');

// ============================================================================
// HELPERS
// ============================================================================

function fmtJMD(amount) {
    return 'JMD ' + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function drawSectionHeader(doc, title, y, color = '#002B49') {
    doc.rect(50, y, doc.page.width - 100, 22).fill(color);
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text(title, 58, y + 6);
    doc.fillColor('#000000');
    return y + 30;
}

function drawRow(doc, label, value, y, isBold = false, bgColor = null) {
    const W = doc.page.width;
    if (bgColor) doc.rect(50, y, W - 100, 20).fill(bgColor);
    doc.fillColor('#333').fontSize(9).font(isBold ? 'Helvetica-Bold' : 'Helvetica')
        .text(label, 58, y + 5);
    doc.text(String(value), W - 185, y + 5, { width: 125, align: 'right' });
    doc.fillColor('#000');
    return y + 20;
}

// ============================================================================
// S04 WORKPAPER BUILDER
// ============================================================================

async function buildS04Workpaper(companyId, taxYear) {
    const settings = await getAccountingSettings(companyId);
    const fxRate = Number(settings?.fx_rate_usd_to_jmd || 158);
    const start = `${taxYear}-01-01`;
    const end = `${taxYear}-12-31`;

    // Fetch P&L for the full year
    const pnl = await getProfitAndLoss(companyId, start, end, 'accrual');

    // Map accounts to deductible/non-deductible
    const deductibleExpenses = [];
    const nonDeductibleExpenses = [];
    let totalDeductible = 0;
    let totalNonDeductible = 0;

    const { data: coa } = await supabase
        .from('chart_of_accounts')
        .select('code, name, default_tax_category')
        .eq('company_id', companyId)
        .eq('account_type', 'expense');

    const coaMap = {};
    (coa || []).forEach(a => { coaMap[a.code] = a; });

    pnl.expenses.operating.forEach(exp => {
        const account = coaMap[exp.accountCode] || {};
        const isNonDeductible = account.default_tax_category === 'non_deductible';
        if (isNonDeductible || exp.accountCode === '5120') {
            nonDeductibleExpenses.push({ ...exp, taxCategory: account.default_tax_category });
            totalNonDeductible += exp.balance;
        } else {
            deductibleExpenses.push({ ...exp, taxCategory: account.default_tax_category });
            totalDeductible += exp.balance;
        }
    });

    // Capital allowances (REPLACES depreciation for tax purposes)
    const capitalAllowances = await getCapitalAllowanceReport(companyId, taxYear);

    // Compute statutory income
    const grossIncome = pnl.revenue.netRevenue;
    const allowableDeductions = totalDeductible + capitalAllowances.totalCapitalAllowances;
    const statutoryIncome = Math.max(0, grossIncome - allowableDeductions);

    // Tax contributions
    const contributions = await computeSoleTraderContributions(
        grossIncome, allowableDeductions, taxYear, settings || { nht_category: 'cat1_5' }
    );

    // Revenue reconciliation
    const reconciliation = await getRevenueReconciliation(companyId, start, end);

    // Policy snapshot
    const policies = await getAllPoliciesAsOf('JM', end);
    const policySnapshot = {};
    Object.entries(policies).forEach(([k, v]) => { policySnapshot[k] = { value: v.policy_value, effectiveDate: v.effective_date }; });

    return {
        metadata: {
            taxYear,
            companyId,
            businessType: settings?.business_type || 'sole_trader',
            generatedAt: new Date().toISOString(),
            policyVersionUsed: policySnapshot,
            nhtCategory: settings?.nht_category || 'cat1_5',
            trn: settings?.trn || 'N/A',
            filingDeadline: `${taxYear + 1}-03-15`
        },
        income: {
            grossRevenue: pnl.revenue.grossRevenue,
            discounts: pnl.revenue.discounts,
            netRevenue: pnl.revenue.netRevenue,
            otherIncome: 0 // TODO: link to '4010' account
        },
        deductions: {
            allowableExpenses: deductibleExpenses,
            totalAllowableExpenses: Math.round(totalDeductible * 100) / 100,
            capitalAllowances: capitalAllowances.totalCapitalAllowances,
            totalDeductions: Math.round(allowableDeductions * 100) / 100,
            nonDeductibleExpenses,
            totalNonDeductible: Math.round(totalNonDeductible * 100) / 100,
            note: 'Book depreciation (account 5120) is excluded — capital allowances under Schedule 2 applied instead.'
        },
        statutoryIncome: Math.round(statutoryIncome * 100) / 100,
        contributions,
        reconciliation,
        capitalAllowanceSchedule: capitalAllowances
    };
}

// ============================================================================
// S04A ESTIMATED DECLARATION BUILDER
// ============================================================================

async function buildS04AWorkpaper(companyId, taxYear) {
    const settings = await getAccountingSettings(companyId);
    const today = new Date();
    const ytdEnd = today.toISOString().split('T')[0];
    const ytdStart = `${taxYear}-01-01`;

    let ytdRevenue = 0;
    let ytdExpenses = 0;

    // If we are computing for a future year, use prior year as basis
    if (taxYear > today.getFullYear()) {
        const priorPnl = await getProfitAndLoss(companyId, `${taxYear - 1}-01-01`, `${taxYear - 1}-12-31`, 'accrual');
        ytdRevenue = priorPnl.summary.grossRevenue;
        ytdExpenses = priorPnl.summary.totalExpenses;
    } else {
        const ytdPnl = await getProfitAndLoss(companyId, ytdStart, ytdEnd, 'accrual');
        ytdRevenue = ytdPnl.summary.grossRevenue;
        ytdExpenses = ytdPnl.summary.totalExpenses;
    }

    const incomeEstimate = estimateAnnualIncome(ytdRevenue, ytdExpenses, today, taxYear);
    const capitalAllowances = await getCapitalAllowanceReport(companyId, taxYear);

    const estimatedAllowableDeductions = incomeEstimate.projectedExpenses + capitalAllowances.totalCapitalAllowances;
    const estimatedGrossIncome = incomeEstimate.projectedRevenue;

    const contributions = await computeSoleTraderContributions(
        estimatedGrossIncome, estimatedAllowableDeductions, taxYear, settings || { nht_category: 'cat1_5' }
    );

    return {
        metadata: {
            taxYear,
            companyId,
            formType: 'S04A',
            generatedAt: new Date().toISOString(),
            estimationBasis: incomeEstimate.asOfDate,
            annualizationFactor: incomeEstimate.annualizationFactor,
            filingDeadline: `${taxYear}-03-15`,
            note: 'S04A is an estimated declaration. File by March 15 of the tax year.'
        },
        estimatedIncome: {
            ytdRevenue,
            ytdExpenses,
            projectedRevenue: incomeEstimate.projectedRevenue,
            projectedExpenses: incomeEstimate.projectedExpenses,
            projectedNetIncome: incomeEstimate.projectedNetIncome,
            estimatedCapitalAllowances: capitalAllowances.totalCapitalAllowances
        },
        contributions,
        quarterlySchedule: contributions.quarterlySchedule,
        portalEntryAssistant: {
            // Structured JSON mirroring S04A portal fields
            estimatedGrossIncome: estimatedGrossIncome,
            estimatedAllowableDeductions: estimatedAllowableDeductions,
            estimatedStatutoryIncome: Math.max(0, estimatedGrossIncome - estimatedAllowableDeductions),
            estimatedIncomeTax: contributions.contributions.incomeTax.amount,
            estimatedNHT: contributions.contributions.nhtContribution.amount,
            estimatedNIS: contributions.contributions.nisContribution.amount,
            estimatedEducationTax: contributions.contributions.educationTax.amount,
            estimatedTotalContributions: contributions.contributions.totalContributions,
            q1PaymentAmount: contributions.quarterlySchedule[0].amount,
            q1DueDate: contributions.quarterlySchedule[0].dueDate,
            q2PaymentAmount: contributions.quarterlySchedule[1].amount,
            q2DueDate: contributions.quarterlySchedule[1].dueDate,
            q3PaymentAmount: contributions.quarterlySchedule[2].amount,
            q3DueDate: contributions.quarterlySchedule[2].dueDate,
            q4PaymentAmount: contributions.quarterlySchedule[3].amount,
            q4DueDate: contributions.quarterlySchedule[3].dueDate
        }
    };
}

// ============================================================================
// TAX PACK PDF
// ============================================================================

async function generateTaxPackPDF(companyId, taxYear, s04Data, s04aData) {
    const { data: company } = await supabase.from('companies').select('name').limit(1).single();
    const companyName = company?.name || 'iCreate Solutions & Services';

    const doc = new PDFDocument({ margin: 0, size: 'LETTER', bufferPages: true });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    return new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        const W = doc.page.width;

        // ===== PAGE 1: COVER SHEET =====
        doc.rect(0, 0, W, doc.page.height).fill('#F8FAFC');
        doc.rect(0, 0, W, 200).fill('#002B49');

        const logoPath = path.join(__dirname, '../../public/assets/icss-logo.png');
        if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 30, { height: 70 });

        doc.fillColor('#FFFFFF').fontSize(28).font('Helvetica-Bold')
            .text('TAX PACK', 50, 110, { width: W - 100, align: 'center' });
        doc.fontSize(16).font('Helvetica')
            .text(`Year of Assessment ${taxYear}`, 50, 145, { width: W - 100, align: 'center' });

        let cy = 220;
        const infoRows = [
            ['Business Name', companyName],
            ['TRN', s04Data.metadata.trn],
            ['Business Type', s04Data.metadata.businessType === 'sole_trader' ? 'Sole Trader / Self-Employed' : 'Company'],
            ['Tax Year', `January 1, ${taxYear} – December 31, ${taxYear}`],
            ['S04 Filing Deadline', `March 15, ${taxYear + 1}`],
            ['S04A Estimated Filing', `March 15, ${taxYear}`],
            ['Generated', new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })],
            ['Policy Version', `Tax rules as at ${taxYear}-12-31`]
        ];

        infoRows.forEach(([label, value]) => {
            cy = drawRow(doc, label, value, cy, false, cy % 40 === 0 ? '#F1F5F9' : null);
        });

        cy += 20;
        doc.rect(50, cy, W - 100, 40).fill('#FEF3C7');
        doc.fillColor('#92400E').fontSize(8).font('Helvetica')
            .text('⚠️ This tax pack is a workpaper for preparation purposes. Review all figures with a qualified tax professional before filing with TAJ. The portal entry assistant JSON provides prefilled field values to reduce transcription errors.', 60, cy + 8, { width: W - 120 });

        // ===== PAGE 2: S04 — INCOME SUMMARY =====
        doc.addPage();
        doc.rect(0, 0, W, 50).fill('#002B49');
        doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
            .text(`S04 WORKPAPER — YEAR OF ASSESSMENT ${taxYear}`, 50, 15);
        doc.fontSize(9).font('Helvetica').text(`Consolidated Return | ${companyName}`, 50, 36);

        let sy = 65;
        sy = drawSectionHeader(doc, 'SECTION A — GROSS INCOME', sy);
        sy = drawRow(doc, 'Service Revenue (Invoices issued)', fmtJMD(s04Data.income.netRevenue), sy, false, '#F8FAFC');
        sy = drawRow(doc, 'Other Income', fmtJMD(s04Data.income.otherIncome), sy);
        sy = drawRow(doc, 'TOTAL GROSS INCOME', fmtJMD(s04Data.income.netRevenue + s04Data.income.otherIncome), sy, true, '#E2E8F0');

        sy += 10;
        sy = drawSectionHeader(doc, 'SECTION B — ALLOWABLE DEDUCTIONS', sy);
        s04Data.deductions.allowableExpenses.forEach((exp, i) => {
            sy = drawRow(doc, exp.accountName, fmtJMD(exp.balance), sy, false, i % 2 === 0 ? '#F8FAFC' : null);
        });
        sy = drawRow(doc, 'Capital Allowances (Schedule 2)', fmtJMD(s04Data.deductions.capitalAllowances), sy, false, '#F0FDF4');
        sy = drawRow(doc, 'TOTAL ALLOWABLE DEDUCTIONS', fmtJMD(s04Data.deductions.totalDeductions), sy, true, '#E2E8F0');

        sy += 10;
        sy = drawSectionHeader(doc, 'SECTION C — STATUTORY INCOME & CONTRIBUTIONS', sy, '#065F46');
        const contribs = s04Data.contributions.contributions;
        const incomeInfo = s04Data.contributions.income;
        sy = drawRow(doc, 'Statutory Income', fmtJMD(s04Data.statutoryIncome), sy, false, '#F0FDF4');
        sy = drawRow(doc, `Tax-Free Threshold (CY${taxYear} blended)`, fmtJMD(incomeInfo.taxFreeThreshold), sy, false, '#F8FAFC');
        sy = drawRow(doc, 'Chargeable Income', fmtJMD(incomeInfo.chargeableIncome), sy, false, '#F0FDF4');
        sy += 5;
        sy = drawRow(doc, `Income Tax (${contribs.incomeTax.rate < 0.26 ? '25%' : '25%/30%'})`, fmtJMD(contribs.incomeTax.amount), sy, false, '#F8FAFC');
        sy = drawRow(doc, 'Education Tax (2.25%)', fmtJMD(contribs.educationTax.amount), sy);
        sy = drawRow(doc, `NHT (${contribs.nhtContribution.category === 'cat6_7' ? '2% — Cat 6/7' : '3% — Cat 1-5'})`, fmtJMD(contribs.nhtContribution.amount), sy, false, '#F8FAFC');
        sy = drawRow(doc, 'NIS Contribution', fmtJMD(contribs.nisContribution.amount), sy);
        sy = drawRow(doc, 'TOTAL TAX & CONTRIBUTIONS DUE', fmtJMD(contribs.totalContributions), sy, true, '#002B49');
        // Fix last row color for white text
        doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
            .text('TOTAL TAX & CONTRIBUTIONS DUE', 58, sy - 15)
            .text(fmtJMD(contribs.totalContributions), W - 185, sy - 15, { width: 125, align: 'right' });

        // ===== PAGE 3: S04A ESTIMATED =====
        doc.addPage();
        doc.rect(0, 0, W, 50).fill('#1E3A5F');
        doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
            .text(`S04A WORKPAPER — ESTIMATED DECLARATION ${taxYear}`, 50, 15);
        doc.fontSize(9).font('Helvetica').text(`File by March 15, ${taxYear} | ${companyName}`, 50, 36);

        let ay = 65;
        ay = drawSectionHeader(doc, 'ESTIMATED INCOME', ay, '#1E3A5F');
        ay = drawRow(doc, 'Estimated Gross Revenue', fmtJMD(s04aData.estimatedIncome.projectedRevenue), ay, false, '#F8FAFC');
        ay = drawRow(doc, 'Estimated Allowable Deductions', fmtJMD(s04aData.estimatedIncome.projectedExpenses + s04aData.estimatedIncome.estimatedCapitalAllowances), ay);
        ay = drawRow(doc, 'Estimated Statutory Income', fmtJMD(Math.max(0, s04aData.estimatedIncome.projectedRevenue - s04aData.estimatedIncome.projectedExpenses)), ay, true, '#E2E8F0');

        ay += 10;
        ay = drawSectionHeader(doc, 'QUARTERLY PAYMENT SCHEDULE', ay, '#1E3A5F');
        s04aData.quarterlySchedule.forEach(q => {
            ay = drawRow(doc, `${q.quarter} — Due ${q.dueDate} (${q.label})`, fmtJMD(q.amount), ay, false, q.quarter === 'Q1' || q.quarter === 'Q3' ? '#F8FAFC' : null);
        });
        ay = drawRow(doc, 'TOTAL ESTIMATED ANNUAL CONTRIBUTIONS', fmtJMD(s04aData.contributions.contributions.totalContributions), ay, true, '#E2E8F0');

        ay += 15;
        ay = drawSectionHeader(doc, 'PORTAL ENTRY ASSISTANT (S04A FIELDS)', ay, '#4C1D95');
        const pa = s04aData.portalEntryAssistant;
        const portalRows = [
            ['Estimated Gross Income', fmtJMD(pa.estimatedGrossIncome)],
            ['Estimated Allowable Deductions', fmtJMD(pa.estimatedAllowableDeductions)],
            ['Estimated Statutory Income', fmtJMD(pa.estimatedStatutoryIncome)],
            ['Estimated Income Tax', fmtJMD(pa.estimatedIncomeTax)],
            ['Estimated Education Tax', fmtJMD(pa.estimatedEducationTax)],
            ['Estimated NHT', fmtJMD(pa.estimatedNHT)],
            ['Estimated NIS', fmtJMD(pa.estimatedNIS)],
            ['Q1 Payment (due ' + pa.q1DueDate + ')', fmtJMD(pa.q1PaymentAmount)],
            ['Q2 Payment (due ' + pa.q2DueDate + ')', fmtJMD(pa.q2PaymentAmount)],
            ['Q3 Payment (due ' + pa.q3DueDate + ')', fmtJMD(pa.q3PaymentAmount)],
            ['Q4 Payment (due ' + pa.q4DueDate + ')', fmtJMD(pa.q4PaymentAmount)]
        ];
        portalRows.forEach(([l, v], i) => { ay = drawRow(doc, l, v, ay, false, i % 2 === 0 ? '#FAF5FF' : null); });

        // ===== PAGE 4: CAPITAL ALLOWANCES SCHEDULE =====
        doc.addPage();
        doc.rect(0, 0, W, 50).fill('#002B49');
        doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
            .text(`CAPITAL ALLOWANCES SCHEDULE — SCHEDULE 2 ATTACHMENT`, 50, 15);
        doc.fontSize(9).font('Helvetica').text(`Year of Assessment ${taxYear} | ${companyName}`, 50, 35);

        let caly = 65;
        caly = drawSectionHeader(doc, 'FIXED ASSET REGISTER & CAPITAL ALLOWANCES', caly);

        const caAssets = s04Data.capitalAllowanceSchedule.assets;
        if (caAssets.length > 0) {
            const headers = ['Asset', 'Category', 'Purchase Date', 'Cost (JMD)', 'Initial Allow.', 'Annual Allow.', 'Total Allow.', 'Tax WDV Close'];
            const colW = [100, 70, 70, 70, 60, 60, 60, 70];
            // Header
            doc.rect(50, caly, W - 100, 18).fill('#F1F5F9');
            doc.fillColor('#475569').fontSize(6.5).font('Helvetica-Bold');
            let hx = 55;
            headers.forEach((h, i) => { doc.text(h, hx, caly + 5, { width: colW[i] - 4, align: i > 2 ? 'right' : 'left' }); hx += colW[i]; });
            caly += 18;

            caAssets.forEach((a, ri) => {
                const bg = ri % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
                doc.rect(50, caly, W - 100, 16).fill(bg);
                doc.fillColor('#1E293B').fontSize(6.5).font('Helvetica');
                let rx = 55;
                const vals = [
                    a.assetName, a.category, a.purchaseDate,
                    fmtJMD(a.cost), fmtJMD(a.initialAllowance), fmtJMD(a.annualAllowance),
                    fmtJMD(a.totalAllowance), fmtJMD(a.taxWDVClosing)
                ];
                vals.forEach((v, vi) => { doc.text(String(v), rx, caly + 4, { width: colW[vi] - 4, align: vi > 2 ? 'right' : 'left' }); rx += colW[vi]; });
                caly += 16;
            });

            caly += 10;
            doc.rect(50, caly, W - 100, 22).fill('#002B49');
            doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
                .text('TOTAL CAPITAL ALLOWANCES (Deductible against income)', 58, caly + 6)
                .text(fmtJMD(s04Data.capitalAllowanceSchedule.totalCapitalAllowances), W - 185, caly + 6, { width: 125, align: 'right' });
            caly += 30;

            doc.rect(50, caly, W - 100, 30).fill('#FEF3C7');
            doc.fillColor('#92400E').fontSize(7.5).font('Helvetica')
                .text('Important: Book depreciation (Account 5120) is excluded from tax computations as per Jamaica Income Tax Act. Capital allowances above are the allowable deduction for tax purposes under Schedule 2.', 60, caly + 6, { width: W - 120 });
        } else {
            doc.fillColor('#64748B').fontSize(9).text('No fixed assets registered for this tax year.', 58, caly + 5);
        }

        // Footer
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            const fY = doc.page.height - 28;
            doc.rect(0, fY - 5, W, 33).fill('#F1F5F9');
            doc.fillColor('#94A3B8').fontSize(7).font('Helvetica')
                .text(`${companyName} | Tax Pack — YOA ${taxYear} | Page ${i + 1} of ${pageCount} | CONFIDENTIAL — For TAJ Filing Use Only`, 50, fY + 5, { width: W - 100, align: 'center' });
        }

        doc.end();
    });
}

// ============================================================================
// EXPORT AUDIT BUNDLE
// ============================================================================

async function exportAuditBundle(companyId, taxYear) {
    const archiveJS = require('archiver');
    const s04 = await buildS04Workpaper(companyId, taxYear);
    const s04a = await buildS04AWorkpaper(companyId, taxYear);
    const pdfBuffer = await generateTaxPackPDF(companyId, taxYear, s04, s04a);

    const reportRunId = crypto.randomUUID();
    const bundleHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    const bundleTimestamp = new Date().toISOString();

    // Save PDF
    const bundleDir = path.join(__dirname, '../../tax_packs');
    if (!fs.existsSync(bundleDir)) fs.mkdirSync(bundleDir, { recursive: true });

    const pdfPath = path.join(bundleDir, `tax_pack_${taxYear}_${companyId.slice(0, 8)}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Save JSON entry assistant
    const jsonPath = path.join(bundleDir, `s04a_entry_assistant_${taxYear}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
        generatedAt: bundleTimestamp,
        taxYear,
        bundleHash,
        s04: s04,
        s04a: s04a.portalEntryAssistant
    }, null, 2));

    // Archive in tax_pack_reports
    await supabase.from('tax_pack_reports').insert([
        { company_id: companyId, tax_year: taxYear, form_type: 'S04', report_run_id: reportRunId, pdf_path: pdfPath, pdf_hash: bundleHash, policy_version_snapshot: s04.metadata.policyVersionUsed },
        { company_id: companyId, tax_year: taxYear, form_type: 'S04A', report_run_id: reportRunId, json_path: jsonPath, policy_version_snapshot: s04a.metadata }
    ]).select();

    return {
        reportRunId,
        taxYear,
        pdfPath,
        jsonPath,
        bundleHash,
        generatedAt: bundleTimestamp,
        s04Summary: { grossIncome: s04.income.netRevenue, statutoryIncome: s04.statutoryIncome, totalDue: s04.contributions.contributions.totalContributions },
        s04aQuarterlySchedule: s04a.quarterlySchedule
    };
}

module.exports = {
    buildS04Workpaper,
    buildS04AWorkpaper,
    generateTaxPackPDF,
    exportAuditBundle
};
