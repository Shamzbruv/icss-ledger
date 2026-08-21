document.addEventListener('DOMContentLoaded', async () => {
    const [overviewResult] = await Promise.allSettled([loadOverview(), loadRecentActivity()]);
    if (overviewResult.status === 'rejected') {
        console.error(overviewResult.reason);
        document.getElementById('attentionFeed').innerHTML = '<div class="all-clear"><i class="fas fa-triangle-exclamation"></i><div><strong>Overview unavailable</strong><span>Refresh the page to try again.</span></div></div>';
    }
});

const escapeDashboardHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function relativeDate(value) {
    if (!value) return 'No date';
    const date = new Date(value);
    const days = Math.round((date - new Date()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 1 && days < 7) return `In ${days} days`;
    if (days < -1 && days > -7) return `${Math.abs(days)} days ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function loadOverview() {
    const response = await apiFetch('/api/dashboard/overview');
    const overview = await response.json();
    if (!response.ok) throw new Error(overview.error || 'Dashboard overview failed');
    const metrics = overview.metrics || {};
    const bindings = {
        metricContracts: metrics.pendingContracts,
        metricReports: metrics.upcomingReports,
        metricReviews: metrics.pendingReviews,
        metricInvoices: metrics.overdueInvoices,
        metricLeads: metrics.openLeads,
        metricSent: metrics.reportsSent30d
    };
    Object.entries(bindings).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = Number(value || 0).toLocaleString();
    });
    document.getElementById('dashboardTimestamp').textContent = `Updated ${new Date(overview.generatedAt).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })} · Here is what needs attention.`;

    const feed = document.getElementById('attentionFeed');
    const alerts = overview.alerts || [];
    document.getElementById('attentionCount').textContent = `${alerts.length} item${alerts.length === 1 ? '' : 's'}`;
    if (!alerts.length) {
        feed.innerHTML = '<div class="all-clear"><i class="fas fa-circle-check"></i><div><strong>You are all caught up</strong><span>No urgent signatures, reports, reviews, or overdue invoices.</span></div></div>';
        return;
    }
    const icons = { contract: 'fa-file-signature', report: 'fa-heart-pulse', review: 'fa-star', invoice: 'fa-file-invoice-dollar' };
    feed.innerHTML = alerts.map(alert => `
        <a class="attention-item" href="${escapeDashboardHtml(alert.href)}">
            <span class="attention-type ${escapeDashboardHtml(alert.type)}"><i class="fas ${icons[alert.type] || 'fa-bell'}"></i></span>
            <span class="attention-copy"><strong>${escapeDashboardHtml(alert.title)}</strong><small>${escapeDashboardHtml(alert.detail)}</small></span>
            <span class="attention-date">${escapeDashboardHtml(relativeDate(alert.date))}</span>
            <i class="fas fa-chevron-right attention-arrow"></i>
        </a>`).join('');
}

async function loadRecentActivity() {
    const placeholder = document.getElementById('recentActivityPlaceholder');
    try {
        const response = await apiFetch('/api/dashboard/recent-activity');
        const activities = await response.json();
        if (!response.ok) throw new Error(activities.error || 'Recent activity failed');
        if (!activities.length) {
            placeholder.innerHTML = '<div class="all-clear"><i class="fas fa-wave-square"></i><div><strong>No activity yet</strong><span>New invoices, ledger entries, and Client Care events will appear here.</span></div></div>';
            return;
        }
        const iconMap = { invoice: 'fa-file-invoice', accounting: 'fa-chart-line', client_care: 'fa-heart-pulse' };
        placeholder.classList.remove('dashboard-loading', 'text-center');
        placeholder.innerHTML = `<div class="activity-list">${activities.map(activity => `
            <div class="activity-row">
                <span class="activity-icon ${escapeDashboardHtml(activity.type)}"><i class="fas ${iconMap[activity.type] || 'fa-wave-square'}"></i></span>
                <span class="activity-copy"><strong>${escapeDashboardHtml(activity.title)}</strong><small>${escapeDashboardHtml(activity.description)}</small></span>
                <span class="activity-meta">${activity.amount !== null && activity.amount !== undefined ? `${escapeDashboardHtml(activity.currency || 'JMD')} ${Number(activity.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : escapeDashboardHtml(activity.status || '')}<small>${escapeDashboardHtml(relativeDate(activity.date))}</small></span>
            </div>`).join('')}</div>`;
    } catch (error) {
        console.error(error);
        placeholder.innerHTML = '<p class="text-danger">Dashboard activity could not be loaded.</p>';
    }
}
