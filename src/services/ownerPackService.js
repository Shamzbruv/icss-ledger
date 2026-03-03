/**
 * Owner Pack Service
 * Generates the monthly "owner pack" PDF — executive summary, financial statements,
 * and compliance reminders. Emails to owner + accountant and archives the report.
 */

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const path = require('path');
const supabase = require('../db');
const { getProfitAndLoss, getBalanceSheet, getCashFlowSummary, getARAgingReport } = require('./reportingService');
const { computeSoleTraderContributions, estimateAnnualIncome, getComplianceCalendar } = require('./taxEngineService');
const { getAccountingSettings } = require('./accountingCoreService');
const { sendInvoiceEmail } = require('./emailService');

// ============================================================================
// HELPERS
// ============================================================================

function fmtJMD(amount) {
    return 'JMD ' + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getMonthDateRange(month) {
    // month = 'YYYY-MM'
    const [year, mon] = month.split('-').map(Number);
    const start = `${year}-${String(mon).padStart(2, '0')}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const end = `${year}-${String(mon).padStart(2, '0')}-${lastDay}`;
    return { start, end, year, mon };
}

function drawCard(doc, x, y, w, h, title, value, subtext, bgColor = '#002B49', textColor = '#FFFFFF') {
    doc.rect(x, y, w, h).fill(bgColor);
    doc.fillColor(textColor).fontSize(8).font('Helvetica')
        .text(title.toUpperCase(), x + 12, y + 10, { width: w - 20 });
    doc.fontSize(16).font('Helvetica-Bold')
        .text(value, x + 12, y + 22, { width: w - 20 });
    if (subtext) {
        doc.fontSize(7).font('Helvetica').fillColor('#94A3B8')
            .text(subtext, x + 12, y + 43, { width: w - 20 });
    }
    doc.fillColor('#000000');
}

function drawSectionHeader(doc, title, y) {
    doc.rect(50, y, doc.page.width - 100, 22).fill('#002B49');
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold')
        .text(title, 58, y + 6);
    doc.fillColor('#000000');
    return y + 30;
}

function drawTable(doc, headers, rows, y, colWidths) {
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);
    const startX = 50;

    // Header row
    doc.rect(startX, y, tableWidth, 18).fill('#F1F5F9');
    doc.fillColor('#475569').fontSize(8).font('Helvetica-Bold');
    let cx = startX + 5;
    headers.forEach((h, i) => {
        doc.text(h, cx, y + 5, { width: colWidths[i] - 10, align: i > 0 ? 'right' : 'left' });
        cx += colWidths[i];
    });

    // Data rows
    rows.forEach((row, ri) => {
        const rowY = y + 18 + ri * 18;
        if (ri % 2 === 0) doc.rect(startX, rowY, tableWidth, 18).fill('#F8FAFC');
        doc.fillColor('#1E293B').fontSize(8).font('Helvetica');
        cx = startX + 5;
        row.forEach((cell, ci) => {
            doc.text(String(cell), cx, rowY + 5, { width: colWidths[ci] - 10, align: ci > 0 ? 'right' : 'left' });
            cx += colWidths[ci];
        });
    });

    doc.fillColor('#000000');
    return y + 18 + rows.length * 18 + 10;
}

// ============================================================================
// OWNER PACK PDF GENERATOR
// ============================================================================

async function generateOwnerPackPDF(companyId, month) {
    const { start, end, year, mon } = getMonthDateRange(month);
    const ytdStart = `${year}-01-01`;
    const monthLabel = new Date(year, mon - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    // Fetch all data
    const [pnl, balanceSheet, cashFlow, arAging, settings] = await Promise.all([
        getProfitAndLoss(companyId, start, end, 'accrual', ytdStart),
        getBalanceSheet(companyId, end),
        getCashFlowSummary(companyId, start, end),
        getARAgingReport(companyId),
        getAccountingSettings(companyId)
    ]);

    // Tax estimate
    const ytdPnl = await getProfitAndLoss(companyId, ytdStart, end, 'accrual');
    const fxRate = Number(settings?.fx_rate_usd_to_jmd || 158);
    const ytdRevenue = ytdPnl.summary.grossRevenue;
    const ytdExpenses = ytdPnl.summary.totalExpenses;
    const incomeEstimate = estimateAnnualIncome(ytdRevenue, ytdExpenses, new Date(end), year);
    let taxEstimate = null;
    try {
        taxEstimate = await computeSoleTraderContributions(
            incomeEstimate.projectedRevenue,
            incomeEstimate.projectedExpenses,
            year,
            settings || { nht_category: 'cat1_5' }
        );
    } catch (e) {
        console.warn('Tax estimate failed:', e.message);
    }

    const complianceCalendar = getComplianceCalendar(settings?.business_type || 'sole_trader', year);
    const upcomingDeadlines = complianceCalendar.filter(d => ['critical', 'warning', 'upcoming'].includes(d.urgency)).slice(0, 5);

    // Fetch company name
    const { data: company } = await supabase.from('companies').select('name').limit(1).single();
    const companyName = company?.name || 'iCreate Solutions & Services';

    // Build PDF
    const doc = new PDFDocument({ margin: 0, size: 'LETTER', bufferPages: true });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    return new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        const W = doc.page.width;

        // ============ PAGE 1: EXECUTIVE SUMMARY ============
        // Header bar
        doc.rect(0, 0, W, 80).fill('#002B49');

        // Logo (if exists)
        const logoPath = path.join(__dirname, '../../public/assets/icss-logo.png');
        const fs = require('fs');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 20, 15, { height: 50 });
        }

        doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold')
            .text('MONTHLY OWNER PACK', 100, 22);
        doc.fontSize(10).font('Helvetica')
            .text(`${companyName} | ${monthLabel}`, 100, 47);
        doc.fontSize(8).fillColor('#94A3B8')
            .text(`Generated: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} | CONFIDENTIAL`, 100, 62);

        // KPI Cards (2 rows × 3 cards)
        const cardW = 166, cardH = 58, cardY = 100;
        const pnlSummary = pnl.summary;

        drawCard(doc, 50, cardY, cardW, cardH, 'REVENUE (MONTH)', fmtJMD(pnlSummary.netRevenue), `YTD: ${fmtJMD(pnl.ytd?.netRevenue || 0)}`, '#002B49');
        drawCard(doc, 50 + cardW + 10, cardY, cardW, cardH, 'EXPENSES (MONTH)', fmtJMD(pnlSummary.totalExpenses), `YTD: ${fmtJMD(pnl.ytd?.totalExpenses || 0)}`, '#1E3A5F');
        drawCard(doc, 50 + (cardW + 10) * 2, cardY, cardW, cardH, 'NET PROFIT (MONTH)', fmtJMD(pnlSummary.netProfit), `YTD: ${fmtJMD(pnl.ytd?.netProfit || 0)}`, pnlSummary.netProfit >= 0 ? '#065F46' : '#7F1D1D');

        const row2Y = cardY + cardH + 10;
        drawCard(doc, 50, row2Y, cardW, cardH, 'CASH MOVEMENT', fmtJMD(cashFlow.netCashMovement), `In: ${fmtJMD(cashFlow.operating.cashIn)} | Out: ${fmtJMD(cashFlow.operating.cashOut)}`, '#4C1D95');
        drawCard(doc, 50 + cardW + 10, row2Y, cardW, cardH, 'OUTSTANDING A/R', fmtJMD(arAging.totals.grandTotal), `${(arAging.buckets.over90 || []).length} invoices 90+ days`, '#92400E');
        drawCard(doc, 50 + (cardW + 10) * 2, row2Y, cardW, cardH, 'TAX RESERVE', fmtJMD(taxEstimate?.contributions?.totalContributions || 0), 'Projected for full year', '#1E293B');

        // Revenue Trend (ASCII bar chart via PDFKit rectangles)
        let sY = row2Y + cardH + 25;
        sY = drawSectionHeader(doc, 'MONTHLY REVENUE vs EXPENSES', sY);

        const chartH = 60, chartW = W - 100;
        const maxVal = Math.max(pnlSummary.netRevenue, pnlSummary.totalExpenses, 1);
        const revBarW = Math.round((pnlSummary.netRevenue / maxVal) * chartW * 0.9);
        const expBarW = Math.round((pnlSummary.totalExpenses / maxVal) * chartW * 0.9);

        doc.rect(50, sY, revBarW, 20).fill('#10B981');
        doc.fillColor('#FFFFFF').fontSize(7).font('Helvetica-Bold')
            .text(`Revenue: ${fmtJMD(pnlSummary.netRevenue)}`, 55, sY + 6, { width: revBarW - 5 });
        doc.rect(50, sY + 25, expBarW, 20).fill('#EF4444');
        doc.fillColor('#FFFFFF').fontSize(7)
            .text(`Expenses: ${fmtJMD(pnlSummary.totalExpenses)}`, 55, sY + 31, { width: expBarW - 5 });

        sY += 60;

        // Compliance Reminders
        sY = drawSectionHeader(doc, 'UPCOMING COMPLIANCE DEADLINES', sY);
        if (upcomingDeadlines.length > 0) {
            const urgencyColors = { critical: '#DC2626', warning: '#D97706', upcoming: '#2563EB', normal: '#64748B', overdue: '#7C2D12' };
            upcomingDeadlines.forEach(d => {
                const bgColor = d.urgency === 'critical' ? '#FEF2F2' : d.urgency === 'warning' ? '#FFFBEB' : '#EFF6FF';
                doc.rect(50, sY, W - 100, 22).fill(bgColor);
                doc.circle(60, sY + 11, 4).fill(urgencyColors[d.urgency] || '#64748B');
                doc.fillColor('#1E293B').fontSize(8).font('Helvetica-Bold')
                    .text(`${d.event}`, 70, sY + 4, { width: 320 });
                doc.font('Helvetica').fillColor('#64748B')
                    .text(`Due: ${d.dueDate} (${d.daysUntil} days)`, 395, sY + 4, { width: 160, align: 'right' });
                sY += 24;
            });
        } else {
            doc.fillColor('#64748B').fontSize(9).font('Helvetica').text('No urgent deadlines in the next 60 days.', 50, sY + 5);
            sY += 25;
        }

        sY += 10;

        // Tax estimate snippet
        if (taxEstimate) {
            sY = drawSectionHeader(doc, 'YEAR-TO-DATE TAX RESERVE ESTIMATE', sY);
            const taxRows = [
                ['Income Tax', fmtJMD(taxEstimate.contributions.incomeTax.amount)],
                ['Education Tax (2.25%)', fmtJMD(taxEstimate.contributions.educationTax.amount)],
                [`NHT (${taxEstimate.contributions.nhtContribution.category === 'cat6_7' ? '2%' : '3%'})`, fmtJMD(taxEstimate.contributions.nhtContribution.amount)],
                ['NIS', fmtJMD(taxEstimate.contributions.nisContribution.amount)],
                ['TOTAL RESERVE', fmtJMD(taxEstimate.contributions.totalContributions)]
            ];
            taxRows.forEach(([label, val], i) => {
                const isTotal = i === taxRows.length - 1;
                doc.rect(50, sY, W - 100, 18).fill(isTotal ? '#002B49' : i % 2 === 0 ? '#F8FAFC' : '#FFFFFF');
                doc.fillColor(isTotal ? '#FFFFFF' : '#333').fontSize(9).font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
                    .text(label, 58, sY + 4);
                doc.text(val, W - 180, sY + 4, { width: 120, align: 'right' });
                sY += 18;
            });
        }

        // ============ PAGE 2: P&L STATEMENT ============
        doc.addPage();

        doc.rect(0, 0, W, 50).fill('#002B49');
        doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
            .text('PROFIT & LOSS STATEMENT', 50, 15);
        doc.fontSize(9).font('Helvetica')
            .text(`${monthLabel} | Accrual Basis`, 50, 35);

        let py = 65;
        py = drawSectionHeader(doc, 'REVENUE', py);

        const revRows = pnl.revenue.accounts.map(a => [
            a.accountName, fmtJMD(a.balance)
        ]);
        revRows.push(['NET REVENUE', fmtJMD(pnlSummary.netRevenue)]);
        py = drawTable(doc, ['Account', 'Amount (JMD)'], revRows, py, [380, 130]);

        py += 10;
        py = drawSectionHeader(doc, 'OPERATING EXPENSES', py);
        const expRows = pnl.expenses.operating.map(a => [a.accountName, fmtJMD(a.balance)]);
        expRows.push(['TOTAL EXPENSES', fmtJMD(pnlSummary.totalExpenses)]);
        py = drawTable(doc, ['Account', 'Amount (JMD)'], expRows, py, [380, 130]);

        py += 10;
        // Operating Profit highlight
        const profitColor = pnlSummary.operatingProfit >= 0 ? '#065F46' : '#7F1D1D';
        doc.rect(50, py, W - 100, 26).fill(profitColor);
        doc.fillColor('#FFFFFF').fontSize(12).font('Helvetica-Bold')
            .text('NET PROFIT', 58, py + 7)
            .text(fmtJMD(pnlSummary.netProfit), W - 180, py + 7, { width: 120, align: 'right' });
        py += 40;

        // ============ PAGE 3: BALANCE SHEET ============
        doc.addPage();
        doc.rect(0, 0, W, 50).fill('#002B49');
        doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold').text('BALANCE SHEET', 50, 15);
        doc.fontSize(9).font('Helvetica').text(`As at ${end}`, 50, 35);

        let bsy = 65;
        bsy = drawSectionHeader(doc, 'ASSETS', bsy);
        const assetRows = balanceSheet.assets.accounts.map(a => [a.accountName, fmtJMD(a.balance)]);
        assetRows.push(['TOTAL ASSETS', fmtJMD(balanceSheet.assets.total)]);
        bsy = drawTable(doc, ['Account', 'Amount (JMD)'], assetRows, bsy, [380, 130]);

        bsy += 10;
        bsy = drawSectionHeader(doc, 'LIABILITIES', bsy);
        const liabRows = balanceSheet.liabilities.accounts.map(a => [a.accountName, fmtJMD(a.balance)]);
        liabRows.push(['TOTAL LIABILITIES', fmtJMD(balanceSheet.liabilities.total)]);
        bsy = drawTable(doc, ['Account', 'Amount (JMD)'], liabRows, bsy, [380, 130]);

        bsy += 10;
        bsy = drawSectionHeader(doc, 'EQUITY', bsy);
        const eqRows = [
            ...balanceSheet.equity.accounts.map(a => [a.accountName, fmtJMD(a.balance)]),
            ['Retained Earnings', fmtJMD(balanceSheet.equity.retainedEarnings)],
            ['TOTAL EQUITY', fmtJMD(balanceSheet.equity.total)]
        ];
        bsy = drawTable(doc, ['Account', 'Amount (JMD)'], eqRows, bsy, [380, 130]);

        // ============ PAGE 4: A/R AGING ============
        doc.addPage();
        doc.rect(0, 0, W, 50).fill('#002B49');
        doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold').text('ACCOUNTS RECEIVABLE AGING', 50, 15);
        doc.fontSize(9).font('Helvetica').text(`As at ${arAging.asOf}`, 50, 35);

        let ary = 65;
        const totalAR = arAging.totals;

        // Summary aging table
        ary = drawSectionHeader(doc, 'AGING SUMMARY', ary);
        const agingSummaryRows = [
            ['Current (not yet due)', fmtJMD(totalAR.current)],
            ['1–30 days overdue', fmtJMD(totalAR.days0_30)],
            ['31–60 days overdue', fmtJMD(totalAR.days31_60)],
            ['61–90 days overdue', fmtJMD(totalAR.days61_90)],
            ['90+ days overdue', fmtJMD(totalAR.over90)],
            ['GRAND TOTAL', fmtJMD(totalAR.grandTotal)]
        ];
        ary = drawTable(doc, ['Aging Bucket', 'Balance (JMD)'], agingSummaryRows, ary, [380, 130]);

        // Detailed overdue invoices
        if (arAging.buckets.over90.length > 0 || arAging.buckets.days61_90.length > 0) {
            ary += 15;
            ary = drawSectionHeader(doc, 'CRITICAL OVERDUE INVOICES', ary);
            const criticalRows = [
                ...arAging.buckets.over90,
                ...arAging.buckets.days61_90
            ].slice(0, 10).map(inv => [
                inv.invoiceNumber, inv.clientName, `${inv.daysOverdue}d`, fmtJMD(inv.balance)
            ]);
            ary = drawTable(doc, ['Invoice', 'Client', 'Days Overdue', 'Balance'], criticalRows, ary, [120, 190, 90, 110]);
        }

        // Footer on all pages
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            const footerY = doc.page.height - 30;
            doc.rect(0, footerY - 5, W, 35).fill('#F1F5F9');
            doc.fillColor('#94A3B8').fontSize(7).font('Helvetica')
                .text(`${companyName} | Monthly Owner Pack — ${monthLabel} | Page ${i + 1} of ${pageCount} | CONFIDENTIAL`, 50, footerY + 5, { width: W - 100, align: 'center' });
        }

        doc.end();
    });
}

// ============================================================================
// ARCHIVE + EMAIL + SCHEDULER
// ============================================================================

async function archiveOwnerPack(companyId, month, pdfBuffer, policySnapshot = {}) {
    const reportRunId = require('crypto').randomUUID();
    const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    // Store PDF to local path (in production this would be S3/cloud)
    const fs = require('fs');
    const reportsDir = path.join(__dirname, '../../owner_packs');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const pdfPath = path.join(reportsDir, `owner_pack_${companyId}_${month}_${reportRunId.split('-')[0]}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);

    const { data, error } = await supabase
        .from('owner_pack_reports')
        .insert({
            company_id: companyId,
            report_period: month,
            report_run_id: reportRunId,
            pdf_path: pdfPath,
            pdf_hash: pdfHash,
            policy_version_snapshot: policySnapshot,
            email_status: 'pending'
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to archive owner pack: ${error.message}`);

    return { reportRunId, pdfPath, pdfHash, reportId: data.id };
}

async function emailOwnerPack(companyId, month, pdfBuffer, recipients) {
    const monthLabel = new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' });

    for (const email of recipients.filter(Boolean)) {
        try {
            await sendInvoiceEmail(
                email,
                `📊 Monthly Owner Pack — ${monthLabel}`,
                `Please find attached your Monthly Owner Pack for ${monthLabel}. This report includes your P&L, Balance Sheet, Cash Flow summary, A/R Aging, and compliance reminders.`,
                `<h2>Monthly Owner Pack — ${monthLabel}</h2><p>Please find attached your financial summary for ${monthLabel}.</p><p>This includes your P&L, Balance Sheet, Cash Flow, A/R Aging, and upcoming compliance deadlines.</p><p><em>Generated by ICSS Command Center | Confidential</em></p>`,
                pdfBuffer,
                `owner_pack_${month}.pdf`,
                null
            );
        } catch (e) {
            console.error(`Failed to email owner pack to ${email}:`, e.message);
        }
    }
}

/**
 * Main orchestrator: generate + archive + email owner pack for a month.
 */
async function generateAndSendOwnerPack(companyId, month) {
    const settings = await getAccountingSettings(companyId);
    const recipients = [settings?.owner_email, settings?.accountant_email].filter(Boolean);

    if (recipients.length === 0) {
        console.warn(`No email recipients configured for company ${companyId}. Owner pack not emailed.`);
    }

    const pdfBuffer = await generateOwnerPackPDF(companyId, month);
    const archived = await archiveOwnerPack(companyId, month, pdfBuffer);

    if (recipients.length > 0) {
        await emailOwnerPack(companyId, month, pdfBuffer, recipients);

        await supabase
            .from('owner_pack_reports')
            .update({ emailed_to: recipients, emailed_at: new Date().toISOString(), email_status: 'sent' })
            .eq('id', archived.reportId);
    }

    // Write to audit log
    const { data: cData } = await supabase
        .from('companies')
        .select('tenant_id')
        .eq('id', companyId)
        .maybeSingle();

    if (cData && cData.tenant_id) {
        await supabase
            .from('audit_log')
            .insert({
                tenant_id: cData.tenant_id,
                company_id: companyId,
                action: 'generate_tax_pack',
                entity_type: 'OWNER_PACK',
                entity_id: archived.reportId,
                after_json: {
                    month,
                    recipients,
                    pdf_hash: archived.pdfHash,
                    report_run_id: archived.reportRunId,
                    email_status: recipients.length > 0 ? 'sent' : 'skipped'
                }
            });
    }

    return { ...archived, recipients };
}

module.exports = {
    generateOwnerPackPDF,
    archiveOwnerPack,
    emailOwnerPack,
    generateAndSendOwnerPack
};
