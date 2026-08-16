// Contracts admin page — list, create, send, and manage Project Service Agreements.

let allContracts = [];
let createdContract = null;
let currentDetailContract = null;
let paymentArrangementTouched = false;

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', signed: 'Signed', void: 'Void' };

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatMoney(amount, currency) {
    const n = Number(amount) || 0;
    return `${currency || 'JMD'} $${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value) {
    if (!value) return null;
    return new Date(value).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function signUrlFor(contract) {
    // The backend computes this (it accounts for APP_BASE_PATH deployments); this is only a
    // fallback in case an older cached row somehow lacks it.
    return contract.sign_url || `${window.location.origin}/sign-contract?token=${contract.sign_token}`;
}

function defaultPaymentArrangement(depositPercent) {
    const dp = Number(depositPercent) || 0;
    const bp = Math.max(0, 100 - dp);
    return `${dp}% deposit due before project work begins; the remaining ${bp}% balance is due upon completion of the project, before final delivery/transfer of the completed work.`;
}

// =============================================================================
// LOAD / RENDER LIST
// =============================================================================

async function loadContracts() {
    try {
        const res = await apiFetch('/api/contracts');
        if (res.ok) {
            allContracts = await res.json();
            filterTable();
            updateStats(allContracts);
        } else {
            document.getElementById('contractsTableBody').innerHTML = '<tr><td colspan="7" class="text-center">Failed to load contracts.</td></tr>';
        }
    } catch (e) {
        console.error('Failed to load contracts', e);
        document.getElementById('contractsTableBody').innerHTML = '<tr><td colspan="7" class="text-center">Failed to load contracts.</td></tr>';
    }
}

function updateStats(contracts) {
    document.getElementById('statTotal').innerText = contracts.length;
    document.getElementById('statDraft').innerText = contracts.filter(c => c.status === 'draft').length;
    document.getElementById('statAwaiting').innerText = contracts.filter(c => c.status === 'sent' || c.status === 'viewed').length;
    document.getElementById('statSigned').innerText = contracts.filter(c => c.status === 'signed').length;
}

function filterTable() {
    const status = document.getElementById('filterStatus').value;
    const filtered = status ? allContracts.filter(c => c.status === status) : allContracts;
    renderTable(filtered);
}

function renderTable(contracts) {
    const tbody = document.getElementById('contractsTableBody');
    tbody.innerHTML = '';

    if (contracts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No contracts yet. Click "New Contract" to create one.</td></tr>';
        return;
    }

    contracts.forEach(c => {
        const tr = document.createElement('tr');
        const created = new Date(c.created_at).toLocaleDateString();

        tr.innerHTML = `
            <td><strong>${escapeHTML(c.client_name)}</strong>${c.business_name ? `<br><small class="text-muted">${escapeHTML(c.business_name)}</small>` : ''}</td>
            <td>${escapeHTML(c.project_type || c.project_description || 'N/A')}</td>
            <td>${formatMoney(c.project_cost, c.currency)}</td>
            <td>${c.deposit_percent}%</td>
            <td><span class="status-${c.status}" style="text-transform:capitalize;">${escapeHTML(STATUS_LABELS[c.status] || c.status)}</span></td>
            <td>${created}</td>
            <td></td>
        `;

        const tdAction = tr.lastElementChild;
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline-light';
        btn.textContent = 'Manage';
        btn.onclick = () => openDetail(c.id);
        tdAction.appendChild(btn);

        tbody.appendChild(tr);
    });
}

// =============================================================================
// CREATE CONTRACT
// =============================================================================

function openCreateModal() {
    document.getElementById('createModalTitle').textContent = 'New Contract';
    ['cf_clientName', 'cf_businessName', 'cf_clientEmail', 'cf_clientPhone', 'cf_projectType', 'cf_projectDescription', 'cf_projectCost']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('cf_currency').value = 'JMD';
    document.getElementById('cf_depositPercent').value = 50;
    document.getElementById('cf_signerName').value = 'S. Baker';
    paymentArrangementTouched = false;
    document.getElementById('cf_paymentArrangement').value = defaultPaymentArrangement(50);

    document.getElementById('cf_depositPercent').oninput = () => {
        if (!paymentArrangementTouched) {
            document.getElementById('cf_paymentArrangement').value = defaultPaymentArrangement(document.getElementById('cf_depositPercent').value);
        }
    };
    document.getElementById('cf_paymentArrangement').oninput = () => { paymentArrangementTouched = true; };

    document.getElementById('createFormView').classList.remove('d-none');
    document.getElementById('createSuccessView').classList.add('d-none');
    document.getElementById('createFormFooter').classList.remove('d-none');
    document.getElementById('createFormFooter').style.display = 'flex';
    document.getElementById('createSuccessFooter').classList.add('d-none');
    document.getElementById('createSuccessFooter').style.display = 'none';

    createdContract = null;
    document.getElementById('contractModal').classList.remove('d-none');
}

function closeCreateModal() {
    document.getElementById('contractModal').classList.add('d-none');
    if (createdContract) loadContracts();
}

async function submitCreateContract() {
    const clientName = document.getElementById('cf_clientName').value.trim();
    const clientEmail = document.getElementById('cf_clientEmail').value.trim();
    const projectDescription = document.getElementById('cf_projectDescription').value.trim();
    const projectCost = document.getElementById('cf_projectCost').value;

    if (!clientName || !clientEmail || !projectDescription || projectCost === '') {
        return showAlert('Please fill in Client Name, Email, Project Description, and Estimated Cost.', 'error');
    }

    const payload = {
        client_name: clientName,
        business_name: document.getElementById('cf_businessName').value.trim() || null,
        client_email: clientEmail,
        client_phone: document.getElementById('cf_clientPhone').value.trim() || null,
        project_type: document.getElementById('cf_projectType').value.trim() || null,
        project_description: projectDescription,
        currency: document.getElementById('cf_currency').value,
        project_cost: Number(projectCost),
        deposit_percent: Number(document.getElementById('cf_depositPercent').value),
        payment_arrangement: document.getElementById('cf_paymentArrangement').value.trim(),
        company_signer_name: document.getElementById('cf_signerName').value.trim() || 'S. Baker'
    };

    const btn = document.getElementById('createSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
        const res = await apiFetch('/api/contracts', { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create contract');

        createdContract = data;
        document.getElementById('createdLinkInput').value = signUrlFor(data);

        document.getElementById('createFormView').classList.add('d-none');
        document.getElementById('createSuccessView').classList.remove('d-none');
        document.getElementById('createFormFooter').style.display = 'none';
        document.getElementById('createFormFooter').classList.add('d-none');
        document.getElementById('createSuccessFooter').classList.remove('d-none');
        document.getElementById('createSuccessFooter').style.display = 'flex';
        document.getElementById('sendNowBtn').disabled = false;
        document.getElementById('sendNowBtn').textContent = 'Send by Email Now';
    } catch (e) {
        showAlert(e.message || 'Failed to create contract', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Contract';
    }
}

function copyCreatedLink() {
    const input = document.getElementById('createdLinkInput');
    input.select();
    navigator.clipboard?.writeText(input.value).then(() => {
        showAlert('Link copied to clipboard.', 'success');
    }).catch(() => {
        showAlert('Could not copy automatically — the link is selected, press Ctrl+C.', 'info');
    });
}

async function sendCreatedContract() {
    if (!createdContract) return;
    const btn = document.getElementById('sendNowBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
        const res = await apiFetch(`/api/contracts/${createdContract.id}/send`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send');
        await showAlert(`Agreement emailed to ${createdContract.client_email}.`, 'success');
        closeCreateModal();
    } catch (e) {
        showAlert(e.message || 'Failed to send the agreement email.', 'error');
        btn.disabled = false;
        btn.textContent = 'Send by Email Now';
    }
}

// =============================================================================
// DETAIL / MANAGE
// =============================================================================

async function openDetail(id) {
    let contract = allContracts.find(c => c.id === id);
    try {
        const res = await apiFetch(`/api/contracts/${id}`);
        if (res.ok) contract = await res.json();
    } catch (e) { /* fall back to cached row */ }

    if (!contract) return showAlert('Contract not found.', 'error');
    currentDetailContract = contract;

    document.getElementById('detailModalTitle').textContent = contract.client_name;
    document.getElementById('detailBody').innerHTML = contract.status === 'draft' ? renderDraftEditForm(contract) : renderReadOnlyDetail(contract);

    if (contract.status === 'draft') {
        let detailArrangementTouched = false;
        document.getElementById('dd_depositPercent').oninput = () => {
            if (!detailArrangementTouched) {
                document.getElementById('dd_paymentArrangement').value = defaultPaymentArrangement(document.getElementById('dd_depositPercent').value);
            }
        };
        document.getElementById('dd_paymentArrangement').oninput = () => { detailArrangementTouched = true; };
    }

    document.getElementById('detailFooter').innerHTML = renderDetailFooter(contract);
    document.getElementById('detailModal').classList.remove('d-none');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.add('d-none');
    loadContracts();
}

function renderDraftEditForm(c) {
    return `
        <div class="section-title">Client Information</div>
        <div class="form-grid">
            <div><label>Client Full Name *</label><input type="text" id="dd_clientName" class="form-control" value="${escapeHTML(c.client_name)}"></div>
            <div><label>Business Name</label><input type="text" id="dd_businessName" class="form-control" value="${escapeHTML(c.business_name || '')}"></div>
            <div><label>Client Email *</label><input type="email" id="dd_clientEmail" class="form-control" value="${escapeHTML(c.client_email)}"></div>
            <div><label>Phone / WhatsApp</label><input type="text" id="dd_clientPhone" class="form-control" value="${escapeHTML(c.client_phone || '')}"></div>
        </div>
        <div class="section-title">Project Details</div>
        <div class="form-grid">
            <div><label>Project Type</label><input type="text" id="dd_projectType" class="form-control" value="${escapeHTML(c.project_type || '')}"></div>
            <div>
                <label>Currency</label>
                <select id="dd_currency" class="form-control">
                    <option value="JMD" ${c.currency === 'JMD' ? 'selected' : ''}>JMD</option>
                    <option value="USD" ${c.currency === 'USD' ? 'selected' : ''}>USD</option>
                </select>
            </div>
            <div style="grid-column: 1 / -1;"><label>Project Description *</label><textarea id="dd_projectDescription" class="form-control" rows="3">${escapeHTML(c.project_description || '')}</textarea></div>
        </div>
        <div class="section-title">Financials</div>
        <div class="form-grid">
            <div><label>Estimated Project Cost *</label><input type="number" id="dd_projectCost" class="form-control" min="0" step="0.01" value="${c.project_cost}"></div>
            <div><label>Deposit % *</label><input type="number" id="dd_depositPercent" class="form-control" min="0" max="100" step="1" value="${c.deposit_percent}"></div>
            <div style="grid-column: 1 / -1;"><label>Payment Arrangement</label><textarea id="dd_paymentArrangement" class="form-control" rows="3">${escapeHTML(c.payment_arrangement || '')}</textarea></div>
        </div>
        <div class="section-title">Company Signature (Applied Automatically)</div>
        <div class="form-grid">
            <div><label>Authorized Signer Name</label><input type="text" id="dd_signerName" class="form-control" value="${escapeHTML(c.company_signer_name || 'S. Baker')}"></div>
            <div><label>Signature on File</label><div class="signature-preview" style="padding:6px 10px;"><img src="assets/signature.png" style="max-height:40px;"></div></div>
        </div>
        <div class="link-box" style="margin-top: 10px;">
            <input type="text" readonly value="${signUrlFor(c)}">
            <button class="btn btn-sm btn-outline-light" onclick="copyLink('${signUrlFor(c)}')">Copy Link</button>
        </div>
    `;
}

function renderReadOnlyDetail(c) {
    const timelineParts = [];
    if (c.created_at) timelineParts.push(`<div class="timeline-item"><strong>Created</strong>${formatDateTime(c.created_at)}</div>`);
    if (c.sent_at) timelineParts.push(`<div class="timeline-item"><strong>Sent</strong>${formatDateTime(c.sent_at)}</div>`);
    if (c.viewed_at) timelineParts.push(`<div class="timeline-item"><strong>Viewed</strong>${formatDateTime(c.viewed_at)}</div>`);
    if (c.signed_at) timelineParts.push(`<div class="timeline-item"><strong>Signed</strong>${formatDateTime(c.signed_at)}</div>`);
    if (c.void_at) timelineParts.push(`<div class="timeline-item"><strong>Voided</strong>${formatDateTime(c.void_at)}</div>`);

    let signatureBlock = '';
    if (c.status === 'signed') {
        const sigContent = (c.signature_type === 'drawn' && c.signature_data)
            ? `<div class="signature-preview"><img src="${c.signature_data}" alt="Client signature"></div>`
            : `<div class="signature-typed">${escapeHTML(c.signature_data || c.signer_legal_name || '')}</div>`;
        signatureBlock = `
            <div class="section-title">Client Signature</div>
            ${sigContent}
            <div class="detail-grid" style="margin-top: 14px;">
                <div><div class="detail-label">Signed By</div><div class="detail-value">${escapeHTML(c.signer_legal_name || c.client_name)}</div></div>
                <div><div class="detail-label">IP Address</div><div class="detail-value">${escapeHTML(c.signer_ip || 'N/A')}</div></div>
            </div>
        `;
    }

    return `
        <div class="timeline">${timelineParts.join('')}</div>
        <div class="detail-grid">
            <div><div class="detail-label">Client</div><div class="detail-value">${escapeHTML(c.client_name)}</div></div>
            <div><div class="detail-label">Business</div><div class="detail-value">${escapeHTML(c.business_name || 'N/A')}</div></div>
            <div><div class="detail-label">Email</div><div class="detail-value">${escapeHTML(c.client_email)}</div></div>
            <div><div class="detail-label">Phone</div><div class="detail-value">${escapeHTML(c.client_phone || 'N/A')}</div></div>
            <div><div class="detail-label">Project Type</div><div class="detail-value">${escapeHTML(c.project_type || 'N/A')}</div></div>
            <div><div class="detail-label">Reference</div><div class="detail-value">${escapeHTML(c.agreement_reference || 'N/A')}</div></div>
            <div class="full"><div class="detail-label">Description</div><div class="detail-value">${escapeHTML(c.project_description || 'N/A')}</div></div>
            <div><div class="detail-label">Estimated Cost</div><div class="detail-value">${formatMoney(c.project_cost, c.currency)}</div></div>
            <div><div class="detail-label">Deposit</div><div class="detail-value">${c.deposit_percent}% (${formatMoney(c.project_cost * c.deposit_percent / 100, c.currency)})</div></div>
            <div class="full"><div class="detail-label">Payment Arrangement</div><div class="detail-value">${escapeHTML(c.payment_arrangement || 'N/A')}</div></div>
            <div><div class="detail-label">Company Signer</div><div class="detail-value">${escapeHTML(c.company_signer_name || 'S. Baker')}</div></div>
        </div>
        ${signatureBlock}
        ${c.status !== 'void' && c.status !== 'signed' ? `
        <div class="link-box">
            <input type="text" readonly value="${signUrlFor(c)}">
            <button class="btn btn-sm btn-outline-light" onclick="copyLink('${signUrlFor(c)}')">Copy Link</button>
        </div>` : ''}
    `;
}

function renderDetailFooter(c) {
    if (c.status === 'draft') {
        return `
            <button class="btn btn-outline-light" style="color:#ff4757; border-color:#ff4757;" onclick="deleteContract('${c.id}', 'draft')">Delete Draft</button>
            <div style="display:flex; gap:10px;">
                <button class="btn btn-secondary" onclick="saveDraft('${c.id}')">Save Changes</button>
                <button class="btn btn-primary" onclick="sendDraft('${c.id}')">Send Agreement</button>
            </div>
        `;
    }
    if (c.status === 'sent' || c.status === 'viewed') {
        return `
            <div style="display:flex; gap:10px;">
                <button class="btn btn-outline-light" style="color:#ffa502; border-color:#ffa502;" onclick="deleteContract('${c.id}', '${c.status}', false)">Void</button>
                <button class="btn btn-outline-light" style="color:#ff4757; border-color:#ff4757;" onclick="deleteContract('${c.id}', '${c.status}', true)">Delete Permanently</button>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn btn-secondary" onclick="viewPdf('${c.id}')">Preview PDF</button>
                <button class="btn btn-primary" onclick="resendContract('${c.id}')">Resend Email</button>
            </div>
        `;
    }
    if (c.status === 'signed') {
        return `
            <button class="btn btn-outline-light" style="color:#ff4757; border-color:#ff4757;" onclick="deleteContract('${c.id}', 'signed', true)">Delete Permanently</button>
            <button class="btn btn-primary" onclick="viewPdf('${c.id}')">Download Signed PDF</button>
        `;
    }
    if (c.status === 'void') {
        return `
            <button class="btn btn-outline-light" style="color:#ff4757; border-color:#ff4757;" onclick="deleteContract('${c.id}', 'void', true)">Delete Permanently</button>
            <button class="btn btn-secondary" onclick="closeDetailModal()">Close</button>
        `;
    }
    return `<div></div><button class="btn btn-secondary" onclick="closeDetailModal()">Close</button>`;
}

function collectDraftFormValues() {
    return {
        client_name: document.getElementById('dd_clientName').value.trim(),
        business_name: document.getElementById('dd_businessName').value.trim() || null,
        client_email: document.getElementById('dd_clientEmail').value.trim(),
        client_phone: document.getElementById('dd_clientPhone').value.trim() || null,
        project_type: document.getElementById('dd_projectType').value.trim() || null,
        project_description: document.getElementById('dd_projectDescription').value.trim(),
        currency: document.getElementById('dd_currency').value,
        project_cost: Number(document.getElementById('dd_projectCost').value),
        deposit_percent: Number(document.getElementById('dd_depositPercent').value),
        payment_arrangement: document.getElementById('dd_paymentArrangement').value.trim(),
        company_signer_name: document.getElementById('dd_signerName').value.trim() || 'S. Baker'
    };
}

async function saveDraft(id, { silent = false } = {}) {
    const payload = collectDraftFormValues();
    if (!payload.client_name || !payload.client_email || !payload.project_description) {
        showAlert('Please fill in Client Name, Email, and Project Description.', 'error');
        return false;
    }
    try {
        const res = await apiFetch(`/api/contracts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save changes');
        if (!silent) await showAlert('Changes saved.', 'success');
        return true;
    } catch (e) {
        showAlert(e.message || 'Failed to save changes', 'error');
        return false;
    }
}

