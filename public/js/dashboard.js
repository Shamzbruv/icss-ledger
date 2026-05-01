document.addEventListener('DOMContentLoaded', async () => {
    await loadRecentActivity();
});

async function loadRecentActivity() {
    const placeholder = document.getElementById('recentActivityPlaceholder');
    if (!placeholder) return;

    try {
        placeholder.innerHTML = '<p>Loading recent activity...</p>';
        const res = await apiFetch('/api/dashboard/recent-activity');

        if (!res.ok) {
            throw new Error(`Failed to fetch: ${res.statusText}`);
        }

        const activities = await res.json();

        if (activities.length === 0) {
            placeholder.innerHTML = '<p>No recent activity logs available yet.</p>';
            return;
        }

        // Build Table
        let tableHTML = `
            <div class="table-responsive" style="margin-bottom: 0; border: none;">
                <table class="table-mobile-cards" style="margin-top: 0; width: 100%;">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Description</th>
                            <th>Amount / Status</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        activities.forEach(act => {
            const dateStr = new Date(act.date).toLocaleDateString();

            // Format Type Badge
            let typeBadgeClass = 'bg-secondary';
            let typeDisplay = act.type.toUpperCase();
            if (act.type === 'invoice') {
                // Secondary color in style.css is Cyan/Teal
                typeBadgeClass = '';
                typeDisplay = `<span style="color: var(--secondary-color); font-weight: 600;">INVOICE</span>`;
            } else if (act.type === 'accounting') {
                typeBadgeClass = '';
                typeDisplay = `<span style="color: var(--accent-color); font-weight: 600;">ACCOUNTING</span>`;
            } else if (act.type === 'client_care') {
                typeBadgeClass = '';
                typeDisplay = `<span style="color: var(--success-color); font-weight: 600;">CLIENT CARE</span>`;
            } else {
                typeDisplay = `<span class="badge bg-secondary">${typeDisplay}</span>`;
            }

            // Format Status/Amount
            let amountStatus = '';
            if (act.amount !== null && act.amount !== undefined) {
                amountStatus = `<strong>$${Number(act.amount).toFixed(2)}</strong>`;
                if (act.status) {
                    let statusClass = 'bg-secondary';
                    if (act.status === 'PAID') statusClass = 'bg-success';
                    else if (act.status === 'UNPAID') statusClass = 'bg-danger';
                    else if (act.status === 'PARTIAL') statusClass = 'bg-warning';
                    amountStatus += `<br><span class="badge ${statusClass}" style="margin-top: 4px; display: inline-block;">${act.status}</span>`;
                }
            } else {
                let statusClass = 'bg-secondary';
                if (act.status === 'ACTIVE') statusClass = 'bg-success';
                else if (act.status === 'INACTIVE') statusClass = 'bg-danger';
                amountStatus = `<span class="badge ${statusClass}">${act.status || 'N/A'}</span>`;
            }

            tableHTML += `
                <tr>
                    <td data-label="Date">${dateStr}</td>
                    <td data-label="Type">${typeDisplay}</td>
                    <td data-label="Description">
                        <strong style="color: #fff;">${act.title}</strong><br>
                        <small class="text-muted">${act.description}</small>
                    </td>
                    <td data-label="Amount / Status">${amountStatus}</td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;

        // Apply HTML and remove placeholder padding for edge-to-edge table look inside card
        placeholder.innerHTML = tableHTML;
        placeholder.style.padding = '0';

    } catch (err) {
        console.error('Error loading recent activity:', err);
        placeholder.innerHTML = '<p class="text-danger">Failed to load recent activity.</p>';
    }
}
