/**
 * Centralized service to compute invoice state (Single Source of Truth)
 */

const SERVICE_NAMES = {
    'WEB': 'Website Development',
    'APP': 'App Development',
    'GD': 'Graphic Designs',
    'HOST_PRO': 'Professional Hosting',
    'HOST_DOM': 'Hosting + Domain',
    'MAINT': 'Web Maintenance',
    'MONITOR': 'App Monitoring',
    'AUTO_BIZ': 'Business Automation',
    'AUTO_IND': 'Industry Automation',
    'REFRESH': 'Content Refresh',
    'CON': 'Consultation',
    'CUST': 'Custom Service'
};

function getServiceName(code) {
    return SERVICE_NAMES[code] || code || 'Service';
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
    });
}

/**
 * Computes the complete state for an invoice.
 * @param {Object} invoice - Database record or draft object
 * @param {Object} client - Client record
 * @returns {Object} computedInvoiceState
 */
function computeInvoiceState(rawInvoice, client) {
    let status = rawInvoice.payment_status || (rawInvoice.status === 'paid' ? 'PAID' : 'UNPAID');
    const isSubscription = !!rawInvoice.is_subscription;

    // Core Calculations with Rounding
    const total = Math.round(Number(rawInvoice.total_amount || 0) * 100) / 100;
    let paid = Math.round(Number(rawInvoice.amount_paid || 0) * 100) / 100;

    // AUTO-CORRECTION: If fully paid, force status to PAID
    if (paid >= total && total > 0 && status !== 'PAID') {
        status = 'PAID';
    }

    const depositPct = rawInvoice.deposit_percent || rawInvoice.payment_expected_percentage || 0;

    // AUTO-CORRECTION: If DEPOSIT status but amount_paid is 0, calculate from percent
    if (status === 'DEPOSIT' && paid === 0 && depositPct > 0) {
        paid = Math.round((total * (depositPct / 100)) * 100) / 100;
    }

    // AUTO-CORRECTION: If PAID but no date, set to NOW
    if (status === 'PAID' && !rawInvoice.paid_at) {
        rawInvoice.paid_at = new Date().toISOString();
    }

    // Balance Due Guard (Never negative)
    let balance = Math.round((total - paid) * 100) / 100;
    if (balance < 0) balance = 0;
    if (status === 'PAID') balance = 0;

    const serviceName = getServiceName(rawInvoice.service_code);

    const state = {
        invoiceNumber: rawInvoice.invoice_number,
        clientName: client.name,
        serviceType: serviceName,
        totalAmount: total,
        totalAmountFormatted: formatCurrency(total),
        currency: 'USD',
        paymentStatus: status,
        isSubscription: isSubscription,

        // Amounts
        amountPaid: paid,
        amountPaidFormatted: formatCurrency(paid),
        balanceDue: balance,
        balanceDueFormatted: formatCurrency(balance),
        depositPercent: depositPct,

        // Dates
        issueDate: rawInvoice.issue_date,
        // RULE: Paid invoices have NO due date
        dueDate: (status === 'PAID') ? null : (rawInvoice.due_date || null),
        paidAt: (status === 'PAID') ? (rawInvoice.paid_at || new Date().toISOString()) : null,
        renewalDate: rawInvoice.renewal_date || null,

        // PDF Specifics
        pdfWatermarkText: '',
        pdfWatermarkColor: '#FF0000',
        pdfShowDueDate: (status !== 'PAID'),
        pdfShowPaidDate: (status === 'PAID'),

        // Email Specifics
        emailSubjectText: '',
        emailHeaderText: `Invoice #${rawInvoice.invoice_number}`,
        emailSummaryRows: []
    };

    // Logic for Status Label / Watermark
    const theme = INVOICE_STATUS_THEME_MAP[status] || INVOICE_STATUS_THEME_MAP['UNPAID'];
    state.pdfWatermarkColor = theme.color;

    if (status === 'PAID') {
        state.pdfWatermarkText = theme.watermark;
        state.emailSubjectText = `Invoice #${state.invoiceNumber} — Paid in Full (Receipt Attached)`;
        state.emailSummaryRows = [
            { label: 'Total Amount', value: state.totalAmountFormatted },
            { label: 'Date Paid', value: formatDate(state.paidAt) },
            { label: 'Status', value: 'CLOSED / PAID' }
        ];
    } else if (status === 'DEPOSIT') {
        const fmtPct = Number(depositPct).toFixed(2).replace(/\.00$/, '');
        state.pdfWatermarkText = `${theme.watermark} — ${fmtPct}%`;
        state.emailSubjectText = `Invoice #${state.invoiceNumber} — Deposit Received (${fmtPct}%)`;
        state.emailSummaryRows = [
            { label: 'Total Project', value: state.totalAmountFormatted },
            { label: 'Deposit Received', value: state.amountPaidFormatted },
            { label: 'Balance Remaining', value: state.balanceDueFormatted },
            { label: 'Balance Due Date', value: formatDate(state.dueDate) }
        ];
    } else if (status === 'PARTIAL') {
        state.pdfWatermarkText = theme.watermark;
        state.emailSubjectText = `Invoice #${state.invoiceNumber} — Partial Payment Received`;
        state.emailSummaryRows = [
            { label: 'Total Invoice', value: state.totalAmountFormatted },
            { label: 'Amount Received', value: state.amountPaidFormatted },
            { label: 'Balance Remaining', value: state.balanceDueFormatted },
            { label: 'Due Date', value: formatDate(state.dueDate) }
        ];
    } else {
        state.pdfWatermarkText = theme.watermark;
        state.emailSubjectText = `Invoice #${state.invoiceNumber} — Payment Required`;
        state.emailSummaryRows = [
            { label: 'Total Due', value: state.totalAmountFormatted },
            { label: 'Due Date', value: formatDate(state.dueDate) }
        ];
    }

    // Subscription Override
    if (isSubscription) {
        const isRenewal = !!rawInvoice.is_renewal;
        state.emailSubjectText = isRenewal
            ? `Your Subscription has been Renewed — Invoice #${state.invoiceNumber}`
            : `Your Subscription is Active — Invoice #${state.invoiceNumber}`;

        state.emailSummaryRows = [
            { label: 'Service', value: state.serviceType },
            { label: 'Plan', value: rawInvoice.plan_name || 'Standard' },
            { label: 'Billing Cycle', value: rawInvoice.billing_cycle || 'Monthly' },
            { label: 'Amount Charged', value: state.totalAmountFormatted },
            { label: isRenewal ? 'Renewal Date' : 'Start Date', value: formatDate(state.issueDate) },
            { label: 'Next Renewal', value: formatDate(state.renewalDate) }
        ];
    }

    return state;
}

