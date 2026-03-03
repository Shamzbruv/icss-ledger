// public/js/accounting.js
const CONFIG = window.CONFIG;

let supabase;
let chartInstance = null;
let currentCompanyId = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Reuse the Supabase client created by layout.js if it exists, otherwise create a new one
    if (window.supabaseClient) {
        supabase = window.supabaseClient;
    } else {
        supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
        window.supabaseClient = supabase;
    }

    // Auth Check
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = '/login.html';
        return;
    }

    // Get Company ID
    const { data: company, error } = await supabase.from('companies').select('id, name').limit(1).single();
    if (error || !company) {
        showToast('Error: Could not find company record for this user.', 'error');
        console.error('Company fetch error:', error);
        return;
    }
    currentCompanyId = company.id;

    // Initialize UI
    initTabs();
    initSettingsForm();
    initExpenseForm();
    initAssetForm();
    initModals();
    initBulkImportForm();

    // Load Initial Data (Dashboard active by default)
    loadDashboard();
});

/* ==========================================================================
   TABS LOGIC
   ========================================================================== */
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const target = tab.getAttribute('data-target');
            document.getElementById(target).classList.add('active');

            // Load data based on tab
            switch (target) {
                case 'tab-dashboard': loadDashboard(); break;
                case 'tab-journal': loadJournal(); break;
                case 'tab-expenses': loadExpenses(); loadCoADropdown(); break;
                case 'tab-assets': loadAssets(); break;
                case 'tab-reports': break; // Loaded on demand
                case 'tab-gct': loadGCTTracker(); break;
            }
        });
    });
}

/* ==========================================================================
   DASHBOARD
   ========================================================================== */
async function loadDashboard() {
    const year = new Date().getFullYear();
    try {
        const formatJMD = (val) => new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD' }).format(val);

        // Fetch new Widget Data
        const wRes = await fetch(`/api/accounting/dashboard/widgets?company_id=${currentCompanyId}`);
        const widgets = await wRes.json();

        document.getElementById('kpi-mrr').textContent = formatJMD(widgets.mrr);
        document.getElementById('kpi-cash').textContent = formatJMD(widgets.cashBalance);

        let runwayText = `${widgets.runwayMonths} Months`;
        if (widgets.runwayMonths > 120) runwayText = 'Infinite';
        else if (widgets.runwayMonths < 0) runwayText = 'N/A';
        document.getElementById('kpi-runway').textContent = runwayText;

        document.getElementById('kpi-margin').textContent = `${widgets.ytdNetProfitMargin}%`;

        // Tax Estimate
        const taxRes = await fetch(`/api/accounting/tax/estimate?year=${year}&company_id=${currentCompanyId}`);
        const taxData = await taxRes.json();
        const taxReserve = taxData?.contributions?.totalContributions || 0;
        document.getElementById('kpi-tax-reserve').textContent = formatJMD(taxReserve);

        renderAgingChart(widgets.arAgingTotals);
        renderExpenseChart(widgets.expenseBreakdown);

        // Compliance Reminders
        const calRes = await fetch(`/api/accounting/tax/compliance-calendar?year=${year}&company_id=${currentCompanyId}`);
        const calendar = await calRes.json();
        renderComplianceCalendar(calendar);

        // Load Subscriptions Data directly into the Dashboard
        await loadSubscriptions();

    } catch (err) {
        console.error('Dashboard load error:', err);
        showToast('Failed to load dashboard data', 'error');
    }
}

/* ==========================================================================
   SUBSCRIPTIONS
   ========================================================================== */