async function sendDraft(id) {
    const saved = await saveDraft(id, { silent: true });
    if (!saved) return;
    try {
        const res = await apiFetch(`/api/contracts/${id}/send`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send');
        await showAlert('Agreement emailed to the client.', 'success');
        closeDetailModal();
    } catch (e) {
        showAlert(e.message || 'Failed to send the agreement email.', 'error');
    }
}

async function resendContract(id) {
    const confirmed = (typeof showConfirm === 'function')
        ? await showConfirm('Resend the signing link to this client by email?', 'info', 'Resend')
        : confirm('Resend the signing link to this client by email?');
    if (!confirmed) return;
    try {
        const res = await apiFetch(`/api/contracts/${id}/send`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to resend');
        await showAlert('Agreement resent.', 'success');
        closeDetailModal();
    } catch (e) {
        showAlert(e.message || 'Failed to resend the agreement email.', 'error');
    }
}

async function deleteContract(id, status, permanent = false) {
    const isDraft = status === 'draft';
    let message, confirmText;

    if (isDraft) {
        message = 'Delete this draft contract? This cannot be undone.';
        confirmText = 'Delete';
    } else if (status === 'signed' && permanent) {
        message = 'Permanently delete this SIGNED agreement? This is a legal record of the client\'s electronic signature — deleting it removes all proof they signed, including their signature and audit trail. This cannot be undone.';
        confirmText = 'Delete Permanently';
    } else if (permanent) {
        message = 'Permanently delete this contract? This removes it entirely, including the signing link and all its data. This cannot be undone.';
        confirmText = 'Delete Permanently';
    } else {
        message = 'Void this agreement? The client\'s signing link will stop working, but the record is kept for your files.';
        confirmText = 'Void';
    }

    const confirmed = (typeof showConfirm === 'function')
        ? await showConfirm(message, 'danger', confirmText)
        : confirm(message);
    if (!confirmed) return;
    try {
        const url = `/api/contracts/${id}${permanent ? '?permanent=true' : ''}`;
        const res = await apiFetch(url, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to remove contract');
        closeDetailModal();
    } catch (e) {
        showAlert(e.message || 'Failed to remove contract', 'error');
    }
}

function copyLink(url) {
    navigator.clipboard?.writeText(url).then(() => {
        showAlert('Link copied to clipboard.', 'success');
    }).catch(() => {
        showAlert(url, 'info', 'Signing Link');
    });
}

async function viewPdf(id) {
    try {
        const res = await apiFetch(`/api/contracts/${id}/pdf`);
        if (!res.ok) { showAlert('Failed to generate PDF.', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    } catch (e) {
        showAlert('Failed to load PDF.', 'error');
    }
}

// Init
loadContracts();
