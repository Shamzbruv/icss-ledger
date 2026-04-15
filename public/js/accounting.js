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
    initEditExpenseForm();
    initAssetForm();
    initModals();
    initBulkImportForm();
    initJournalForm();

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
                case 'tab-expenses': loadCoADropdown().then(() => loadExpenses()); break;
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
        
        // Load the new Trial Balance Account Watchlist
        await loadTrialBalanceDashboard();

        // AR KPI card — use the same combined total as the aging chart (invoices + ledger)
        const arEl = document.getElementById('kpi-ar-ledger');
        if (arEl) {
            const totalAR = widgets.arAgingTotals?.grandTotal || 0;
            arEl.textContent = new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD' }).format(totalAR);
        }

    } catch (err) {
        console.error('Dashboard load error:', err);
        showToast('Failed to load dashboard data', 'error');
    }
}

async function loadTrialBalanceDashboard() {
    const tbody = document.getElementById('trialBalanceTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';
    try {
        const yearStart = `${new Date().getFullYear()}-01-01`; // Optionally, we could pass 2000-01-01 for lifetime, but the API endpoint defaults to year start.
        const res = await fetch(`/api/accounting/trial-balance?company_id=${currentCompanyId}&start=2000-01-01`);
        const accounts = await res.json();
        
        tbody.innerHTML = '';
        if (!accounts || accounts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">No balances recorded yet.</td></tr>';
            return;
        }

        const formatMoney = (val) => new Intl.NumberFormat('en-JM', { minimumFractionDigits: 2 }).format(val);

        accounts.forEach(acc => {
            if (acc.balance === 0) return; // Hide zero balance accounts
            tbody.innerHTML += `
                <tr>
                    <td data-label="Account"><strong>${acc.accountCode}</strong> - ${acc.accountName}</td>
                    <td data-label="Type"><span class="badge badge-light" style="text-transform: capitalize;">${acc.accountType}</span></td>
                    <td data-label="Debit Balance" class="text-right">${acc.normalBalance === 'debit' && acc.balance > 0 ? formatMoney(acc.balance) : '-'}</td>
                    <td data-label="Credit Balance" class="text-right">${acc.normalBalance === 'credit' && acc.balance > 0 ? formatMoney(acc.balance) : '-'}</td>
                    <td data-label="Net Balance" class="text-right"><strong>${formatMoney(acc.balance)}</strong></td>
                </tr>
            `;
        });
        
    } catch (err) {
        console.error('Failed to load trial balance for dashboard:', err);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-danger">Error loading ledger balances</td></tr>';
    }
}

/* ==========================================================================
   SUBSCRIPTIONS
   ========================================================================== */
async function loadSubscriptions() {
    const tbody = document.getElementById('subscriptionsTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
        const res = await fetch('/api/admin/client-services');
        const data = await res.json();
        
        if (!data || data.length === 0 || data.error) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No active subscriptions found. Add them in Client Care.</td></tr>';
            if (document.getElementById('kpi-subs-mrr')) document.getElementById('kpi-subs-mrr').textContent = 'JMD 0.00';
            return;
        }

        const formatJMD = (val) => new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD' }).format(val);

        let totalMRR = 0;
        const FX_RATE = 158;

        tbody.innerHTML = data.map(sub => {
            let priceUSD = parseFloat(sub.service_plans?.price || 0);
            let priceJMD = priceUSD * FX_RATE;

            if (sub.status === 'active') {
                totalMRR += priceJMD;
            }
            return `
            <tr>
                <td data-label="Client Name"><strong>${sub.clients?.name || 'Unknown'}</strong></td>
                <td data-label="Plan">${sub.service_plans?.name || 'Custom Plan'}</td>
                <td data-label="Billing Cycle"><span class="badge bg-light text-dark">${sub.frequency}</span></td>
                <td data-label="Next Billing">
                    ${sub.next_renewal_date ? new Date(sub.next_renewal_date).toLocaleDateString() : 'N/A'}
                </td>
                <td data-label="Amount"><strong>${sub.service_plans?.price ? formatJMD(sub.service_plans.price) : 'N/A'}</strong></td>
                <td data-label="Status" class="text-center">
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
    const canvas = document.getElementById('expenseChart');
    const ctx = canvas.getContext('2d');
    if (expChartInstance) {
        expChartInstance.destroy();
        expChartInstance = null;
    }

    if (expenses.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No expenses recorded YTD', canvas.width / 2, canvas.height / 2);
        return;
    }

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
let expenseMiniChartInstance = null;
async function loadJournal() {
    const tbody = document.getElementById('journalTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
        const sourceFilter = document.getElementById('journalFilterSource')?.value ?? 'manual';
        const monthFilter = document.getElementById('journalFilterMonth')?.value;

        let url = `/api/accounting/journal?company_id=${currentCompanyId}&pageSize=100`;
        if (sourceFilter) url += `&sourceType=${encodeURIComponent(sourceFilter)}`;
        if (monthFilter) {
            const [year, month] = monthFilter.split('-');
            const lastDay = new Date(year, month, 0).getDate();
            url += `&periodStart=${year}-${month}-01&periodEnd=${year}-${month}-${lastDay}`;
        }

        const res = await fetch(url);
        const data = await res.json();

        tbody.innerHTML = '';

        if (!data.entries || data.entries.length === 0) {
            const sourceLabel = sourceFilter ? `source type: "${sourceFilter}"` : 'any source';
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No journal entries found for ${sourceLabel}${monthFilter ? ' in ' + monthFilter : ''}.</td></tr>`;
            // Zero out KPIs
            ['jnl-total-entries','jnl-total-debits','jnl-total-credits','jnl-accounts-hit'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });
            return;
        }

        const formatMoney = (val) => Number(val).toLocaleString('en-JM', { minimumFractionDigits: 2 });

        // -- Compute summary analytics --
        let totalDebits = 0, totalCredits = 0;
        const accountsHit = new Set();

        data.entries.forEach(entry => {
            const date = new Date(entry.journal_date).toLocaleDateString();
            let linesHtml = entry.journal_lines.map(l => {
                const acctCode = l.chart_of_accounts ? l.chart_of_accounts.code : 'Unknown';
                const acctName = l.chart_of_accounts ? l.chart_of_accounts.name : 'Unknown Account';
                if (acctCode !== 'Unknown') accountsHit.add(acctCode);
                totalDebits += Number(l.debit || 0);
                totalCredits += Number(l.credit || 0);
                return `<div style="${l.credit > 0 ? 'padding-left: 20px;' : 'font-weight: 500;'}">
                    ${acctCode} - ${acctName}
                 </div>`;
            }).join('');

            let amountHtml = entry.journal_lines.map(l => {
                if (l.credit > 0 && l.debit === 0) return `<div><span class="text-muted">-</span></div>`;
                return `<div>${formatMoney(l.debit)}</div>`;
            }).join('');

            let creditHtml = entry.journal_lines.map(l => {
                if (l.debit > 0 && l.credit === 0) return `<div><span class="text-muted">-</span></div>`;
                return `<div>${formatMoney(l.credit)}</div>`;
            }).join('');

            const isReversal = entry.reversal_of_journal_id;
            const sourceType = entry.source_type || 'manual';

            tbody.innerHTML += `
                <tr>
                    <td data-label="Date">${date}</td>
                    <td data-label="Source"><span class="badge badge-secondary">${sourceType}</span></td>
                    <td data-label="Description">${entry.narration || ''} ${isReversal ? '<span class="badge badge-danger">REVERSAL</span>' : ''}</td>
                    <td data-label="Account">${linesHtml}</td>
                    <td data-label="Debit" class="text-right">${amountHtml}</td>
                    <td data-label="Credit" class="text-right">${creditHtml}</td>
                </tr>
            `;
        });

        // -- Populate summary KPI bar --
        const setKPI = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setKPI('jnl-total-entries', data.entries.length);
        setKPI('jnl-total-debits', formatMoney(totalDebits / 2)); // each line logged twice (dr+cr)
        setKPI('jnl-total-credits', formatMoney(totalCredits / 2));
        setKPI('jnl-accounts-hit', accountsHit.size);

    } catch (err) {
        console.error('Journal error:', err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-danger">Failed to load journal entries.</td></tr>';
        showToast('Failed to load journal ledger', 'error');
    }
}

document.getElementById('btnRefreshJournal').addEventListener('click', loadJournal);
document.getElementById('journalFilterSource')?.addEventListener('change', loadJournal);


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

        // Build a code → name lookup from cached accounts (loaded by loadCoADropdown)
        const acctNameMap = {};
        (window.accountingJS._cachedAccounts || []).forEach(a => { acctNameMap[a.code] = a.name; });
        const codeName = (code) => acctNameMap[code] || code; // fallback to code if name not cached

        expenses.forEach(ex => {
            const vendorDisplay = ex.vendor || ex.vendor_name || '';
            window.loadedExpenses = window.loadedExpenses || {};
            window.loadedExpenses[ex.id] = ex;

            tbody.innerHTML += `
                <tr>
                    <td data-label="Date">${new Date(ex.expense_date).toLocaleDateString()}</td>
                    <td data-label="Vendor"><strong>${vendorDisplay}</strong></td>
                    <td data-label="Description">${ex.description}</td>
                    <td data-label="Category">${codeName(ex.coa_account_code)}</td>
                    <td data-label="Type"><span class="badge badge-info">${ex.expense_type}</span></td>
                    <td data-label="Amount" class="text-right">${formatMoney(ex.total_amount)} ${ex.currency}</td>
                    <td data-label="Tax (GCT)" class="text-right">${ex.gct_amount > 0 ? formatMoney(ex.gct_amount) : '-'}</td>
                    <td data-label="Actions" class="text-right">
                        <button class="btn btn-sm btn-outline-secondary" onclick="window.accountingJS.openEditExpenseModal('${ex.id}')"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="window.accountingJS.deleteExpense('${ex.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });

        // -- Populate Expense Summary KPIs (using names as keys) --
        const totalAmt = expenses.reduce((s, e) => s + Number(e.total_amount || 0), 0);
        const totalGCT = expenses.reduce((s, e) => s + Number(e.gct_amount || 0), 0);
        const catTotals = {};
        expenses.forEach(e => {
            const label = codeName(e.coa_account_code);
            catTotals[label] = (catTotals[label] || 0) + Number(e.total_amount || 0);
        });
        const topCat = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0]?.[0] || '-';

        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('exp-total-amount', formatMoney(totalAmt));
        setEl('exp-total-gct', formatMoney(totalGCT));
        setEl('exp-count', expenses.length);
        setEl('exp-top-category', topCat);
        const bar = document.getElementById('expenseSummaryBar');
        if (bar) bar.style.display = '';

        // -- Mini donut chart for expense categories --
        const catCtx = document.getElementById('expenseMiniChart');
        if (catCtx) {
            if (expenseMiniChartInstance) { expenseMiniChartInstance.destroy(); expenseMiniChartInstance = null; }
            const labels = Object.keys(catTotals);
            const vals = Object.values(catTotals);
            expenseMiniChartInstance = new Chart(catCtx.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{ data: vals, backgroundColor: ['#34d399','#818cf8','#f472b6','#fbbf24','#38bdf8','#a78bfa','#fb923c'], borderWidth: 0 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '70%',
                    plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } } }
                }
            });
        }

    } catch (err) { Object.assign(window, { lastErr: err }); showToast('Failed to load expenses', 'error'); }
}

async function loadCoADropdown() {
    try {
        const res = await fetch(`/api/accounting/coa?company_id=${currentCompanyId}`);
        const accounts = await res.json();

        window.accountingJS._cachedAccounts = accounts; // Cache all accounts for Journals

        const select = document.getElementById('expenseCoASelect');
        const editSelect = document.getElementById('editExpenseCoASelect');

        select.innerHTML = '<option value="">Select Expense Account...</option>';
        if (editSelect) editSelect.innerHTML = '<option value="">Select Expense Account...</option>';

        accounts.filter(a => a.account_type === 'expense').forEach(acc => {
            select.innerHTML += `<option value="${acc.code}">${acc.code} - ${acc.name}</option>`;
            if (editSelect) editSelect.innerHTML += `<option value="${acc.code}">${acc.code} - ${acc.name}</option>`;
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

function initEditExpenseForm() {
    document.getElementById('formEditExpense').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);

        const expenseId = fd.get('expense_id');
        const payload = {
            expense_type: fd.get('expense_type'),
            expense_date: fd.get('expense_date'),
            vendor: fd.get('vendor'),
            description: fd.get('description'),
            coa_account_code: fd.get('coa_account_code'),
            currency: fd.get('currency'),
            total_amount: parseFloat(fd.get('total_amount')),
            gct_amount: parseFloat(fd.get('gct_amount') || 0)
        };

        try {
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

            const res = await fetch(`/api/accounting/expenses/${expenseId}?company_id=${currentCompanyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error(await res.text());

            showToast('Expense and journal updated successfully!', 'success');
            document.getElementById('modalEditExpense').classList.add('d-none');
            loadExpenses();
            loadJournal(); // Update dashboard components implicitly
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = false;
            btn.innerText = 'Update Expense & Ledger';
        }
    });
}

