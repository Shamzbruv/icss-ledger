// Referral Contracts admin page — list, create, customize, email, and manage Referral Partner
// Commission Agreements. Same lifecycle and workflow as the HaloManage partner contracts
// (draft -> sent -> viewed -> signed, or void): the backend is the shared /api/partner-contracts
// engine, filtered to the 'referrals' company.

const COMPANY = 'referrals';
const TEMPLATE_ID = 'referral-commission';
const DEFAULT_SIGNER = 'Shamar Baker';

let allContracts = [];
let createdContract = null;
let currentDetailContract = null;

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', signed: 'Signed', void: 'Void' };

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(value) {
    if (!value) return null;
    return new Date(value).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function jmd(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return 'JMD $0';
    return `JMD $${n.toLocaleString('en-US', { minimumFractionDigits: Math.abs(n % 1) > 0 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function signUrlFor(contract) {
    // The backend computes this (it accounts for APP_BASE_PATH deployments); this is only a
    // fallback in case an older cached row somehow lacks it.
    return contract.sign_url || `${window.location.origin}/sign-partner-contract?token=${contract.sign_token}`;
}

// The commercial terms live in custom_terms_json (see referralContractTemplate.js).
function termsOf(contract) {
    const t = (contract && contract.custom_terms_json) || {};
    return {
        flat: t.flat_commission_amount ?? 2000,
        threshold: t.commission_threshold_amount ?? 120000,
        percent: t.commission_percent ?? contract.revenue_share_percent ?? 5,
        additional: Array.isArray(t.additional_terms) ? t.additional_terms : []
    };
}

function commissionSummary(flat, threshold, percent) {
    return {
        low: `Projects below ${jmd(threshold)}: ${jmd(flat)} per successfully completed referral`,
        high: `Projects of ${jmd(threshold)} or more: ${Number(percent)}% of the project amount received by the Company`
    };
}

function updateCommissionPreview(prefix) {
    const flat = document.getElementById(`${prefix}_flat`)?.value;
    const threshold = document.getElementById(`${prefix}_threshold`)?.value;
    const percent = document.getElementById(`${prefix}_percent`)?.value;
    const target = document.getElementById(`${prefix}_preview`);
    if (!target) return;
    const s = commissionSummary(flat, threshold, percent);
    target.innerHTML = `<span class="rf-tier">${escapeHTML(s.low)}</span><br><span class="rf-tier">${escapeHTML(s.high)}</span><br>Commission is only paid once the referred client's payment has been received and cleared.`;
}

// =============================================================================
// LOAD / RENDER LIST
// =============================================================================

async function loadContracts() {
    try {
        const res = await apiFetch(`/api/partner-contracts?company=${COMPANY}`);
        if (res.ok) {
            allContracts = await res.json();
            filterTable();
            updateStats(allContracts);
        } else {
            let serverMessage = '';
            try { serverMessage = (await res.json()).error || ''; } catch (parseErr) { /* body wasn't JSON */ }
            console.error(`Failed to load referral contracts — HTTP ${res.status}: ${serverMessage}`);
            const detail = serverMessage ? escapeHTML(serverMessage) : `HTTP ${res.status}`;
            document.getElementById('contractsTableBody').innerHTML = `<tr><td colspan="5" class="text-center">Failed to load referral contracts — ${detail}</td></tr>`;
        }
    } catch (e) {
        console.error('Failed to load referral contracts', e);
        document.getElementById('contractsTableBody').innerHTML = '<tr><td colspan="5" class="text-center">Failed to load referral contracts (network error).</td></tr>';
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
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No referral contracts yet. Click "New Referral Contract" to create one.</td></tr>';
        return;
    }

    contracts.forEach(c => {
        const tr = document.createElement('tr');
        const created = new Date(c.created_at).toLocaleDateString();
        const t = termsOf(c);

        tr.innerHTML = `
            <td><strong>${escapeHTML(c.partner_name)}</strong><br><small class="text-muted">${escapeHTML(c.partner_email)}</small></td>
            <td><span class="rf-pill">${escapeHTML(jmd(t.flat))}</span> <span class="rf-pill">${escapeHTML(String(Number(t.percent)))}%</span><br><small class="text-muted">${escapeHTML(c.agreement_reference || '')}</small></td>
            <td><span class="status-${escapeHTML(c.status)}" style="text-transform:capitalize;">${escapeHTML(STATUS_LABELS[c.status] || c.status)}</span></td>
            <td>${escapeHTML(created)}</td>
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
    ['cf_partnerName', 'cf_partnerEmail', 'cf_partnerPhone', 'cf_partnerAddress', 'cf_additionalTerms']
        .forEach(id => { document.getElementById(id).value = ''; });

    document.getElementById('cf_effectiveDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cf_flat').value = 2000;
    document.getElementById('cf_threshold').value = 120000;
    document.getElementById('cf_percent').value = 5;
    document.getElementById('cf_paymentDays').value = 14;
    document.getElementById('cf_noticeDays').value = 14;
    document.getElementById('cf_signerName').value = DEFAULT_SIGNER;
    updateCommissionPreview('cf');

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

function numberOrNull(id) {
    const raw = document.getElementById(id).value;
    return raw === '' ? null : Number(raw);
}

/** Reads the shared form fields (create modal uses prefix "cf", draft editor uses "dd"). */
function collectFormValues(prefix) {
    const get = (name) => document.getElementById(`${prefix}_${name}`);
    return {
        partner_name: get('partnerName').value.trim(),
        partner_email: get('partnerEmail').value.trim(),
        partner_phone: get('partnerPhone').value.trim() || null,
        partner_address: get('partnerAddress').value.trim() || null,
        effective_date: get('effectiveDate').value || null,
        payment_due_days: numberOrNull(`${prefix}_paymentDays`),
        termination_notice_days: numberOrNull(`${prefix}_noticeDays`),
        company_signer_name: get('signerName').value.trim() || DEFAULT_SIGNER,
        custom_terms: {
            flat_commission_amount: numberOrNull(`${prefix}_flat`),
            commission_threshold_amount: numberOrNull(`${prefix}_threshold`),
            commission_percent: numberOrNull(`${prefix}_percent`),
            additional_terms: get('additionalTerms').value.split('\n').map(s => s.trim()).filter(Boolean)
        }
    };
}

function validateFormValues(v) {
    if (!v.partner_name || !v.partner_email) return 'Please fill in the Referral Partner Full Legal Name and Email.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.partner_email)) return 'Please enter a valid email address for the referral partner.';
    const t = v.custom_terms;
    if (t.flat_commission_amount === null || !(t.flat_commission_amount >= 0)) return 'Enter the flat commission amount (0 or more).';
    if (t.commission_threshold_amount === null || !(t.commission_threshold_amount > 0)) return 'Enter a project value threshold greater than 0.';
    if (t.commission_percent === null || !(t.commission_percent >= 0 && t.commission_percent <= 100)) return 'The commission percentage must be between 0 and 100.';
    if (!(v.payment_due_days >= 1 && v.payment_due_days <= 365)) return 'Commission payment time must be between 1 and 365 business days.';
    if (!(v.termination_notice_days >= 1 && v.termination_notice_days <= 365)) return 'Termination notice must be between 1 and 365 days.';
    return null;
}

async function submitCreateContract() {
    const values = collectFormValues('cf');
    const problem = validateFormValues(values);
    if (problem) return showAlert(problem, 'error');

    const btn = document.getElementById('createSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
        const res = await apiFetch('/api/partner-contracts', { method: 'POST', body: JSON.stringify({ template_id: TEMPLATE_ID, ...values }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create referral contract');

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
        showAlert(e.message || 'Failed to create referral contract', 'error');
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

    if (!contract) return showAlert('Referral contract not found.', 'error');
    currentDetailContract = contract;

    document.getElementById('detailModalTitle').textContent = contract.partner_name;
    document.getElementById('detailBody').innerHTML = contract.status === 'draft' ? renderDraftEditForm(contract) : renderReadOnlyDetail(contract);
    if (contract.status === 'draft') updateCommissionPreview('dd');

    document.getElementById('detailFooter').innerHTML = renderDetailFooter(contract);
    document.getElementById('detailModal').classList.remove('d-none');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.add('d-none');
    loadContracts();
}

function renderDraftEditForm(c) {
    const t = termsOf(c);
    return `
        <div class="section-title">Referral Partner</div>
        <div class="form-grid">
            <div><label>Full Legal Name *</label><input type="text" id="dd_partnerName" class="form-control" value="${escapeHTML(c.partner_name)}"></div>
            <div><label>Email *</label><input type="email" id="dd_partnerEmail" class="form-control" value="${escapeHTML(c.partner_email)}"></div>
            <div><label>Phone / WhatsApp</label><input type="text" id="dd_partnerPhone" class="form-control" value="${escapeHTML(c.partner_phone || '')}"></div>
            <div><label>Agreement / Start Date</label><input type="date" id="dd_effectiveDate" class="form-control" value="${c.effective_date ? escapeHTML(String(c.effective_date).slice(0, 10)) : ''}"></div>
            <div class="full" style="grid-column: 1 / -1;"><label>Address</label><input type="text" id="dd_partnerAddress" class="form-control" value="${escapeHTML(c.partner_address || '')}" placeholder="Optional — if left blank, the partner is asked for it when signing"></div>
        </div>
        <div class="section-title">Commission Terms</div>
        <div class="form-grid">
            <div><label>Flat commission per referral (JMD)</label><input type="number" id="dd_flat" class="form-control" min="0" step="any" value="${escapeHTML(t.flat)}" oninput="updateCommissionPreview('dd')"></div>
            <div><label>Project value threshold (JMD)</label><input type="number" id="dd_threshold" class="form-control" min="1" step="any" value="${escapeHTML(t.threshold)}" oninput="updateCommissionPreview('dd')"></div>
            <div><label>Commission % at or above the threshold</label><input type="number" id="dd_percent" class="form-control" min="0" max="100" step="0.25" value="${escapeHTML(t.percent)}" oninput="updateCommissionPreview('dd')"></div>
            <div><label>Commission paid within (business days)</label><input type="number" id="dd_paymentDays" class="form-control" min="1" max="365" value="${escapeHTML(c.payment_due_days ?? 14)}" list="rfDayChoices"></div>
            <div><label>Termination notice (days)</label><input type="number" id="dd_noticeDays" class="form-control" min="1" max="365" value="${escapeHTML(c.termination_notice_days ?? 14)}" list="rfDayChoices"></div>
            <div class="full rf-highlight" style="grid-column: 1 / -1;"><strong>How this partner will earn</strong><p id="dd_preview"></p></div>
            <div class="full" style="grid-column: 1 / -1;">
                <label>Additional terms for this partner <span class="text-muted" style="text-transform:none; font-weight:400;">(optional)</span></label>
                <textarea id="dd_additionalTerms" class="form-control" rows="3" placeholder="One term per line — added as clause 28 of the agreement">${escapeHTML(t.additional.join('\n'))}</textarea>
            </div>
        </div>
        <div class="section-title">Company Signature (Applied Automatically)</div>
        <div class="form-grid">
            <div><label>Authorized Signer Name</label><input type="text" id="dd_signerName" class="form-control" value="${escapeHTML(c.company_signer_name || DEFAULT_SIGNER)}"></div>
            <div><label>Signature on File</label><div class="signature-preview" style="padding:6px 10px;"><img src="assets/signature.png" style="max-height:40px;"></div></div>
        </div>
        <div class="link-box" style="margin-top: 10px;">
            <input type="text" readonly value="${escapeHTML(signUrlFor(c))}">
            <button class="btn btn-sm btn-outline-light" onclick="copyLink('${escapeHTML(signUrlFor(c))}')">Copy Link</button>
        </div>
    `;
}

function renderReadOnlyDetail(c) {
    const t = termsOf(c);
    const extra = c.signer_extra_json || {};
    const timelineParts = [];
    if (c.created_at) timelineParts.push(`<div class="timeline-item"><strong>Created</strong>${escapeHTML(formatDateTime(c.created_at))}</div>`);
    if (c.sent_at) timelineParts.push(`<div class="timeline-item"><strong>Sent</strong>${escapeHTML(formatDateTime(c.sent_at))}</div>`);
    if (c.viewed_at) timelineParts.push(`<div class="timeline-item"><strong>Viewed</strong>${escapeHTML(formatDateTime(c.viewed_at))}</div>`);
    if (c.signed_at) timelineParts.push(`<div class="timeline-item"><strong>Signed</strong>${escapeHTML(formatDateTime(c.signed_at))}</div>`);
    if (c.void_at) timelineParts.push(`<div class="timeline-item"><strong>Voided</strong>${escapeHTML(formatDateTime(c.void_at))}</div>`);

    let signatureBlock = '';
    if (c.status === 'signed') {
        const sigContent = (c.signature_type === 'drawn' && c.signature_data && String(c.signature_data).startsWith('data:image'))
            ? `<div class="signature-preview"><img src="${escapeHTML(c.signature_data)}" alt="Partner signature"></div>`
            : `<div class="signature-preview"><div class="signature-typed">${escapeHTML(c.signature_data || c.signer_legal_name || '')}</div></div>`;
        signatureBlock = `
            <div class="section-title">Referral Partner Signature</div>
            ${sigContent}
            <div class="detail-grid" style="margin-top: 14px;">
                <div><div class="detail-label">Signed By</div><div class="detail-value">${escapeHTML(c.signer_legal_name || c.partner_name)}</div></div>
                <div><div class="detail-label">IP Address</div><div class="detail-value">${escapeHTML(c.signer_ip || 'N/A')}</div></div>
                ${extra.address ? `<div class="full"><div class="detail-label">Address given when signing</div><div class="detail-value">${escapeHTML(extra.address)}</div></div>` : ''}
                ${extra.phone ? `<div><div class="detail-label">Telephone given when signing</div><div class="detail-value">${escapeHTML(extra.phone)}</div></div>` : ''}
                ${extra.trn ? `<div><div class="detail-label">TRN / Identification No.</div><div class="detail-value">${escapeHTML(extra.trn)}</div></div>` : ''}
                ${extra.witness_name ? `<div class="full"><div class="detail-label">Witness</div><div class="detail-value">${escapeHTML(extra.witness_name)}${extra.witness_signed_at ? ` — ${escapeHTML(formatDateTime(extra.witness_signed_at))}` : ''}</div></div>` : ''}
            </div>
        `;
    }

    return `
        <div class="timeline">${timelineParts.join('')}</div>
        <div class="detail-grid">
            <div><div class="detail-label">Referral Partner</div><div class="detail-value">${escapeHTML(c.partner_name)}</div></div>
            <div><div class="detail-label">Email</div><div class="detail-value">${escapeHTML(c.partner_email)}</div></div>
            <div><div class="detail-label">Phone</div><div class="detail-value">${escapeHTML(c.partner_phone || extra.phone || 'N/A')}</div></div>
            <div><div class="detail-label">Reference</div><div class="detail-value">${escapeHTML(c.agreement_reference || 'N/A')}</div></div>
            <div class="full"><div class="detail-label">Address</div><div class="detail-value">${escapeHTML(c.partner_address || extra.address || 'Not provided')}</div></div>
            <div class="full"><div class="detail-label">Commission</div><div class="detail-value">${escapeHTML(commissionSummary(t.flat, t.threshold, t.percent).low)}\n${escapeHTML(commissionSummary(t.flat, t.threshold, t.percent).high)}</div></div>
            <div><div class="detail-label">Commission paid within</div><div class="detail-value">${escapeHTML(c.payment_due_days ?? 14)} business days</div></div>
            <div><div class="detail-label">Termination notice</div><div class="detail-value">${escapeHTML(c.termination_notice_days ?? 14)} days</div></div>
            <div><div class="detail-label">Start date</div><div class="detail-value">${escapeHTML(c.effective_date ? String(c.effective_date).slice(0, 10) : 'N/A')}</div></div>
            <div><div class="detail-label">Company Signer</div><div class="detail-value">${escapeHTML(c.company_signer_name || DEFAULT_SIGNER)}</div></div>
            ${t.additional.length ? `<div class="full"><div class="detail-label">Additional terms</div><div class="detail-value">${escapeHTML(t.additional.join('\n'))}</div></div>` : ''}
        </div>
        ${signatureBlock}
        ${c.status !== 'void' && c.status !== 'signed' ? `
        <div class="link-box">
            <input type="text" readonly value="${escapeHTML(signUrlFor(c))}">
            <button class="btn btn-sm btn-outline-light" onclick="copyLink('${escapeHTML(signUrlFor(c))}')">Copy Link</button>
        </div>` : ''}
    `;
}

function renderDetailFooter(c) {
    if (c.status === 'draft') {
        return `
            <button class="btn btn-outline-light" style="color:#ff4757; border-color:#ff4757;" onclick="deleteContract('${escapeHTML(c.id)}', 'draft')">Delete Draft</button>
            <div style="display:flex; gap:10px; flex-wrap: wrap;">
                <button class="btn btn-outline-light" onclick="previewDraft('${escapeHTML(c.id)}')">Preview PDF</button>
                <button class="btn btn-secondary" onclick="saveDraft('${escapeHTML(c.id)}')">Save Changes</button>
                <button class="btn btn-primary" onclick="sendDraft('${escapeHTML(c.id)}')">Send Agreement</button>
            </div>
        `;
    }
    if (c.status === 'sent' || c.status === 'viewed') {
        return `
            <div style="display:flex; gap:10px;">
                <button class="btn btn-outline-light" style="color:#ffa502; border-color:#ffa502;" onclick="deleteContract('${escapeHTML(c.id)}', '${escapeHTML(c.status)}', false)">Void</button>
                <button class="btn btn-outline-light" style="color:#ff4757; border-color:#ff4757;" onclick="deleteContract('${escapeHTML(c.id)}', '${escapeHTML(c.status)}', true)">Delete Permanently</button>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn btn-secondary" onclick="viewPdf('${escapeHTML(c.id)}')">Preview PDF</button>
                <button class="btn btn-primary" onclick="resendContract('${escapeHTML(c.id)}')">Resend Email</button>
            </div>
        `;
    }
    if (c.status === 'signed') {
        return `
            <button class="btn btn-outline-light" style="color:#ff4757; border-color:#ff4757;" onclick="deleteContract('${escapeHTML(c.id)}', 'signed', true)">Delete Permanently</button>
            <button class="btn btn-primary" onclick="viewPdf('${escapeHTML(c.id)}')">Download Signed PDF</button>
        `;
    }
    if (c.status === 'void') {
        return `
            <button class="btn btn-outline-light" style="color:#ff4757; border-color:#ff4757;" onclick="deleteContract('${escapeHTML(c.id)}', 'void', true)">Delete Permanently</button>
            <button class="btn btn-secondary" onclick="closeDetailModal()">Close</button>
        `;
    }
    return `<div></div><button class="btn btn-secondary" onclick="closeDetailModal()">Close</button>`;
}

async function saveDraft(id, { silent = false } = {}) {
    const values = collectFormValues('dd');
    const problem = validateFormValues(values);
    if (problem) {
        showAlert(problem, 'error');
        return false;
    }
    try {
        const res = await apiFetch(`/api/partner-contracts/${id}`, { method: 'PATCH', body: JSON.stringify(values) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save changes');
        if (!silent) await showAlert('Changes saved.', 'success');
        return true;
    } catch (e) {
        showAlert(e.message || 'Failed to save changes', 'error');
        return false;
    }
}

// Saves the form first so the preview always reflects what is on screen.
async function previewDraft(id) {
    const saved = await saveDraft(id, { silent: true });
    if (saved) await viewPdf(id);
}

async function sendDraft(id) {
    const saved = await saveDraft(id, { silent: true });
    if (!saved) return;
    try {
        const res = await apiFetch(`/api/partner-contracts/${id}/send`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send');
        await showAlert('Agreement emailed to the referral partner.', 'success');
        closeDetailModal();
    } catch (e) {
        showAlert(e.message || 'Failed to send the agreement email.', 'error');
    }
}

async function resendContract(id) {
    const confirmed = (typeof showConfirm === 'function')
        ? await showConfirm('Resend the signing link to this referral partner by email?', 'info', 'Resend')
        : confirm('Resend the signing link to this referral partner by email?');
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
        message = 'Delete this draft referral contract? This cannot be undone.';
        confirmText = 'Delete';
    } else if (status === 'signed' && permanent) {
        message = "Permanently delete this SIGNED agreement? This is a legal record of the referral partner's electronic signature — deleting it removes all proof they signed, including their signature and audit trail. This cannot be undone.";
        confirmText = 'Delete Permanently';
    } else if (permanent) {
        message = 'Permanently delete this referral contract? This removes it entirely, including the signing link and all its data. This cannot be undone.';
        confirmText = 'Delete Permanently';
    } else {
        message = "Void this agreement? The referral partner's signing link will stop working, but the record is kept for your files.";
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
        if (!res.ok) throw new Error(data.error || 'Failed to remove referral contract');
        closeDetailModal();
    } catch (e) {
        showAlert(e.message || 'Failed to remove referral contract', 'error');
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
updateCommissionPreview('cf');
loadContracts();
