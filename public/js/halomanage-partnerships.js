// HaloManage Partner Contracts admin page — list, create, send, and manage revenue-share
// partnership agreements. Mirrors public/js/contracts.js's structure/behavior; the
// difference is the data shape (partner/revenue fields instead of client/project fields)
// and a template picker (role selection) as the first step of creating a contract.

let allContracts = [];
let allTemplates = [];
let createdContract = null;
let currentDetailContract = null;
let selectedTemplateId = null;

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', signed: 'Signed', void: 'Void' };

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDateTime(value) {
    if (!value) return null;
    return new Date(value).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function signUrlFor(contract) {
    // The backend computes this (it accounts for APP_BASE_PATH deployments); this is only a
    // fallback in case an older cached row somehow lacks it.
    return contract.sign_url || `${window.location.origin}/sign-partner-contract?token=${contract.sign_token}`;
}

function templateFor(id) {
    return allTemplates.find((t) => t.id === id) || null;
}

function templateLabel(id) {
    const t = templateFor(id);
    return t ? t.shortTitle : id;
}

// =============================================================================
// TEMPLATES
// =============================================================================

async function loadTemplates() {
    if (allTemplates.length) return allTemplates;
    try {
        const res = await apiFetch('/api/partner-contracts/templates');
        if (res.ok) allTemplates = await res.json();
    } catch (e) {
        console.error('Failed to load partner contract templates', e);
    }
    return allTemplates;
}

function renderTemplateGrid() {
    const grid = document.getElementById('templateGrid');
    grid.innerHTML = allTemplates.map((t) => `
        <button type="button" class="hm-template-card${t.id === selectedTemplateId ? ' active' : ''}" data-template-id="${escapeHTML(t.id)}">
            <strong>${escapeHTML(t.shortTitle)}</strong>
            <small>${escapeHTML(t.summary)}</small>
            <span class="hm-tag">${escapeHTML(t.tag)}</span>
        </button>
    `).join('');
    grid.querySelectorAll('.hm-template-card').forEach((btn) => {
        btn.addEventListener('click', () => selectTemplate(btn.getAttribute('data-template-id')));
    });
}

function selectTemplate(id) {
    selectedTemplateId = id;
    const t = templateFor(id);
    if (!t) return;

    document.getElementById('cf_term').value = t.term;
    document.getElementById('cf_revenueScope').value = t.scope;
    document.getElementById('cf_tailPeriod').value = t.tail;
    document.getElementById('relationshipTypeWrap').style.display = t.supportsFormal ? '' : 'none';
    if (!t.supportsFormal) document.getElementById('cf_relationshipType').value = 'commercial';

    renderTemplateGrid();
}

// =============================================================================
// LOAD / RENDER LIST
// =============================================================================

async function loadContracts() {
    try {
        await loadTemplates();
        const res = await apiFetch('/api/partner-contracts');
        if (res.ok) {
            allContracts = await res.json();
            filterTable();
            updateStats(allContracts);
        } else {
            let serverMessage = '';
            try { serverMessage = (await res.json()).error || ''; } catch (parseErr) { /* body wasn't JSON */ }
            console.error(`Failed to load partner contracts — HTTP ${res.status}: ${serverMessage}`);
            const detail = serverMessage ? escapeHTML(serverMessage) : `HTTP ${res.status}`;
            document.getElementById('contractsTableBody').innerHTML = `<tr><td colspan="6" class="text-center">Failed to load partner contracts — ${detail}</td></tr>`;
        }
    } catch (e) {
        console.error('Failed to load partner contracts', e);
        document.getElementById('contractsTableBody').innerHTML = '<tr><td colspan="6" class="text-center">Failed to load partner contracts (network error).</td></tr>';
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
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No partner contracts yet. Click "New Partner Contract" to create one.</td></tr>';
        return;
    }

    contracts.forEach(c => {
        const tr = document.createElement('tr');
        const created = new Date(c.created_at).toLocaleDateString();

        tr.innerHTML = `
            <td><strong>${escapeHTML(c.partner_name)}</strong><br><small class="text-muted">${escapeHTML(c.partner_email)}</small></td>
            <td>${escapeHTML(templateLabel(c.template_id))}</td>
            <td>${Number(c.revenue_share_percent ?? 0)}%</td>
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

async function openCreateModal() {
    document.getElementById('createModalTitle').textContent = 'New Partner Contract';
    await loadTemplates();

    ['cf_partnerName', 'cf_partnerEmail', 'cf_partnerPhone', 'cf_partnerAddress', 'cf_additionalDuties']
        .forEach(id => { document.getElementById(id).value = ''; });

    document.getElementById('cf_companyName').value = 'iCreate Solutions & Services';
    document.getElementById('cf_productName').value = 'HaloManage';
    document.getElementById('cf_effectiveDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cf_revenueShare').value = 10;
    document.getElementById('cf_paymentFrequency').value = 'Monthly';
    document.getElementById('cf_paymentDueDays').value = 10;
    document.getElementById('cf_terminationNotice').value = 14;
    document.getElementById('cf_expenseApproval').value = 'JMD $25,000';
    document.getElementById('cf_relationshipType').value = 'commercial';
    document.getElementById('cf_signerName').value = 'S. Baker';

    selectedTemplateId = allTemplates.length ? allTemplates[0].id : null;
    renderTemplateGrid();
    if (selectedTemplateId) selectTemplate(selectedTemplateId);

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
    const partnerName = document.getElementById('cf_partnerName').value.trim();
    const partnerEmail = document.getElementById('cf_partnerEmail').value.trim();

    if (!selectedTemplateId) return showAlert('Please choose a role / template.', 'error');
    if (!partnerName || !partnerEmail) {
        return showAlert('Please fill in the Partner Full Legal Name and Partner Email.', 'error');
    }

    const payload = {
        template_id: selectedTemplateId,
        company_name: document.getElementById('cf_companyName').value.trim() || 'iCreate Solutions & Services',
        product_name: document.getElementById('cf_productName').value.trim() || 'HaloManage',
        partner_name: partnerName,
        partner_email: partnerEmail,
        partner_phone: document.getElementById('cf_partnerPhone').value.trim() || null,
        partner_address: document.getElementById('cf_partnerAddress').value.trim() || null,
        effective_date: document.getElementById('cf_effectiveDate').value || null,
        term_text: document.getElementById('cf_term').value.trim() || null,
        revenue_share_percent: Number(document.getElementById('cf_revenueShare').value),
        payment_frequency: document.getElementById('cf_paymentFrequency').value,
        revenue_scope: document.getElementById('cf_revenueScope').value.trim() || null,
        payment_due_days: Number(document.getElementById('cf_paymentDueDays').value),
        termination_notice_days: Number(document.getElementById('cf_terminationNotice').value),
        expense_approval_threshold: document.getElementById('cf_expenseApproval').value.trim() || 'JMD $25,000',
        tail_period_text: document.getElementById('cf_tailPeriod').value.trim() || '90 days',
        relationship_type: document.getElementById('cf_relationshipType').value,
        additional_duties: document.getElementById('cf_additionalDuties').value.trim() || null,
        company_signer_name: document.getElementById('cf_signerName').value.trim() || 'S. Baker'
    };

    const btn = document.getElementById('createSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
        const res = await apiFetch('/api/partner-contracts', { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create partner contract');

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
        showAlert(e.message || 'Failed to create partner contract', 'error');
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
        const res = await apiFetch(`/api/partner-contracts/${createdContract.id}/send`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send');
        await showAlert(`Agreement emailed to ${createdContract.partner_email}.`, 'success');
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
        const res = await apiFetch(`/api/partner-contracts/${id}`);
        if (res.ok) contract = await res.json();
    } catch (e) { /* fall back to cached row */ }

    if (!contract) return showAlert('Partner contract not found.', 'error');
    currentDetailContract = contract;

    document.getElementById('detailModalTitle').textContent = contract.partner_name;
    document.getElementById('detailBody').innerHTML = contract.status === 'draft' ? renderDraftEditForm(contract) : renderReadOnlyDetail(contract);

    if (contract.status === 'draft') {
        const t = templateFor(contract.template_id);
        document.getElementById('dd_relationshipTypeWrap').style.display = (t && t.supportsFormal) ? '' : 'none';
    }

    document.getElementById('detailFooter').innerHTML = renderDetailFooter(contract);
    document.getElementById('detailModal').classList.remove('d-none');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.add('d-none');
    loadContracts();
}

function templateOptionsHtml(selectedId) {
    return allTemplates.map((t) => `<option value="${escapeHTML(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${escapeHTML(t.shortTitle)}</option>`).join('');
}

function renderDraftEditForm(c) {
    return `
        <div class="section-title">Role / Template</div>
        <div class="form-grid">
            <div class="full" style="grid-column: 1 / -1;">
                <label>Role *</label>
                <select id="dd_templateId" class="form-control">${templateOptionsHtml(c.template_id)}</select>
                <div class="helper-text">Changing the role changes the duties and role-specific clauses generated for this agreement.</div>
            </div>
        </div>
        <div class="section-title">Partner Information</div>
        <div class="form-grid">
            <div><label>Partner Full Legal Name *</label><input type="text" id="dd_partnerName" class="form-control" value="${escapeHTML(c.partner_name)}"></div>
            <div><label>Partner Email *</label><input type="email" id="dd_partnerEmail" class="form-control" value="${escapeHTML(c.partner_email)}"></div>
            <div><label>Phone / WhatsApp</label><input type="text" id="dd_partnerPhone" class="form-control" value="${escapeHTML(c.partner_phone || '')}"></div>
            <div><label>Effective Date</label><input type="date" id="dd_effectiveDate" class="form-control" value="${c.effective_date ? String(c.effective_date).slice(0,10) : ''}"></div>
            <div class="full" style="grid-column: 1 / -1;"><label>Partner Address</label><input type="text" id="dd_partnerAddress" class="form-control" value="${escapeHTML(c.partner_address || '')}"></div>
        </div>
        <div class="section-title">Commercial Terms</div>
        <div class="form-grid">
            <div><label>Term</label><input type="text" id="dd_term" class="form-control" value="${escapeHTML(c.term_text || '')}"></div>
            <div><label>Revenue Share %</label><input type="number" id="dd_revenueShare" class="form-control" min="0" max="100" step="0.25" value="${c.revenue_share_percent}"></div>
            <div>
                <label>Payment Frequency</label>
                <select id="dd_paymentFrequency" class="form-control">
                    ${['Monthly', 'Quarterly', 'Per completed client payment cycle', 'Other as stated in Schedule A'].map(o => `<option ${c.payment_frequency === o ? 'selected' : ''}>${o}</option>`).join('')}
                </select>
            </div>
            <div><label>Payment Due (business days)</label><input type="number" id="dd_paymentDueDays" class="form-control" min="1" value="${c.payment_due_days}"></div>
            <div class="full" style="grid-column: 1 / -1;"><label>Revenue-Share Scope</label><textarea id="dd_revenueScope" class="form-control" rows="2">${escapeHTML(c.revenue_scope || '')}</textarea></div>
            <div><label>Termination Notice (days)</label><input type="number" id="dd_terminationNotice" class="form-control" min="0" value="${c.termination_notice_days}"></div>
            <div><label>Expense Approval Threshold</label><input type="text" id="dd_expenseApproval" class="form-control" value="${escapeHTML(c.expense_approval_threshold || '')}"></div>
            <div><label>Post-Termination Revenue Tail</label><input type="text" id="dd_tailPeriod" class="form-control" value="${escapeHTML(c.tail_period_text || '')}"></div>
            <div class="full" id="dd_relationshipTypeWrap" style="grid-column: 1 / -1;">
                <label>Legal Relationship</label>
                <select id="dd_relationshipType" class="form-control">
                    <option value="commercial" ${c.relationship_type !== 'formal' ? 'selected' : ''}>Commercial revenue-share partner — no equity or legal partnership by default</option>
                    <option value="formal" ${c.relationship_type === 'formal' ? 'selected' : ''}>Formal general partnership — ownership / partnership status intended</option>
                </select>
            </div>
            <div class="full" style="grid-column: 1 / -1;"><label>Additional Duties / Limits</label><textarea id="dd_additionalDuties" class="form-control" rows="3">${escapeHTML(c.additional_duties || '')}</textarea></div>
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
            ? `<div class="signature-preview"><img src="${c.signature_data}" alt="Partner signature"></div>`
            : `<div class="signature-typed">${escapeHTML(c.signature_data || c.signer_legal_name || '')}</div>`;
        signatureBlock = `
            <div class="section-title">Partner Signature</div>
            ${sigContent}
            <div class="detail-grid" style="margin-top: 14px;">
                <div><div class="detail-label">Signed By</div><div class="detail-value">${escapeHTML(c.signer_legal_name || c.partner_name)}</div></div>
                <div><div class="detail-label">IP Address</div><div class="detail-value">${escapeHTML(c.signer_ip || 'N/A')}</div></div>
            </div>
        `;
    }

    return `
        <div class="timeline">${timelineParts.join('')}</div>
        <div class="detail-grid">
            <div><div class="detail-label">Partner</div><div class="detail-value">${escapeHTML(c.partner_name)}</div></div>
            <div><div class="detail-label">Email</div><div class="detail-value">${escapeHTML(c.partner_email)}</div></div>
            <div><div class="detail-label">Phone</div><div class="detail-value">${escapeHTML(c.partner_phone || 'N/A')}</div></div>
            <div><div class="detail-label">Role</div><div class="detail-value">${escapeHTML(templateLabel(c.template_id))}</div></div>
            <div><div class="detail-label">Reference</div><div class="detail-value">${escapeHTML(c.agreement_reference || 'N/A')}</div></div>
            <div><div class="detail-label">Revenue Share</div><div class="detail-value">${Number(c.revenue_share_percent ?? 0)}%</div></div>
            <div><div class="detail-label">Payment Frequency</div><div class="detail-value">${escapeHTML(c.payment_frequency || 'N/A')}</div></div>
            <div><div class="detail-label">Term</div><div class="detail-value">${escapeHTML(c.term_text || 'N/A')}</div></div>
            <div class="full"><div class="detail-label">Revenue-Share Scope</div><div class="detail-value">${escapeHTML(c.revenue_scope || 'N/A')}</div></div>
            <div><div class="detail-label">Legal Relationship</div><div class="detail-value">${c.relationship_type === 'formal' ? 'Formal general partnership' : 'Commercial revenue-share collaborator'}</div></div>
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
        template_id: document.getElementById('dd_templateId').value,
        partner_name: document.getElementById('dd_partnerName').value.trim(),
        partner_email: document.getElementById('dd_partnerEmail').value.trim(),
        partner_phone: document.getElementById('dd_partnerPhone').value.trim() || null,
        partner_address: document.getElementById('dd_partnerAddress').value.trim() || null,
        effective_date: document.getElementById('dd_effectiveDate').value || null,
        term_text: document.getElementById('dd_term').value.trim() || null,
        revenue_share_percent: Number(document.getElementById('dd_revenueShare').value),
        payment_frequency: document.getElementById('dd_paymentFrequency').value,
        revenue_scope: document.getElementById('dd_revenueScope').value.trim() || null,
        payment_due_days: Number(document.getElementById('dd_paymentDueDays').value),
        termination_notice_days: Number(document.getElementById('dd_terminationNotice').value),
        expense_approval_threshold: document.getElementById('dd_expenseApproval').value.trim() || 'JMD $25,000',
        tail_period_text: document.getElementById('dd_tailPeriod').value.trim() || '90 days',
        relationship_type: document.getElementById('dd_relationshipType').value,
        additional_duties: document.getElementById('dd_additionalDuties').value.trim() || null,
        company_signer_name: document.getElementById('dd_signerName').value.trim() || 'S. Baker'
    };
}

async function saveDraft(id, { silent = false } = {}) {
    const payload = collectDraftFormValues();
    if (!payload.partner_name || !payload.partner_email) {
        showAlert('Please fill in Partner Name and Partner Email.', 'error');
        return false;
    }
    try {
        const res = await apiFetch(`/api/partner-contracts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
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
        const res = await apiFetch(`/api/partner-contracts/${id}/send`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send');
        await showAlert('Agreement emailed to the partner.', 'success');
        closeDetailModal();
    } catch (e) {
        showAlert(e.message || 'Failed to send the agreement email.', 'error');
    }
}

async function resendContract(id) {
    const confirmed = (typeof showConfirm === 'function')
        ? await showConfirm('Resend the signing link to this partner by email?', 'info', 'Resend')
        : confirm('Resend the signing link to this partner by email?');
    if (!confirmed) return;
    try {
        const res = await apiFetch(`/api/partner-contracts/${id}/send`, { method: 'POST' });
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
        message = 'Delete this draft partner contract? This cannot be undone.';
        confirmText = 'Delete';
    } else if (status === 'signed' && permanent) {
        message = 'Permanently delete this SIGNED agreement? This is a legal record of the partner\'s electronic signature — deleting it removes all proof they signed, including their signature and audit trail. This cannot be undone.';
        confirmText = 'Delete Permanently';
    } else if (permanent) {
        message = 'Permanently delete this partner contract? This removes it entirely, including the signing link and all its data. This cannot be undone.';
        confirmText = 'Delete Permanently';
    } else {
        message = 'Void this agreement? The partner\'s signing link will stop working, but the record is kept for your files.';
        confirmText = 'Void';
    }

    const confirmed = (typeof showConfirm === 'function')
        ? await showConfirm(message, 'danger', confirmText)
        : confirm(message);
    if (!confirmed) return;
    try {
        const url = `/api/partner-contracts/${id}${permanent ? '?permanent=true' : ''}`;
        const res = await apiFetch(url, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to remove partner contract');
        closeDetailModal();
    } catch (e) {
        showAlert(e.message || 'Failed to remove partner contract', 'error');
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
        const res = await apiFetch(`/api/partner-contracts/${id}/pdf`);
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
