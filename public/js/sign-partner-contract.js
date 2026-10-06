// Public partner-contract signing page — no login required. Mirrors sign-contract.js;
// deliberately avoids the Supabase-backed apiFetch() helper since this page has no session.

const token = new URLSearchParams(window.location.search).get('token');

let contractPayload = null;
let sigMode = 'drawn';
let sigCtx = null;
let drawing = false;
let hasDrawnSignature = false;

// The acknowledgements differ per agreement type, so the list comes from the server with the contract.
let ackKeys = ['signature_confirmation'];
// Referral agreements ask for a few extra details (address / phone, optional TRN and witness).
let signerFields = null;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

async function publicFetch(url, options = {}) {
    const base = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) ? CONFIG.API_BASE_URL : '';
    const fetchUrl = url.startsWith('/api/') ? `${base}${url}` : url;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    return fetch(fetchUrl, { ...options, headers });
}

function apiBase() {
    return (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) ? CONFIG.API_BASE_URL : '';
}

function hideAll() {
    ['loadingState', 'errorState', 'alreadySignedState', 'successState', 'signState'].forEach((id) => {
        document.getElementById(id).classList.add('hidden');
    });
}

function formatLongDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// =============================================================================
// LOAD
// =============================================================================

async function init() {
    if (!token) {
        return showError('No agreement link token was provided. Please use the link from your email.');
    }
    try {
        const res = await publicFetch(`/api/partner-contracts/public/${token}`);
        const data = await res.json();
        if (!res.ok) return showError(data.error || 'This agreement link is invalid.');

        contractPayload = data;

        const docLabel = data.docLabel || `${data.contract.product_name || 'HaloManage'} Partner Agreement`;
        document.getElementById('topbarTitle').textContent = docLabel;
        document.title = `Sign Your ${docLabel} | iCreate Solutions & Services`;

        if (data.alreadySigned) {
            return showAlreadySigned(data);
        }
        showSignForm(data);
    } catch (e) {
        console.error(e);
        showError('Unable to load this agreement right now. Please check your connection and try again.');
    }
}

function showError(msg) {
    hideAll();
    document.getElementById('errorMessage').textContent = msg;
    document.getElementById('errorState').classList.remove('hidden');
}

function showAlreadySigned(data) {
    hideAll();
    const c = data.contract;
    document.getElementById('alreadySignedMessage').textContent =
        `This agreement was signed by ${c.signer_legal_name || c.partner_name} on ${formatLongDate(c.signed_at)}.`;
    document.getElementById('alreadySignedDownload').href = `${apiBase()}/api/partner-contracts/public/${token}/pdf`;
    document.getElementById('alreadySignedState').classList.remove('hidden');
}

function showSignForm(data) {
    hideAll();
    document.getElementById('contractContent').innerHTML = data.html;

    const companyDate = formatLongDate(data.contract.company_signed_at);
    document.getElementById('companySignedLine').textContent = companyDate ? `Signed on ${companyDate}` : '';

    renderAcknowledgements(data.acknowledgements || []);
    document.getElementById('todayDate').textContent = formatLongDate(new Date());

    signerFields = data.signerFields || null;
    if (signerFields) {
        document.getElementById('signerDetailsCard').classList.remove('hidden');
        document.getElementById('addressGroup').classList.toggle('hidden', !signerFields.needsAddress);
        document.getElementById('phoneGroup').classList.toggle('hidden', !signerFields.needsPhone);
        ['addressInput', 'phoneInput', 'trnInput', 'witnessNameInput', 'witnessSigInput'].forEach((id) => {
            document.getElementById(id).addEventListener('input', updateSubmitState);
        });
    }

    document.getElementById('legalNameInput').addEventListener('input', updateSubmitState);
    document.getElementById('typedSigInput').addEventListener('input', updateSubmitState);
    document.getElementById('ack_signature_confirmation').addEventListener('change', updateSubmitState);

    document.getElementById('signState').classList.remove('hidden');
    setupCanvas();
    updateSubmitState();
}