function initJournalForm() {
    document.getElementById('formJournal').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const journal_date = fd.get('journal_date');
        const description = fd.get('description');

        const lineRows = document.querySelectorAll('#journalLinesBody tr');
        const lines = [];

        lineRows.forEach(tr => {
            const acc = tr.querySelector('.journal-account-code').value;
            const desc = tr.querySelector('.journal-line-desc').value;
            const deb = tr.querySelector('.journal-debit').value;
            const cred = tr.querySelector('.journal-credit').value;

            if (acc && (parseFloat(deb) > 0 || parseFloat(cred) > 0)) {
                lines.push({ account_code: acc, description: desc, debit: deb, credit: cred });
            }
        });

        const errBox = document.getElementById('journalErrorBox');
        if (lines.length < 2) {
            errBox.innerText = 'You must add at least two journal lines.';
            errBox.classList.remove('d-none');
            return;
        }

        try {
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

            const res = await fetch(`/api/accounting/journal?company_id=${currentCompanyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ journal_date, description, lines })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to post journal');
            }

            showToast('Journal Entry recorded successfully!', 'success');
            document.getElementById('modalJournal').classList.add('d-none');
            loadJournal();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            const btn = e.target.querySelector('button[type="submit"]');
            if (btn) {
                btn.disabled = false;
                btn.innerText = 'Post Journal Entry';
            }
        }
    });
}

// Check GCT registered state to show GCT input in expense form dynamically
window.accountingJS = {
    loadTrialBalanceDashboard: loadTrialBalanceDashboard,
    openJournalModal: () => {
        document.getElementById('modalJournal').classList.remove('d-none');
        document.getElementById('formJournal').reset();
        document.getElementById('journalLinesBody').innerHTML = '';

        // Ensure chart of accounts is loaded if they haven't visited expenses
        if (!window.accountingJS._cachedAccounts) {
            loadCoADropdown().then(() => {
                window.accountingJS.addJournalLineRow();
                window.accountingJS.addJournalLineRow();
            });
        } else {
            window.accountingJS.addJournalLineRow();
            window.accountingJS.addJournalLineRow();
        }
        window.accountingJS.calculateJournalTotals();
    },
    addJournalLineRow: () => {
        const tbody = document.getElementById('journalLinesBody');
        const options = (window.accountingJS._cachedAccounts || []).map(a => `<option value="${a.code}">${a.code} - ${a.name}</option>`).join('');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <select class="form-control form-control-sm journal-account-code" required>
                    <option value="">Select Account...</option>
                    ${options}
                </select>
                <input type="text" class="form-control form-control-sm mt-1 journal-line-desc" placeholder="Line description (optional)">
            </td>
            <td><input type="number" step="0.01" class="form-control form-control-sm journal-debit" value="0" oninput="window.accountingJS.calculateJournalTotals()"></td>
            <td><input type="number" step="0.01" class="form-control form-control-sm journal-credit" value="0" oninput="window.accountingJS.calculateJournalTotals()"></td>
            <td><button type="button" class="btn btn-sm text-danger" onclick="this.closest('tr').remove(); window.accountingJS.calculateJournalTotals();"><i class="fas fa-times"></i></button></td>
        `;
        tbody.appendChild(tr);
    },
    calculateJournalTotals: () => {
        let debits = 0;
        let credits = 0;
        document.querySelectorAll('.journal-debit').forEach(i => debits += (parseFloat(i.value) || 0));
        document.querySelectorAll('.journal-credit').forEach(i => credits += (parseFloat(i.value) || 0));

        document.getElementById('journalTotalDebit').innerHTML = '<strong>' + debits.toLocaleString('en-JM', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</strong>';
        document.getElementById('journalTotalCredit').innerHTML = '<strong>' + credits.toLocaleString('en-JM', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</strong>';

        const errBox = document.getElementById('journalErrorBox');
        if (Math.abs(debits - credits) > 0.01) {
            errBox.innerText = 'Debits and Credits must balance.';
            errBox.classList.remove('d-none');
            document.querySelector('#formJournal button[type="submit"]').disabled = true;
        } else {
            errBox.classList.add('d-none');
            document.querySelector('#formJournal button[type="submit"]').disabled = false;
        }
    },
    openExpenseModal: async () => {
        document.getElementById('modalExpense').style.display = 'block';
        const res = await fetch(`/api/accounting/settings?company_id=${currentCompanyId}`);
        const settings = await res.json();
        if (settings && settings.gct_registered) {
            document.getElementById('gctInputGroup').style.display = 'block';
        }
    },
    toggleExpenseFields: (type) => { },

    openEditExpenseModal: async (id) => {
        const ex = window.loadedExpenses ? window.loadedExpenses[id] : null;
        if (!ex) return showToast('Error loading expense data', 'error');

        document.getElementById('edit_expense_id').value = ex.id;
        document.getElementById('edit_expense_type').value = ex.expense_type;
        document.getElementById('edit_expense_date').value = ex.expense_date.split('T')[0];
        document.getElementById('edit_vendor').value = ex.vendor || ex.vendor_name || '';
        document.getElementById('edit_description').value = ex.description;
        document.getElementById('editExpenseCoASelect').value = ex.coa_account_code;
        document.getElementById('edit_currency').value = ex.currency;
        document.getElementById('edit_total_amount').value = ex.total_amount;

        document.getElementById('modalEditExpense').classList.remove('d-none');

        const res = await fetch(`/api/accounting/settings?company_id=${currentCompanyId}`);
        const settings = await res.json();
        if (settings && settings.gct_registered) {
            document.getElementById('editGctInputGroup').style.display = 'block';
            document.getElementById('edit_gct_amount').value = ex.gct_amount || 0;
        } else {
            document.getElementById('editGctInputGroup').style.display = 'none';
        }
    },
    toggleEditExpenseFields: (type) => { },

    deleteExpense: async (id) => {
        if (!confirm('Are you sure you want to permanently delete this expense and its underlying journal entry? This will impact your ledger.')) {
            return;
        }
        try {
            const res = await fetch(`/api/accounting/expenses/${id}?company_id=${currentCompanyId}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error(await res.text());
            showToast('Expense and journal entry deleted successfully.', 'success');
            loadExpenses();
            loadJournal(); // Update dashboard components implicitly
        } catch (err) {
            showToast(err.message || 'Failed to delete expense', 'error');
        }
    },

    openAssetModal: () => { document.getElementById('modalAsset').style.display = 'block'; },

    viewReport: async (reportType) => {
        try {
            const container = document.getElementById('reportViewerContainer');
            const content = document.getElementById('reportViewerContent');
            const title = document.getElementById('reportViewerTitle');
            container.style.display = 'block';
            content.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-2x"></i><p class="mt-3">Generating report...</p></div>';
            container.scrollIntoView({ behavior: 'smooth' });

            const fmt = (val) => new Intl.NumberFormat('en-JM', { minimumFractionDigits: 2 }).format(val || 0);
            const fmtSign = (val) => (val < 0 ? `<span class="text-danger">(${fmt(Math.abs(val))})</span>` : `<span>${fmt(val)}</span>`);

            const reportRow = (label, value, bold = false, indent = false) => `
                <tr>
                    <td style="${indent ? 'padding-left: 30px;' : ''} ${bold ? 'font-weight: 700;' : ''}">${label}</td>
                    <td class="text-right" style="${bold ? 'font-weight: 700;' : ''}">${value === '' ? '' : fmtSign(value)}</td>
                </tr>`;
            const reportSubheader = (label) => `
                <tr style="background: rgba(99,102,241,0.08);">
                    <td colspan="2" style="font-weight: 700; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 10px 12px; color: var(--primary);">${label}</td>
                </tr>`;
            const reportDivider = () => `<tr><td colspan="2" style="border-top: 2px solid var(--border);"></td></tr>`;

            const wrapReport = (titleText, tableHtml) => `
                <div style="font-family: var(--font-sans, sans-serif);">
                    <div class="flex-between mb-4" style="flex-wrap: wrap; gap: 10px;">
                        <div>
                            <h4 class="m-0">${titleText}</h4>
                            <small class="text-muted">ICSS Command Center — Generated ${new Date().toLocaleString()}</small>
                        </div>
                        <button class="btn btn-sm btn-outline-primary" onclick="window.print()"><i class="fas fa-print mr-1"></i> Print / Save PDF</button>
                    </div>
                    <div class="table-responsive">
                        <table class="table" style="min-width: 420px;">
                            <tbody>${tableHtml}</tbody>
                        </table>
                    </div>
                </div>`;

            if (reportType === 'pnl') {
                const month = document.getElementById('pnlMonth').value;
                let url = `/api/accounting/reports/pnl?company_id=${currentCompanyId}`;
                if (month) { url += `&start=${month}-01&end=${month}-31`; }
                title.innerText = 'Profit & Loss';
                const d = await fetch(url).then(r => r.json());
                if (d.error) throw new Error(d.error);

                let rows = '';
                rows += reportSubheader('Revenue');
                (d.revenue?.accounts || []).forEach(a => { rows += reportRow(`${a.accountCode} — ${a.accountName}`, a.balance, false, true); });
                rows += reportDivider();
                rows += reportRow('Gross Revenue', d.revenue?.grossRevenue, true);
                if (d.revenue?.discounts > 0) rows += reportRow('Less: Discounts', -d.revenue.discounts, false, true);
                rows += reportRow('Net Revenue', d.revenue?.netRevenue, true);

                rows += reportSubheader('Operating Expenses');
                (d.expenses?.operating || []).forEach(a => { rows += reportRow(`${a.accountCode} — ${a.accountName}`, a.balance, false, true); });
                rows += reportDivider();
                rows += reportRow('Total Operating Expenses', d.expenses?.totalExpenses, true);

                rows += reportDivider();
                rows += reportRow('Operating Profit', d.summary?.operatingProfit, true);
                if (d.expenses?.taxExpenses > 0) {
                    rows += reportSubheader('Tax Expenses');
                    (d.expenses?.tax || []).forEach(a => { rows += reportRow(`${a.accountCode} — ${a.accountName}`, a.balance, false, true); });
                    rows += reportRow('Total Tax Expenses', d.expenses?.taxExpenses, true);
                }
                rows += reportDivider();
                rows += reportRow('NET PROFIT / (LOSS)', d.summary?.netProfit, true);

                const period = `${d.period?.start || ''} to ${d.period?.end || ''}`;
                content.innerHTML = wrapReport(`P&L Statement — ${period}`, rows);

            } else if (reportType === 'balance-sheet') {
                const asOf = document.getElementById('bsDate').value || new Date().toISOString().split('T')[0];
                const d = await fetch(`/api/accounting/reports/balance-sheet?company_id=${currentCompanyId}&asOf=${asOf}`).then(r => r.json());
                if (d.error) throw new Error(d.error);
                title.innerText = 'Balance Sheet';

                let rows = '';
                rows += reportSubheader('Assets');
                (d.assets?.accounts || []).forEach(a => { rows += reportRow(`${a.accountCode} — ${a.accountName}`, a.balance, false, true); });
                rows += reportDivider();
                rows += reportRow('TOTAL ASSETS', d.assets?.total, true);

                rows += reportSubheader('Liabilities');
                (d.liabilities?.accounts || []).forEach(a => { rows += reportRow(`${a.accountCode} — ${a.accountName}`, a.balance, false, true); });
                rows += reportDivider();
                rows += reportRow('TOTAL LIABILITIES', d.liabilities?.total, true);

                rows += reportSubheader('Equity');
                (d.equity?.accounts || []).forEach(a => { rows += reportRow(`${a.accountCode} — ${a.accountName}`, a.balance, false, true); });
                rows += reportRow('Retained Earnings', d.equity?.retainedEarnings, false, true);
                rows += reportDivider();
                rows += reportRow('TOTAL EQUITY', d.equity?.total, true);

                rows += reportDivider();
                const balanced = d.check?.balanced;
                rows += `<tr><td colspan="2" class="text-center py-2"><span class="badge ${balanced ? 'badge-success' : 'badge-danger'}">${balanced ? '✓ Balanced' : '⚠ Out of Balance by ' + fmt(d.check?.assetsMinusLiabilitiesMinusEquity)}</span></td></tr>`;

                content.innerHTML = wrapReport(`Balance Sheet as of ${asOf}`, rows);

            } else if (reportType === 'cash-flow') {
                const month = document.getElementById('cfMonth').value;
                let url = `/api/accounting/reports/cash-flow?company_id=${currentCompanyId}`;
                if (month) { url += `&start=${month}-01&end=${month}-31`; }
                title.innerText = 'Cash Flow';
                const d = await fetch(url).then(r => r.json());
                if (d.error) throw new Error(d.error);

                let rows = '';
                rows += reportSubheader('Operating Activities');
                rows += reportRow('Cash Inflows (Receipts)', d.operating?.cashIn, false, true);
                rows += reportRow('Cash Outflows (Payments)', -d.operating?.cashOut, false, true);
                rows += reportDivider();
                rows += reportRow('Net Operating Cash Flow', d.operating?.net, true);

                rows += reportSubheader('Investing Activities');
                rows += reportRow('Asset Purchases', -d.investing?.assetPurchases, false, true);
                rows += reportDivider();
                rows += reportRow('Net Investing Cash Flow', d.investing?.net, true);

                rows += reportSubheader('Financing Activities');
                rows += reportRow('Capital Injections', d.financing?.capitalInjections, false, true);
                rows += reportRow('Owner Drawings', -d.financing?.ownerDrawings, false, true);
                rows += reportDivider();
                rows += reportRow('Net Financing Cash Flow', d.financing?.net, true);

                rows += reportDivider();
                rows += reportRow('NET CASH MOVEMENT', d.netCashMovement, true);

                content.innerHTML = wrapReport(`Cash Flow — ${d.period?.start || ''} to ${d.period?.end || ''}`, rows);

            } else if (reportType === 'trial-balance') {
                title.innerText = 'Trial Balance';
                const accounts = await fetch(`/api/accounting/trial-balance?company_id=${currentCompanyId}&start=2000-01-01`).then(r => r.json());
                if (!Array.isArray(accounts)) throw new Error(accounts.error || 'Failed to load trial balance');

                const totalDr = accounts.reduce((s, a) => s + a.debits, 0);
                const totalCr = accounts.reduce((s, a) => s + a.credits, 0);

                const typeOrder = ['asset', 'liability', 'equity', 'revenue', 'expense'];
                const grouped = {};
                accounts.forEach(a => {
                    const t = a.accountType || 'other';
                    if (!grouped[t]) grouped[t] = [];
                    grouped[t].push(a);
                });

                let tableHtml = `
                    <div class="flex-between mb-4" style="flex-wrap:wrap; gap:10px;">
                        <div><h4 class="m-0">Trial Balance — All Time</h4><small class="text-muted">ICSS Command Center — Generated ${new Date().toLocaleString()}</small></div>
                        <button class="btn btn-sm btn-outline-primary" onclick="window.print()"><i class="fas fa-print mr-1"></i> Print / Save PDF</button>
                    </div>
                    <div class="table-responsive">
                    <table class="table" style="min-width: 500px;">
                        <thead><tr>
                            <th>Account</th>
                            <th>Type</th>
                            <th class="text-right">Debits</th>
                            <th class="text-right">Credits</th>
                            <th class="text-right">Balance</th>
                        </tr></thead><tbody>`;

                typeOrder.forEach(type => {
                    const accts = grouped[type];
                    if (!accts || accts.length === 0) return;
                    tableHtml += `<tr style="background: rgba(99,102,241,0.08);"><td colspan="5" style="font-weight:700; text-transform:uppercase; font-size:0.85rem; letter-spacing:0.05em; color:var(--primary);">${type}</td></tr>`;
                    accts.sort((a,b) => a.accountCode.localeCompare(b.accountCode)).forEach(a => {
                        tableHtml += `<tr>
                            <td style="padding-left:20px;">${a.accountCode} — ${a.accountName}</td>
                            <td><span class="badge badge-light">${a.accountType}</span></td>
                            <td class="text-right">${fmt(a.debits)}</td>
                            <td class="text-right">${fmt(a.credits)}</td>
                            <td class="text-right font-weight-bold">${fmt(a.balance)}</td>
                        </tr>`;
                    });
                });

                const balanced = Math.abs(totalDr - totalCr) < 1;
                tableHtml += `
                    <tr style="border-top: 2px solid var(--border); font-weight:700;">
                        <td colspan="2">TOTALS</td>
                        <td class="text-right">${fmt(totalDr)}</td>
                        <td class="text-right">${fmt(totalCr)}</td>
                        <td class="text-right"><span class="badge ${balanced ? 'badge-success' : 'badge-danger'}">${balanced ? '✓ Balanced' : '⚠ Unbalanced'}</span></td>
                    </tr>
                    </tbody></table></div>`;

                content.innerHTML = tableHtml;
            }

        } catch (err) {
            document.getElementById('reportViewerContent').innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle mr-2"></i>${err.message || 'Failed to generate report.'}</div>`;
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

                const dateStr = l.normalized.txn_date || (l.raw.source_fields && Object.values(l.raw.source_fields)[0]) || 'N/A';
                const descStr = l.normalized.description || (l.raw.source_fields && Object.values(l.raw.source_fields)[1]) || 'N/A';
                const amountStr = l.normalized.amount_signed !== undefined ? `${formatMoney(l.normalized.amount_signed)} ${l.normalized.currency || ''}` : 'N/A';

                let suggestionHtml = '<span class="text-muted">None</span>';
                if (l.suggested_account_id) {
                    const acc = accounts.find(a => a.id === l.suggested_account_id);
                    const accLabel = acc ? `${acc.code} - ${acc.name}` : l.suggested_account_id;
                    suggestionHtml = `<span class="badge badge-info">${accLabel}</span> <small class="text-muted">(${Math.round(l.suggestion_confidence * 100)}%)</small>`;
                }

                tr.innerHTML = `
                    <td data-label="Status" class="text-center">${statusIcon}</td>
                    <td data-label="Date">${dateStr}</td>
                    <td data-label="Description" title="${descStr}">${descStr.substring(0, 30)}${descStr.length > 30 ? '...' : ''}</td>
                    <td data-label="Amount" class="text-right">${amountStr}</td>
                    <td data-label="Suggested Category">${suggestionHtml}</td>
                    <td data-label="Override Category">
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
            ['asset-total-cost','asset-total-dep','asset-total-nbv','asset-count'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = '0'; });
            return;
        }

        const formatMoney = (val) => Number(val).toLocaleString('en-JM', { minimumFractionDigits: 2 });

        // API returns: assetName, category, purchaseDate, cost, accumulatedDepreciation, currentNBV, disposed
        data.assets.forEach(a => {
            tbody.innerHTML += `
                <tr>
                    <td><strong>${a.assetName}</strong></td>
                    <td><span class="badge badge-secondary">${(a.category || '').replace('_', ' ')}</span></td>
                    <td>${new Date(a.purchaseDate).toLocaleDateString()}</td>
                    <td class="text-right">${formatMoney(a.cost)}</td>
                    <td class="text-right text-danger">${formatMoney(a.accumulatedDepreciation || 0)}</td>
                    <td class="text-right font-weight-bold">${formatMoney(a.currentNBV)}</td>
                    <td class="text-center">
                        ${!a.disposed ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-secondary">Disposed</span>'}
                    </td>
                </tr>
            `;
        });

        // -- Populate Asset Summary KPIs --
        const totalCost = data.assets.reduce((s, a) => s + (a.cost || 0), 0);
        const totalDep = data.assets.reduce((s, a) => s + (a.accumulatedDepreciation || 0), 0);
        const totalNBV = data.assets.filter(a => !a.disposed).reduce((s, a) => s + (a.currentNBV || 0), 0);
        const activeCount = data.assets.filter(a => !a.disposed).length;

        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('asset-total-cost', formatMoney(totalCost));
        setEl('asset-total-dep', formatMoney(totalDep));
        setEl('asset-total-nbv', formatMoney(totalNBV));
        setEl('asset-count', activeCount);

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