async function loadSubscriptions() {
    const tbody = document.getElementById('subscriptionsTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
        const { data, error } = await supabase
            .from('client_services')
            .select(`
                id, frequency, next_billing_date, status,
                clients (name),
                service_plans (name, price)
            `)
            .order('next_billing_date', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No active subscriptions found. Add them in Client Care.</td></tr>';
            if (document.getElementById('kpi-subs-mrr')) document.getElementById('kpi-subs-mrr').textContent = 'JMD 0.00';
            return;
        }

        const formatJMD = (val) => new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD' }).format(val);

        let totalMRR = 0;

        tbody.innerHTML = data.map(sub => {
            if (sub.status === 'active') {
                totalMRR += parseFloat(sub.service_plans?.price || 0);
            }
            return `
            <tr>
                <td><strong>${sub.clients?.name || 'Unknown'}</strong></td>
                <td>${sub.service_plans?.name || 'Custom Plan'}</td>
                <td style="text-transform: capitalize;">${sub.frequency || 'Monthly'}</td>
                <td><span class="badge bg-secondary">${sub.next_billing_date ? new Date(sub.next_billing_date).toLocaleDateString() : 'N/A'}</span></td>
                <td class="text-right">${formatJMD(sub.service_plans?.price || 0)}</td>
                <td class="text-center">
                    ${sub.status === 'active'
                    ? '<span class="badge badge-success" style="background: #D1FAE5; color: #065F46;">Active</span>'
                    : '<span class="badge badge-warning" style="background: #FEF3C7; color: #92400E;">Inactive</span>'}
                </td>
            </tr>
        `}).join('');

        if (document.getElementById('kpi-subs-mrr')) {
            document.getElementById('kpi-subs-mrr').textContent = formatJMD(totalMRR);
        }

    } catch (err) {
        console.error('Failed to load subscriptions:', err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-danger">Error loading subscriptions</td></tr>';
    }
}

function renderAgingChart(agingTotals) {
    if (!agingTotals) return;
    const ctx = document.getElementById('agingChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const data = [
        agingTotals.current || 0,
        agingTotals.days0_30 || 0,
        agingTotals.days31_60 || 0,
        agingTotals.days61_90 || 0,
        agingTotals.over90 || 0
    ];

    const createGradient = (color1, color2) => {
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, color1);
        gradient.addColorStop(1, color2);
        return gradient;
    };

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'],
            datasets: [
                {
                    label: 'Outstanding Balance',
                    data: data,
                    backgroundColor: [
                        createGradient('#34d399', '#059669'),  // emerald
                        createGradient('#60a5fa', '#2563eb'),  // blue
                        createGradient('#fbbf24', '#d97706'),  // amber
                        createGradient('#f87171', '#dc2626'),  // red
                        createGradient('#b91c1c', '#7f1d1d')   // dark red
                    ],
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 45,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            color: '#cbd5e1',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleFont: { family: 'Inter', size: 13, weight: '600' },
                    bodyFont: { family: 'Inter', size: 14, weight: 'bold' },
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            if (context.parsed.y !== null) {
                                return new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD' }).format(context.parsed.y);
                            }
                            return '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, maxRotation: 0, minRotation: 0 }
                },
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                    ticks: {
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 11 },
                        padding: 10,
                        callback: function (value) {
                            if (value === 0) return '0';
                            return value.toLocaleString();
                        }
                    }
                }
            },
            animation: {
                duration: 2000,
                easing: 'easeOutQuart'
            }
        }
    });
}

let expChartInstance = null;
function renderExpenseChart(expenses) {
    if (!expenses) return;
    const ctx = document.getElementById('expenseChart').getContext('2d');
    if (expChartInstance) expChartInstance.destroy();

    const labels = expenses.map(e => e.name);
    const data = expenses.map(e => e.amount);

    const createGradient = (color1, color2) => {
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, color1);
        gradient.addColorStop(1, color2);
        return gradient;
    };

    expChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    createGradient('#34d399', '#059669'), // emerald
                    createGradient('#818cf8', '#4f46e5'), // indigo
                    createGradient('#f472b6', '#db2777'), // pink
                    createGradient('#fbbf24', '#d97706'), // amber
                    createGradient('#38bdf8', '#0284c7')  // sky
                ],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '80%', // Sleek thin ring
            layout: {
                padding: { top: 10, bottom: 10, left: 10, right: 10 }
            },
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#cbd5e1',
                        font: { family: 'Inter', size: 12 },
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleFont: { family: 'Inter', size: 13 },
                    bodyFont: { family: 'Inter', size: 14, weight: 'bold' },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function (context) {
                            let label = context.label || '';
                            if (label) label += ': ';
                            if (context.parsed !== null) {
                                label += new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD' }).format(context.parsed);
                            }
                            return label;
                        }
                    }
                }
            },
            animation: {
                animateScale: true,
                animateRotate: true,
                duration: 2000,
                easing: 'easeOutQuart'
            }
        }
    });
}