function renderAcknowledgements(acks) {
    const container = document.getElementById('ackSection');
    container.innerHTML = '';
    ackKeys = acks.map((a) => a.key);

    acks.forEach((a) => {
        if (a.key === 'signature_confirmation') {
            document.getElementById('ack_signature_confirmation_label').innerHTML =
                `<strong>${escapeHtml(a.title)}</strong>${escapeHtml(a.text)}`;
            return;
        }
        const itemsHtml = a.items ? `<ul>${a.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
        const div = document.createElement('div');
        div.className = 'ack-item';
        div.innerHTML = `
            <input type="checkbox" id="ack_${a.key}">
            <label for="ack_${a.key}"><strong>${escapeHtml(a.title)}</strong>${escapeHtml(a.text)}${itemsHtml}</label>
        `;
        container.appendChild(div);
    });

    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener('change', updateSubmitState));
}

function toggleWitness() {
    const box = document.getElementById('witnessBox');
    const opening = box.classList.contains('hidden');
    box.classList.toggle('hidden', !opening);
    document.getElementById('witnessToggle').textContent = opening ? '− Remove witness' : '+ Add a witness (optional)';
    if (!opening) {
        document.getElementById('witnessNameInput').value = '';
        document.getElementById('witnessSigInput').value = '';
    }
    updateSubmitState();
}

function expandContract() {
    const el = document.getElementById('contractContent');
    el.style.maxHeight = 'none';
    document.querySelector('.toggle-scroll').style.display = 'none';
}

// =============================================================================
// SIGNATURE PAD (mouse, touch/finger, and stylus via Pointer Events)
// =============================================================================

function setupCanvas() {
    const canvas = document.getElementById('sigCanvas');
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

    sigCtx = canvas.getContext('2d');
    sigCtx.scale(ratio, ratio);
    sigCtx.lineWidth = 2.4;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.strokeStyle = '#101b3d';

    function getPos(e) {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', (e) => {
        drawing = true;
        hasDrawnSignature = true;
        document.getElementById('sigPlaceholder').style.display = 'none';
        const pos = getPos(e);
        sigCtx.beginPath();
        sigCtx.moveTo(pos.x, pos.y);
        canvas.setPointerCapture(e.pointerId);
        updateSubmitState();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const pos = getPos(e);
        sigCtx.lineTo(pos.x, pos.y);
        sigCtx.stroke();
    });

    const stopDrawing = () => { drawing = false; };
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointerleave', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
}

function clearSignature() {
    const canvas = document.getElementById('sigCanvas');
    if (sigCtx) sigCtx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnSignature = false;
    document.getElementById('sigPlaceholder').style.display = 'block';
    updateSubmitState();
}

function setSigMode(mode) {
    sigMode = mode;
    document.getElementById('tabDraw').classList.toggle('active', mode === 'drawn');
    document.getElementById('tabType').classList.toggle('active', mode === 'typed');
    document.getElementById('sigDrawWrap').style.display = mode === 'drawn' ? 'block' : 'none';
    document.querySelector('.sig-actions').style.display = mode === 'drawn' ? 'flex' : 'none';
    document.getElementById('sigTypeWrap').style.display = mode === 'typed' ? 'block' : 'none';
    updateSubmitState();
}

// =============================================================================
// VALIDATION + SUBMIT
// =============================================================================

function updateSubmitState() {
    const legalName = document.getElementById('legalNameInput').value.trim();

    const allAcksChecked = ackKeys.every((key) => {
        const el = document.getElementById(`ack_${key}`);
        return el && el.checked;
    });

    const sigProvided = sigMode === 'drawn'
        ? hasDrawnSignature
        : document.getElementById('typedSigInput').value.trim().length > 1;

    // Referral agreements: the address / telephone are required only when the Company did not have them.
    let detailsOk = true;
    if (signerFields) {
        if (signerFields.needsAddress && document.getElementById('addressInput').value.trim().length < 5) detailsOk = false;
        if (signerFields.needsPhone && document.getElementById('phoneInput').value.replace(/\D/g, '').length < 7) detailsOk = false;
        // A witness needs both a name and a typed signature.
        const witnessName = document.getElementById('witnessNameInput').value.trim();
        const witnessSig = document.getElementById('witnessSigInput').value.trim();
        if (witnessName && witnessSig.length < 2) detailsOk = false;
        if (!witnessName && witnessSig) detailsOk = false;
    }

    const ok = legalName.length >= 2 && allAcksChecked && sigProvided && detailsOk;
    document.getElementById('submitBtn').disabled = !ok;
}

async function submitSignature() {
    const legalName = document.getElementById('legalNameInput').value.trim();
    const errorEl = document.getElementById('submitError');
    errorEl.classList.add('hidden');

    const signatureData = sigMode === 'drawn'
        ? document.getElementById('sigCanvas').toDataURL('image/png')
        : document.getElementById('typedSigInput').value.trim();

    const acknowledgements = {};
    ackKeys.forEach((key) => {
        const el = document.getElementById(`ack_${key}`);
        acknowledgements[key] = !!(el && el.checked);
    });

    const payload = {
        legal_name: legalName,
        signature_type: sigMode,
        signature_data: signatureData,
        acknowledgements
    };
    if (signerFields) {
        payload.signer_details = {
            address: document.getElementById('addressInput').value.trim(),
            phone: document.getElementById('phoneInput').value.trim(),
            trn: document.getElementById('trnInput').value.trim(),
            witness_name: document.getElementById('witnessNameInput').value.trim(),
            witness_signature: document.getElementById('witnessSigInput').value.trim()
        };
    }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
        const res = await publicFetch(`/api/partner-contracts/public/${token}/sign`, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to submit your signature.');

        hideAll();
        const partnerEmail = contractPayload?.contract?.partner_email || 'your email';
        document.getElementById('successMessage').textContent = `Thank you — a signed copy has been emailed to ${partnerEmail}.`;
        document.getElementById('successDownload').href = `${apiBase()}/api/partner-contracts/public/${token}/pdf`;
        document.getElementById('successState').classList.remove('hidden');
    } catch (e) {
        errorEl.textContent = e.message || 'Failed to submit your signature. Please try again.';
        errorEl.classList.remove('hidden');
        btn.textContent = 'Sign & Submit Agreement';
        updateSubmitState();
    }
}

document.addEventListener('DOMContentLoaded', init);