/**
 * Validates the computed state against business rules.
 * @param {Object} state 
 * @throws {Error} if validation fails
 */
const INVOICE_STATUS_THEME_MAP = {
    'UNPAID': { color: '#EF4444', watermark: 'UNPAID' }, // Rose-500
    'PAID': { color: '#10B981', watermark: 'PAID' }, // Emerald-500
    'PARTIAL': { color: '#6366F1', watermark: 'PARTIALLY PAID' }, // Indigo-500
    'DEPOSIT': { color: '#F59E0B', watermark: 'DEPOSIT PAID' } // Amber-500
};

/**
 * Validates the computed state against business rules.
 * @param {Object} state 
 * @throws {Error} if validation fails
 */
function validateInvoiceState(state) {
    const status = state.paymentStatus;

    // 1. PAID Rule: No Due Dates
    if (status === 'PAID') {
        if (state.dueDate !== null) throw new Error('PAID invoice must NOT have a due date.');
        if (!state.paidAt) throw new Error('PAID invoice must have a paidAt date.');
        if (state.balanceDue !== 0) throw new Error('PAID invoice must have 0 balance due.');
    }

    // 2. DEPOSIT Rule: Percent & Amounts
    if (status === 'DEPOSIT') {
        if (!state.depositPercent || state.depositPercent <= 0) throw new Error('DEPOSIT invoice must have a deposit percentage > 0.');
        if (state.amountPaid <= 0) throw new Error('DEPOSIT invoice must have amountPaid > 0.');
        if (state.balanceDue <= 0) throw new Error('DEPOSIT invoice must have a balance due > 0.');
        if (!state.emailSubjectText.includes('Deposit')) throw new Error('DEPOSIT email subject must contain "Deposit".');
    }

    // 3. PARTIAL Rule: Amounts & Balance
    if (status === 'PARTIAL') {
        if (state.amountPaid <= 0) throw new Error('PARTIAL invoice must have amountPaid > 0.');
        if (state.balanceDue <= 0) throw new Error('PARTIAL invoice must have a balance due > 0.');
    }

    // 4. UNPAID Rule: Balance = Total
    if (status === 'UNPAID') {
        if (state.balanceDue !== state.totalAmount) throw new Error('UNPAID invoice must have balance equal to total.');
    }

    return true;
}

// --- HELPER FUNCTIONS ---

function formatCurrency(amount) {
    return '$' + Number(amount).toFixed(2);
}

function formatDate(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
}

function getServiceName(code) {
    const map = {
        'WEB': 'Website Development',
        'APP': 'App Development',
        'GD': 'Graphic Designs',
        'HOST_PRO': 'Professional Hosting',
        'HOST_DOM': 'Hosting + Domain',
        'MAINT': 'Web Maintenance',
        'MONITOR': 'App Monitoring',
        'AUTO_BIZ': 'Business Automation',
        'AUTO_IND': 'Industry Automation',
        'REFRESH': 'Content Refresh',
        'CON': 'Consultation',
        'CUST': 'Custom Service'
    };
    return map[code] || 'Custom Service';
}

module.exports = { computeInvoiceState, validateInvoiceState, getServiceName, INVOICE_STATUS_THEME_MAP };