function renderComplianceCalendar(events) {
    const container = document.getElementById('compliance-list');
    container.innerHTML = '';

    if (!events || events.error || !Array.isArray(events) || events.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-3">No upcoming deadlines.</p>';
        return;
    }

    // Just show the next 5 upcoming
    const today = new Date();
    const upcoming = events.filter(e => new Date(e.dueDate) >= today)
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
        .slice(0, 5);

    upcoming.forEach(ev => {
        const dateObj = new Date(ev.dueDate);
        const month = dateObj.toLocaleString('default', { month: 'short' });
        const day = dateObj.getDate();

        container.innerHTML += `
            <div class="compliance-item pb-2 border-bottom mb-2 bg-light rounded px-3 py-2 ${ev.urgency === 'high' ? 'urgency-high border-danger border-left' : ''}">
                <div class="compliance-date text-primary font-weight-bold" style="min-width: 50px; text-align: center;">
                    <div style="font-size: 0.8rem; text-transform: uppercase;">${month}</div>
                    <div style="font-size: 1.2rem;">${day}</div>
                </div>
                <div class="compliance-details ml-3 w-100">
                    <h5 class="mb-1" style="font-size: 0.95rem; font-weight: 600;">${ev.event}</h5>
                    <p class="mb-0 text-muted" style="font-size: 0.8rem;">${ev.description}</p>
                </div>
            </div>
        `;
    });
}

/* ==========================================================================
   JOURNAL LEDGER
   ========================================================================== */
