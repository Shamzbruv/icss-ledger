// Public "update my Client Care details" page — no login required. Deliberately avoids the
// Supabase-backed apiFetch() helper (config.js) since this page has no session and shouldn't
// depend on the Supabase CDN loading successfully just to submit a form. Same pattern as
// public/js/sign-contract.js.

const token = new URLSearchParams(window.location.search).get('token');

let currentFields = [];

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

async function publicFetch(url, options = {}) {
    const base = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) ? CONFIG.API_BASE_URL : '';
    const fetchUrl = url.startsWith('/api/') ? `${base}${url}` : url;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    return fetch(fetchUrl, { ...options, headers });
}

function hideAll() {
    ['loadingState', 'errorState', 'alreadyCompleteState', 'successState', 'formState'].forEach((id) => {
        document.getElementById(id).classList.add('hidden');
    });
}

function showError(msg) {
    hideAll();
    document.getElementById('errorMessage').textContent = msg;
    document.getElementById('errorState').classList.remove('hidden');
}

// =============================================================================
// FIELD RENDERING — one small renderer per field key. `birthday` is the only
// field that maps to two separate inputs / two submitted values.
// =============================================================================

function renderField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'field-item';
    wrap.dataset.key = field.key;

    const inner = field.key === 'birthday'
        ? `<div class="birthday-row">
             <input type="number" min="1" max="12" placeholder="Month (1-12)" id="input_birthday_month">
             <input type="number" min="1" max="31" placeholder="Day (1-31)" id="input_birthday_day">
           </div>`
        : `<input type="${inputTypeFor(field.key)}" placeholder="${placeholderFor(field.key)}" id="input_${field.key}">`;

    wrap.innerHTML = `
        <label class="field-label">${escapeHtml(field.label)}</label>
        <span class="field-why">${escapeHtml(field.why)}</span>
        ${inner}
    `;
    return wrap;
}

function inputTypeFor(key) {
    if (key === 'contact_phone') return 'tel';
    if (key === 'website_url') return 'url';
    return 'text';
}

function placeholderFor(key) {
    return {
        contact_name: 'Your name',
        contact_phone: '(876) 555-0123',
        website_url: 'https://example.com',
        domain: 'example.com',
        ga_property_id: '123456789'
    }[key] || '';
}

// Reads back whatever the client actually filled in, in the shape the API expects.
function collectSubmission() {
    const body = {};
    currentFields.forEach((field) => {
        if (field.key === 'birthday') {
            const month = document.getElementById('input_birthday_month').value;
            const day = document.getElementById('input_birthday_day').value;
            if (month || day) {
                body.birthday_month = month;
                body.birthday_day = day;
            }
            return;
        }
        const value = document.getElementById(`input_${field.key}`).value.trim();
        if (value) body[field.key] = value;
    });
    return body;
}

// =============================================================================
// LOAD
// =============================================================================

async function init() {
    if (!token) {
        return showError('No link token was provided. Please use the link from your email.');
    }
    try {
        const res = await publicFetch(`/api/info-requests/public/${token}`);
        const data = await res.json();
        if (!res.ok) return showError(data.error || 'This link is invalid.');

        if (data.alreadyComplete) {
            hideAll();
            document.getElementById('alreadyCompleteState').classList.remove('hidden');
            return;
        }

        currentFields = data.fields || [];
        document.getElementById('introName').textContent = data.clientName ? `Hi ${data.clientName},` : 'Hi there,';
        const container = document.getElementById('fieldsContainer');
        container.innerHTML = '';
        currentFields.forEach((field) => container.appendChild(renderField(field)));

        hideAll();
        document.getElementById('formState').classList.remove('hidden');
    } catch (e) {
        console.error(e);
        showError('Unable to load this right now. Please check your connection and try again.');
    }
}

// =============================================================================
// SUBMIT
// =============================================================================

async function submitDetails() {
    const errorEl = document.getElementById('submitError');
    errorEl.classList.add('hidden');

    const body = collectSubmission();
    if (Object.keys(body).length === 0) {
        errorEl.textContent = 'Please fill in at least one field before saving.';
        errorEl.classList.remove('hidden');
        return;
    }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        const res = await publicFetch(`/api/info-requests/public/${token}`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
            errorEl.textContent = data.error || 'Something went wrong. Please try again.';
            errorEl.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Save My Details';
            return;
        }

        hideAll();
        document.getElementById('successMessage').textContent = data.remaining > 0
            ? "Your details have been updated. We'll follow up separately about anything still outstanding."
            : 'Your details have been updated — thanks for taking care of that!';
        document.getElementById('successState').classList.remove('hidden');
    } catch (e) {
        console.error(e);
        errorEl.textContent = 'Something went wrong while saving. Please check your connection and try again.';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Save My Details';
    }
}

init();