async function loadJournal() {
    try {
        // Just fetch latest 50 for the table for now
        const res = await fetch(`/api/accounting/journal?company_id=${currentCompanyId}&pageSize=50`);
        const data = await res.json();

        const tbody = document.getElementById('journalTableBody');
        tbody.innerHTML = '';

        if (!data.data || data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No journal entries found.</td></tr>';
            return;
        }

        data.data.forEach(entry => {
            const date = new Date(entry.posting_date).toLocaleDateString();
            const formatMoney = (val) => Number(val).toLocaleString('en-JM', { minimumFractionDigits: 2 });
            let linesHtml = entry.journal_lines.map(l =>
                `<div style="${l.is_credit ? 'padding-left: 20px;' : 'font-weight: 500;'}">
                    ${l.coa_account_code} - ${l.coa_accounts ? l.coa_accounts.name : 'Unknown Account'}
                 </div>`
            ).join('');

            let amountHtml = entry.journal_lines.map(l => {
                if (l.is_credit) return `<div><span class="text-muted">-</span></div>`;
                return `<div>${formatMoney(l.amount)}</div>`;
            }).join('');

            let creditHtml = entry.journal_lines.map(l => {
                if (!l.is_credit) return `<div><span class="text-muted">-</span></div>`;
                return `<div>${formatMoney(l.amount)}</div>`;
            }).join('');

            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td><span class="badge badge-secondary">${entry.source_type}</span> ${entry.source_id ? `<br><small class="text-muted">${entry.source_id.substring(0, 8)}</small>` : ''}</td>
                    <td>${entry.description} ${entry.is_reversal ? '<span class="badge badge-danger">REVERSAL</span>' : ''}</td>
                    <td>${linesHtml}</td>
                    <td class="text-right">${amountHtml}</td>
                    <td class="text-right">${creditHtml}</td>
                </tr>
            `;
        });
    } catch (err) {
        console.error('Journal error:', err);
        showToast('Failed to load journal ledger', 'error');
    }
}

document.getElementById('btnRefreshJournal').addEventListener('click', loadJournal);

/* ==========================================================================
   EXPENSES
   ========================================================================== */
async function loadExpenses() {
    try {
        const res = await fetch(`/api/accounting/expenses?company_id=${currentCompanyId}`);
        const expenses = await res.json();

        const tbody = document.getElementById('expensesTableBody');
        tbody.innerHTML = '';

        if (!expenses || expenses.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">No expenses recorded yet.</td></tr>';
            return;
        }

        const formatMoney = (val) => Number(val).toLocaleString('en-JM', { minimumFractionDigits: 2 });

        expenses.forEach(ex => {
            tbody.innerHTML += `
                <tr>
                    <td>${new Date(ex.expense_date).toLocaleDateString()}</td>
                    <td><strong>${ex.vendor_name}</strong></td>
                    <td>${ex.description}</td>
                    <td>${ex.coa_account_code}</td>
                    <td><span class="badge badge-info">${ex.expense_type}</span></td>
                    <td class="text-right">${formatMoney(ex.total_amount)} ${ex.currency}</td>
                    <td class="text-right">${ex.gct_amount > 0 ? formatMoney(ex.gct_amount) : '-'}</td>
                </tr>
            `;
        });
    } catch (err) { showToast('Failed to load expenses', 'error'); }
}

async function loadCoADropdown() {
    // Only fetch Expense accounts (4000-5999 roughly)
    try {
        const res = await fetch(`/api/accounting/coa?company_id=${currentCompanyId}`);
        const accounts = await res.json();

        const select = document.getElementById('expenseCoASelect');
        select.innerHTML = '<option value="">Select Expense Account...</option>';

        accounts.filter(a => a.account_type === 'expense').forEach(acc => {
            select.innerHTML += `<option value="${acc.code}">${acc.code} - ${acc.name}</option>`;
        });
    } catch (err) { console.error('CoA Error', err); }
}

function initExpenseForm() {
    document.getElementById('formExpense').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
            expense_type: fd.get('expense_type'),
            expense_date: fd.get('expense_date'),
            vendor_name: fd.get('vendor'),
            description: fd.get('description'),
            coa_account_code: fd.get('coa_account_code'),
            currency: fd.get('currency'),
            total_amount: parseFloat(fd.get('total_amount')),
            gct_amount: parseFloat(fd.get('gct_amount') || 0)
        };

        try {
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

            const res = await fetch('/api/accounting/expenses?company_id=' + currentCompanyId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error(await res.text());

            showToast('Expense recorded and posted to journal!', 'success');
            document.getElementById('modalExpense').style.display = 'none';
            e.target.reset();
            loadExpenses(); // Refresh table

            // Check if GCT checkbox in settings is on to show GCT input
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = false;
            btn.innerText = 'Post to Ledger';
        }
    });
}

// Check GCT registered state to show GCT input in expense form dynamically
window.accountingJS = {
    openExpenseModal: async () => {
        document.getElementById('modalExpense').style.display = 'block';
        const res = await fetch(`/api/accounting/settings?company_id=${currentCompanyId}`);
        const settings = await res.json();
        if (settings && settings.gct_registered) {
            document.getElementById('gctInputGroup').style.display = 'block';
        }
    },
    openAssetModal: () => { document.getElementById('modalAsset').style.display = 'block'; },

    viewReport: async (reportType) => {
        try {
            const container = document.getElementById('reportViewerContainer');
            const content = document.getElementById('reportViewerContent');
            const title = document.getElementById('reportViewerTitle');
            container.style.display = 'block';
            content.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Generating report...</p></div>';

            let url = `/api/accounting/reports/${reportType}?company_id=${currentCompanyId}`;
            let titleText = '';

            if (reportType === 'pnl') {
                const month = document.getElementById('pnlMonth').value;
                if (month) url += `&start=${month}-01&end=${month}-31`; // Approximation
                titleText = 'Profit & Loss Statement ' + (month ? `(${month})` : '(YTD)');
            } else if (reportType === 'balance-sheet') {
                const asOf = document.getElementById('bsDate').value;
                if (asOf) url += `&asOf=${asOf}`;
                titleText = 'Balance Sheet ' + (asOf ? `as of ${asOf}` : '(Current)');
            } else if (reportType === 'cash-flow') {
                titleText = 'Cash Flow Summary';
            } else if (reportType === 'trial-balance') {
                titleText = 'Trial Balance';
                url = `/api/accounting/trial-balance?company_id=${currentCompanyId}`;
            }

            title.innerText = titleText;
            const res = await fetch(url);
            const data = await res.json();

            // Very simple JSON renderer for now
            content.innerHTML = `<pre style="background: #f8f9fa; padding: 15px; border-radius: 5px;">${JSON.stringify(data, null, 2)}</pre>`;

        } catch (err) {
            showToast('Failed to run report. Check console.', 'error');
            console.error(err);
        }
    },

    // --- BULK IMPORT LOGIC ---
    currentBulkImportBatchId: null,
    currentBulkImportLines: [],

    openBulkImportModal: () => {
        document.getElementById('modalBulkImport').classList.remove('d-none');
        window.accountingJS.resetBulkImport();
    },

    closeBulkImportModal: () => {
        document.getElementById('modalBulkImport').classList.add('d-none');
        window.accountingJS.resetBulkImport();
    },

    resetBulkImport: () => {
        document.getElementById('formBulkImportParse').reset();
        document.getElementById('bulkImportStep1').classList.remove('d-none');
        document.getElementById('bulkImportStep2').classList.add('d-none');
        document.getElementById('bulkImportWarnings').innerHTML = '';
        document.getElementById('bulkImportPreviewTableBody').innerHTML = '';
        window.accountingJS.currentBulkImportBatchId = null;
        window.accountingJS.currentBulkImportLines = [];
    },

    updateLineOverrideCategory: async (lineId, selectElem) => {
        const row = document.getElementById(`bi-row-${lineId}`);
        const userAccountId = selectElem.value;
        const index = window.accountingJS.currentBulkImportLines.findIndex(l => l.raw.row_number === lineId);

        if (index > -1) {
            window.accountingJS.currentBulkImportLines[index].userAccountId = userAccountId;

            // Highlight row to show it was overridden manually
            if (userAccountId) {
                row.classList.add('table-warning');
            } else {
                row.classList.remove('table-warning');
            }

            // Sync with backend so we don't lose the selection
            const batchId = window.accountingJS.currentBulkImportBatchId;
            if (batchId) {
                try {
                    // Line's DB ID is needed, but we used row_number for DOM ID. 
                    // Let's find DB ID from parsed data (Wait, DB ID isn't returned for lines in parseResult directly, only batchData might have them or we just use simple index).
                    // Actually, the simplest approach is to accumulate overrides and send them when confirming.
                } catch (e) {
                    console.error('Update line category failed', e);
                }
            }
        }
    },

    bulkImportApplyDefaultPaymentAccount: () => {
        const cat = document.getElementById('bulkApplyOverrideCategory').value;
        if (!cat) return;

        const lines = window.accountingJS.currentBulkImportLines;
        lines.forEach(l => {
            const sel = document.getElementById(`bi-override-cat-${l.raw.row_number}`);
            if (sel) {
                sel.value = cat;
                window.accountingJS.updateLineOverrideCategory(l.raw.row_number, sel);
            }
        });
        showToast('Category applied to all lines.', 'info');
    },

    confirmBulkImport: async () => {
        const batchId = window.accountingJS.currentBulkImportBatchId;
        const paymentAccount = document.getElementById('bulkImportPaymentAccount').value;
        const lines = window.accountingJS.currentBulkImportLines;

        if (!batchId) return showToast('No batch to confirm.', 'error');
        if (!paymentAccount) return showToast('Please select a Default Payment Account.', 'error');

        // Ensure all valid lines have an account mapped (either suggested or overridden)
        const unmapped = lines.filter(l => l.parse_status === 'valid' && !l.suggested_account_id && !l.userAccountId);
        if (unmapped.length > 0) {
            return showToast(`There are ${unmapped.length} lines missing an expense category. Please map them before confirming.`, 'error');
        }

        const btn = document.getElementById('btnConfirmBulkImport');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Confirming...';

        try {
            // Build line overrides payload
            const lineOverrides = lines.filter(l => l.userAccountId).map(l => ({
                row_number: l.raw.row_number,
                user_account_id: l.userAccountId
            }));

            const payload = {
                default_payment_account_code: paymentAccount,
                line_overrides: lineOverrides
            };

            const res = await fetch(`/api/accounting/bulk-import/${batchId}/confirm?company_id=${currentCompanyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to confirm import');

            showToast(`Batch confirmed successfully! ${data.linesPosted} journals posted.`, 'success');
            window.accountingJS.closeBulkImportModal();
            loadJournal(); // Refresh ledger tab
            loadExpenses(); // Refresh expenses tab
        } catch (err) {
            showToast(err.message, 'error');
            console.error(err);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Confirm & Post Journals';
        }
    }
};

/* ==========================================================================
   BULK IMPORT INIT
   ========================================================================== */
async function initBulkImportForm() {
    document.getElementById('formBulkImportParse').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);

        const rawText = fd.get('rawText');
        const parseSettings = {
            dateFormatHint: fd.get('dateFormatHint') || null,
            invertPositives: fd.get('invertPositives') === 'true'
        };

        const btn = document.getElementById('btnParseBulkImport');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Parsing...';

        try {
            const res = await fetch(`/api/accounting/bulk-import/parse?company_id=${currentCompanyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawText, sourceType: 'clipboard_expense', parseSettings })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to parse');

            window.accountingJS.currentBulkImportBatchId = data.batchId;
            window.accountingJS.currentBulkImportLines = data.lines || [];

            // Load Accounts for dropdowns
            const coaRes = await fetch(`/api/accounting/coa?company_id=${currentCompanyId}`);
            const accounts = await coaRes.json();

            // Populate Payment Accounts dropdown
            const paymentSelect = document.getElementById('bulkImportPaymentAccount');
            paymentSelect.innerHTML = '<option value="">Select Bank / Clearing Account...</option>';
            accounts.filter(a => a.account_type === 'asset' || a.account_type === 'liability').forEach(a => {
                paymentSelect.innerHTML += `<option value="${a.code}">${a.code} - ${a.name}</option>`;
            });

            // Populate Bulk Apply dropdown
            const bulkApplySelect = document.getElementById('bulkApplyOverrideCategory');
            bulkApplySelect.innerHTML = '<option value="">Select Account...</option>';
            accounts.filter(a => a.account_type === 'expense').forEach(a => {
                bulkApplySelect.innerHTML += `<option value="${a.code}">${a.code} - ${a.name}</option>`;
            });

            // Build preview table rows
            const tbody = document.getElementById('bulkImportPreviewTableBody');
            tbody.innerHTML = '';

            let errorCount = 0;
            let warningCount = 0;

            const formatMoney = (val) => Number(val).toLocaleString('en-JM', { minimumFractionDigits: 2 });

            data.lines.forEach(l => {
                const tr = document.createElement('tr');
                tr.id = `bi-row-${l.raw.row_number}`;

                let statusIcon = '<i class="fas fa-check-circle text-success" title="Valid"></i>';
                let rowColor = '';

                if (l.parse_status === 'error') {
                    statusIcon = '<i class="fas fa-times-circle text-danger" title="Error"></i>';
                    rowColor = 'table-danger';
                    errorCount++;
                } else if (l.warnings && l.warnings.length > 0) {
                    statusIcon = '<i class="fas fa-exclamation-triangle text-warning" title="Warning"></i>';
                    rowColor = 'table-warning';
                    warningCount++;
                }

                tr.className = rowColor;

                // Category options for the override select
                let overrideOptions = `<option value="">(Use Suggestion)</option>`;
                accounts.filter(a => a.account_type === 'expense').forEach(a => {
                    overrideOptions += `<option value="${a.code}">${a.code} - ${a.name}</option>`;
                });

                const dateStr = l.normalized ? l.normalized.date : (l.raw.Date || 'N/A');
                const descStr = l.normalized ? l.normalized.description : (l.raw.Description || 'N/A');
                const amountStr = l.normalized ? `${formatMoney(l.normalized.amount)} ${l.normalized.currency || ''}` : (l.raw.Amount || 'N/A');

                let suggestionHtml = '<span class="text-muted">None</span>';
                if (l.suggested_account_id) {
                    suggestionHtml = `<span class="badge badge-info">${l.suggested_account_id}</span> <small class="text-muted">(${l.suggestion_confidence}%)</small>`;
                }

                tr.innerHTML = `
                    <td class="text-center">${statusIcon}</td>
                    <td>${dateStr}</td>
                    <td title="${descStr}">${descStr.substring(0, 30)}${descStr.length > 30 ? '...' : ''}</td>
                    <td class="text-right">${amountStr}</td>
                    <td>${suggestionHtml}</td>
                    <td>
                        <select class="form-control form-control-sm" id="bi-override-cat-${l.raw.row_number}" onchange="window.accountingJS.updateLineOverrideCategory(${l.raw.row_number}, this)">
                            ${overrideOptions}
                        </select>
                        ${l.parse_status === 'error' ? `<small class="text-danger d-block mt-1">${l.warnings.join(', ')}</small>` : ''}
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Show warnings/errors summary
            const warningsDiv = document.getElementById('bulkImportWarnings');
            if (errorCount > 0) {
                warningsDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> ${errorCount} line(s) have critical parsing errors. They will be skipped.</div>`;
            } else if (warningCount > 0) {
                warningsDiv.innerHTML = `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle"></i> ${warningCount} line(s) have warnings (e.g. inferred dates or currencies). Please verify carefully.</div>`;
            } else {
                warningsDiv.innerHTML = ``;
            }

            const btnConfirm = document.getElementById('btnConfirmBulkImport');
            if (errorCount === data.lines.length) {
                btnConfirm.disabled = true;
                showToast('All lines have errors. Cannot proceed.', 'error');
            } else {
                btnConfirm.disabled = false;
            }

            // Switch to step 2
            document.getElementById('bulkImportStep1').classList.add('d-none');
            document.getElementById('bulkImportStep2').classList.remove('d-none');

        } catch (err) {
            showToast(err.message, 'error');
            console.error(err);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Parse & Preview';
        }
    });
}

/* ==========================================================================
   FIXED ASSETS
   ========================================================================== */
async function loadAssets() {
    try {
        const res = await fetch(`/api/accounting/assets?company_id=${currentCompanyId}`);
        const data = await res.json();

        const tbody = document.getElementById('assetsTableBody');
        tbody.innerHTML = '';

        if (!data.assets || data.assets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">No fixed assets registered.</td></tr>';
            return;
        }

        const formatMoney = (val) => Number(val).toLocaleString('en-JM', { minimumFractionDigits: 2 });

        data.assets.forEach(a => {
            tbody.innerHTML += `
                <tr>
                    <td><strong>${a.asset_name}</strong></td>
                    <td><span class="badge badge-secondary">${a.category.replace('_', ' ')}</span></td>
                    <td>${new Date(a.purchase_date).toLocaleDateString()}</td>
                    <td class="text-right">${formatMoney(a.original_cost)}</td>
                    <td class="text-right text-danger">${formatMoney(a.accumulated_depreciation_book || 0)}</td>
                    <td class="text-right font-weight-bold">${formatMoney(a.current_book_value)}</td>
                    <td class="text-center">
                        ${a.status === 'active' ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-secondary">Disposed</span>'}
                    </td>
                </tr>
            `;
        });
    } catch (err) { showToast('Failed to load assets', 'error'); }
}

function initAssetForm() {
    document.getElementById('formAsset').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
            assetName: fd.get('assetName'),
            category: fd.get('assetCategory'),
            purchaseDate: fd.get('purchaseDate'),
            originalCost: parseFloat(fd.get('cost')),
            businessUsePercent: parseFloat(fd.get('businessUsePercent')),
            usefulLifeYears: parseInt(fd.get('usefulLifeYears'))
        };

        try {
            const res = await fetch('/api/accounting/assets?company_id=' + currentCompanyId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error(await res.text());

            showToast('Asset Capitalized & Journal Entry Posted!', 'success');
            document.getElementById('modalAsset').style.display = 'none';
            e.target.reset();
            loadAssets();
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Depreciation Post Button
    document.getElementById('btnRunDepreciation').addEventListener('click', async () => {
        if (!confirm("Are you sure? This will calculate and post depreciation journal entries for the current financial year for all active assets.")) return;

        try {
            const year = new Date().getFullYear();
            const res = await fetch(`/api/accounting/depreciation/post/${year}?company_id=${currentCompanyId}`, { method: 'POST' });
            if (!res.ok) throw new Error(await res.text());

            showToast('Depreciation Journals Posted Successfully!', 'success');
            loadAssets();
        } catch (err) { showToast('Error posting depreciation: ' + err.message, 'error'); }
    });
}

/* ==========================================================================
   GCT TRACKER
   ========================================================================== */
async function loadGCTTracker() {
    try {
        const res = await fetch(`/api/accounting/tax/gct-status?company_id=${currentCompanyId}`);
        const data = await res.json();

        const badge = document.getElementById('gct-status-badge');
        const fill = document.getElementById('gct-bar-fill');
        const msg = document.getElementById('gct-tracker-message');
        const formsSection = document.getElementById('gct-forms-section');

        const formatMoney = (val) => Number(val).toLocaleString('en-JM', { minimumFractionDigits: 0 });

        if (data.warningLevel === 'exceeded') {
            badge.className = 'badge badge-danger';
            badge.innerText = 'THRESHOLD EXCEEDED';
            fill.className = 'gct-bar-fill danger';
        } else if (data.warningLevel === 'approaching') {
            badge.className = 'badge badge-warning';
            badge.innerText = 'APPROACHING THRESHOLD';
            fill.className = 'gct-bar-fill danger';
        } else {
            badge.className = 'badge badge-success';
            badge.innerText = 'BELOW THRESHOLD';
            fill.className = 'gct-bar-fill';
        }

        // Cap width at 100% for the UI bar
        fill.style.width = Math.min(data.percentageOfThreshold, 100) + '%';
        document.getElementById('gct-threshold-val').innerText = 'JMD 15M'; // Fixed for now

        msg.innerHTML = `Your trailing 12-month taxable turnover is <strong>JMD ${formatMoney(data.currentTurnover)}</strong> (${data.percentageOfThreshold.toFixed(1)}% of the JMD 15M threshold).`;

        // Check if actually registered to show forms
        const setRes = await fetch(`/api/accounting/settings?company_id=${currentCompanyId}`);
        const settings = await setRes.json();

        if (settings && settings.gct_registered) {
            formsSection.style.display = 'block';
            badge.className = 'badge badge-primary';
            badge.innerText = 'GCT REGISTERED';
        }
    } catch (err) {
        document.getElementById('gct-tracker-message').innerText = 'Failed to load GCT status.';
    }
}

document.getElementById('btnDownloadForm4A').addEventListener('click', () => {
    const period = document.getElementById('gctFormPeriod').value; // YYYY-MM
    if (!period) return alert('Select a period');

    // Last day of month logic
    const [year, month] = period.split('-');
    const start = `${year}-${month}-01`;
    const end = new Date(year, parseInt(month), 0).toISOString().split('T')[0];

    window.location.href = `/api/accounting/gct/form4a?company_id=${currentCompanyId}&start=${start}&end=${end}&pdf=true`;
});

/* ==========================================================================
   SETTINGS & REPORTS ACTIONS
   ========================================================================== */
function initSettingsForm() {
    const cb = document.getElementById('gctRegisteredCb');
    const group = document.getElementById('gctRegNumGroup');
    cb.addEventListener('change', (e) => {
        group.style.display = e.target.checked ? 'block' : 'none';
    });

    // Load current
    document.getElementById('btnSettings').addEventListener('click', async () => {
        const res = await fetch(`/api/accounting/settings?company_id=${currentCompanyId}`);
        const settings = await res.json();
        if (settings) {
            const form = document.getElementById('formSettings');
            if (settings.business_type) form.business_type.value = settings.business_type;
            if (settings.trn) form.trn.value = settings.trn;
            if (settings.nht_category) form.nht_category.value = settings.nht_category;
            if (settings.accountant_email) form.accountant_email.value = settings.accountant_email;
            if (settings.fx_rate_usd_to_jmd) form.fx_rate_usd_to_jmd.value = settings.fx_rate_usd_to_jmd;

            cb.checked = settings.gct_registered === true;
            group.style.display = cb.checked ? 'block' : 'none';
            if (settings.gct_config && settings.gct_config.registration_number) {
                document.getElementById('gct_registration_number').value = settings.gct_config.registration_number;
            }
        }
    });

    document.getElementById('formSettings').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
            business_type: fd.get('business_type'),
            trn: fd.get('trn'),
            nht_category: fd.get('nht_category'),
            accountant_email: fd.get('accountant_email'),
            gct_registered: document.getElementById('gctRegisteredCb').checked,
            fx_rate_usd_to_jmd: parseFloat(fd.get('fx_rate_usd_to_jmd'))
        };

        try {
            const res = await fetch(`/api/accounting/settings?company_id=${currentCompanyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error();

            // Also update GCT config if changed
            if (payload.gct_registered) {
                // Not saving reg number in the simple settings endpoint yet, need custom call if implemented fully
            }

            showToast('Settings saved successfully', 'success');
            document.getElementById('modalSettings').style.display = 'none';
        } catch (err) { showToast('Failed to save settings', 'error'); }
    });
}

function initModals() {
    // Generate Tax Pack Action
    document.getElementById('btnExportTaxPack').addEventListener('click', () => {
        const year = prompt("Enter Tax Year (e.g. 2024 or 2025):", new Date().getFullYear());
        if (!year) return;

        showToast(`Generating Jamaica Tax Pack for ${year}... Please wait.`, 'info');
        window.location.href = `/api/accounting/tax/generate-pack/${year}?company_id=${currentCompanyId}`;
    });

    // Generate Owner Pack
    document.getElementById('btnGenerateOwnerPack').addEventListener('click', async () => {
        // Just default to last month for ease
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

        const month = prompt("Enter month to generate owner pack (YYYY-MM):", yyyymm);
        if (!month) return;

        showToast(`Generating Owner Pack for ${month}... Please wait.`, 'info');
        window.location.href = `/api/accounting/reports/owner-pack/${month}?company_id=${currentCompanyId}`;
    });
}

function showToast(text, type = 'info') {
    Toastify({
        text: text,
        duration: 3000,
        close: true,
        gravity: "top",
        position: "right",
        backgroundColor: type === 'error' ? "#E53E3E" : (type === 'success' ? "#38A169" : "#3182CE"),
    }).showToast();
}
