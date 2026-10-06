const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

// -----------------------------------------------------------------------------
// A tiny in-memory stand-in for the Supabase client (just the calls the route uses), and a
// stubbed mailer, so the REAL Express routes can be exercised end to end without a database.
// -----------------------------------------------------------------------------
const rows = [];
const sentEmails = [];
let nextId = 1;

function query(table) {
    const state = { filters: [], order: null, limit: null, op: 'select', payload: null, one: false, maybe: false };
    const matches = () => rows.filter((r) => state.filters.every(([k, v]) => String(r[k]) === String(v)));
    const run = () => {
        if (table !== 'partner_contracts') return { data: null, error: { message: `unexpected table ${table}` } };
        if (state.op === 'insert') {
            const row = { id: `id-${nextId++}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), viewed_at: null, sent_at: null, signed_at: null, void_at: null, acknowledgements: {}, terms_snapshot_json: null, ...state.payload };
            rows.push(row);
            return { data: row, error: null };
        }
        if (state.op === 'update') {
            const found = matches();
            found.forEach((r) => Object.assign(r, state.payload));
            return { data: state.one ? (found[0] || null) : found, error: found.length || !state.one ? null : { message: 'not found' } };
        }
        if (state.op === 'delete') {
            matches().forEach((r) => rows.splice(rows.indexOf(r), 1));
            return { data: null, error: null };
        }
        let found = matches();
        if (state.order) found = [...found].sort((a, b) => (a[state.order.col] < b[state.order.col] ? 1 : -1) * (state.order.asc ? -1 : 1));
        if (state.limit) found = found.slice(0, state.limit);
        if (state.one) return { data: found[0] || null, error: found.length ? null : { message: 'no rows' } };
        if (state.maybe) return { data: found[0] || null, error: null };
        return { data: found, error: null };
    };
    const api = {
        select() { if (state.op === 'select') state.op = 'select'; return api; },
        insert(p) { state.op = 'insert'; state.payload = p; return api; },
        update(p) { state.op = 'update'; state.payload = p; return api; },
        delete() { state.op = 'delete'; return api; },
        eq(k, v) { state.filters.push([k, v]); return api; },
        order(col, o) { state.order = { col, asc: o?.ascending !== false }; return api; },
        limit(n) { state.limit = n; return api; },
        single() { state.one = true; return Promise.resolve(run()); },
        maybeSingle() { state.maybe = true; return Promise.resolve(run()); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); }
    };
    return api;
}

// Intercept the two modules the route requires by path, then load the router.
const dbPath = path.resolve(__dirname, '../src/db.js');
const emailPath = path.resolve(__dirname, '../src/services/emailService.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { from: query } };
require.cache[emailPath] = {
    id: emailPath, filename: emailPath, loaded: true,
    exports: {
        sendContractEmail: async (to, subject, text, html, pdf, filename) => { sentEmails.push({ kind: 'contract', to, subject, text, html, pdf, filename }); },
        sendEmail: async (to, subject, html) => { sentEmails.push({ kind: 'notify', to, subject, html }); return true; },
        sendInvoiceEmail: async () => {}
    }
};

const express = require('express');
const router = require('../src/routes/partnerContracts');
const { renderPartnerContractHtml, renderPartnerContractSections, buildPartnerContractData, listTemplateSummaries, getAcknowledgements } = require('../src/services/partnerContractTemplate');
const { generatePartnerContractPDF } = require('../src/services/partnerContractPdfService');
const referral = require('../src/services/referralContractTemplate');
const { getPartnerContractSigningRequestTemplate, getPartnerContractSignedConfirmationTemplate } = require('../src/services/emailTemplates');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/partner-contracts', router);
let server;
let base;

test.before(async () => {
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, url, body) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), type };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const baseReferral = (extra = {}) => ({
    template_id: 'referral-commission', partner_name: 'Andrea Campbell', partner_email: 'andrea@example.com',
    partner_phone: '(876) 555-0123', partner_address: '12 Hope Road, Kingston 6', effective_date: '2026-10-06',
    payment_due_days: 14, termination_notice_days: 14, ...extra
});
const allAcks = { commission_ack: true, independent_ack: true, conduct_ack: true, signature_confirmation: true };

// -----------------------------------------------------------------------------
// The agreement text
// -----------------------------------------------------------------------------
test('the referral agreement contains all 27 clauses with the commission figures filled in', () => {
    const d = buildPartnerContractData({ ...baseReferral(), custom_terms_json: { flat_commission_amount: 2000, commission_threshold_amount: 120000, commission_percent: 5 }, company_signer_name: 'Shamar Baker' });
    const blocks = renderPartnerContractSections('referral-commission', d);
    const headings = blocks.filter((b) => b.type === 'h2').map((b) => b.text);
    assert.equal(headings.length, 27);
    assert.equal(headings[0], '1. PURPOSE OF AGREEMENT');
    assert.equal(headings[26], '27. ELECTRONIC SIGNATURES');
    const text = JSON.stringify(blocks);
    assert.match(text, /Projects Below JMD \$120,000/);
    assert.match(text, /JMD \$2,000 per successfully completed referral/);
    assert.match(text, /Five Percent \(5%\) of the qualifying project amount received by the Company/);
    assert.match(text, /within \*\*14 business days\*\* after the applicable client payment has cleared/);
    assert.match(text, /\*\*14 days' written notice\*\*/);
    assert.match(text, /represented by \*\*Shamar Baker\*\*/);
    assert.match(text, /commence on \*\*6 October 2026\*\*/);
    assert.match(text, /laws of \*\*Jamaica\*\*/);
    assert.doesNotMatch(text, /\[DATE\]|\[START DATE\]|\[7\/14\/30\]|\[FULL NAME|\[ADDRESS\]|undefined|NaN/, 'no placeholder may reach a partner');
    assert.ok(blocks.some((b) => b.type === 'signatures-intro'));
});

test('commission terms are customizable and flow through every clause', () => {
    const d = buildPartnerContractData({ ...baseReferral({ payment_due_days: 30, termination_notice_days: 7 }), custom_terms_json: { flat_commission_amount: 3500, commission_threshold_amount: 250000, commission_percent: 7.5, additional_terms: ['Commission on repeat projects applies for 12 months.'] } });
    const text = JSON.stringify(renderPartnerContractSections('referral-commission', d));
    assert.match(text, /Projects Below JMD \$250,000/);
    assert.match(text, /JMD \$3,500 per successfully completed referral/);
    assert.match(text, /7\.5 Percent \(7\.5%\)/);
    assert.match(text, /\*\*30 business days\*\*/);
    assert.match(text, /\*\*7 days' written notice\*\*/);
    assert.match(text, /28\. ADDITIONAL TERMS AGREED FOR THIS REFERRAL PARTNER/);
    assert.match(text, /Commission on repeat projects applies for 12 months\./);
    const standard = JSON.stringify(renderPartnerContractSections('referral-commission', buildPartnerContractData(baseReferral())));
    assert.doesNotMatch(standard, /ADDITIONAL TERMS/, 'the standard agreement has no clause 28');
});

test('number formatting helpers', () => {
    assert.equal(referral.percentWords(5), 'Five');
    assert.equal(referral.percentWords(25), 'Twenty-Five');
    assert.equal(referral.percentWords(100), 'One Hundred');
    assert.equal(referral.percentWords(7.5), '7.5');
    assert.equal(referral.formatJmd(2000), 'JMD $2,000');
    assert.equal(referral.formatJmd(120000), 'JMD $120,000');
    assert.equal(referral.formatJmd(2500.5), 'JMD $2,500.50');
});

test('commission terms are validated', () => {
    assert.deepEqual(referral.normalizeReferralTerms({}).terms, { flat_commission_amount: 2000, commission_threshold_amount: 120000, commission_percent: 5, additional_terms: [] });
    assert.match(referral.normalizeReferralTerms({ commission_percent: 101 }).error, /between 0 and 100/);
    assert.match(referral.normalizeReferralTerms({ commission_percent: 'abc' }).error, /between 0 and 100/);
    assert.match(referral.normalizeReferralTerms({ flat_commission_amount: -1 }).error, /0 or more/);
    assert.match(referral.normalizeReferralTerms({ commission_threshold_amount: 0 }).error, /greater than 0/);
    assert.match(referral.normalizeReferralTerms({ additional_terms: Array(40).fill('x') }).error, /limited to 30/);
    assert.equal(referral.normalizeReferralTerms({ flat_commission_amount: '1,500' }).terms.flat_commission_amount, 1500);
});

test('the referral agreement stays out of the HaloManage template list, and vice versa', () => {
    assert.deepEqual(listTemplateSummaries('referrals').map((t) => t.id), ['referral-commission']);
    assert.ok(!listTemplateSummaries('halomanage').some((t) => t.id === 'referral-commission'));
    assert.equal(listTemplateSummaries('halomanage').length, 4);
    assert.equal(getAcknowledgements('referral-commission').length, 4);
    assert.equal(getAcknowledgements('client-acquisition').length, 4);
    assert.notDeepEqual(getAcknowledgements('referral-commission').map((a) => a.key), getAcknowledgements('client-acquisition').map((a) => a.key));
});

test('partner-supplied text is escaped; only **bold** markers become markup', () => {
    const evil = '<img src=x onerror=alert(1)> **Evil**';
    const html = renderPartnerContractHtml({ ...baseReferral({ partner_name: evil, partner_address: '<script>alert(1)</script>' }), custom_terms_json: { additional_terms: ['<b>x</b> & "y"'] } });
    assert.doesNotMatch(html, /<img src=x|<script>|<b>x<\/b>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /<ol class="contract-ol" type="a">/);
    assert.match(html, /<strong>Shamar Baker<\/strong>/);
});

// -----------------------------------------------------------------------------
// The whole workflow through the real routes
// -----------------------------------------------------------------------------
let created;

test('create: a referral contract is stored as a draft with its own terms and reference', async () => {
    const res = await call('POST', '/api/partner-contracts', { ...baseReferral(), custom_terms: { flat_commission_amount: 2000, commission_threshold_amount: 120000, commission_percent: 5 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    created = res.body;
    assert.equal(created.status, 'draft');
    assert.equal(created.company_slug, 'referrals');
    assert.equal(created.template_id, 'referral-commission');
    assert.match(created.agreement_reference, /^REF-\d{4}-[0-9A-F]{6}$/);
    assert.equal(created.company_signer_name, 'Shamar Baker');
    assert.deepEqual(created.custom_terms_json, { flat_commission_amount: 2000, commission_threshold_amount: 120000, commission_percent: 5, additional_terms: [] });
    assert.equal(Number(created.revenue_share_percent), 5, 'percentage mirrored into the shared column');
    assert.match(created.sign_url, /\/sign-partner-contract\?token=[0-9a-f]{48}$/);
    assert.ok(created.company_signed_at, 'the company countersignature is applied automatically');
});

test('create: bad input is rejected with a clear message', async () => {
    const bad = (extra) => call('POST', '/api/partner-contracts', { ...baseReferral(), ...extra });
    assert.match((await bad({ partner_email: 'not-an-email' })).body.error, /valid partner email/);
    assert.match((await bad({ custom_terms: { commission_percent: 150 } })).body.error, /between 0 and 100/);
    assert.match((await bad({ payment_due_days: 0 })).body.error, /between 1 and 365/);
    assert.match((await bad({ template_id: 'no-such-template' })).body.error, /Unknown template/);
    assert.equal((await call('POST', '/api/partner-contracts', { template_id: 'referral-commission' })).status, 400);
});

test('list: each programme only sees its own agreements', async () => {
    await call('POST', '/api/partner-contracts', { template_id: 'client-acquisition', partner_name: 'Halo Person', partner_email: 'halo@example.com' });
    const referrals = (await call('GET', '/api/partner-contracts?company=referrals')).body;
    const halo = (await call('GET', '/api/partner-contracts?company=halomanage')).body;
    assert.ok(referrals.length >= 1 && referrals.every((c) => c.company_slug === 'referrals'));
    assert.ok(halo.length >= 1 && halo.every((c) => c.company_slug === 'halomanage'));
    assert.match(halo[0].agreement_reference, /^HALO-/);
    const templates = (await call('GET', '/api/partner-contracts/templates?company=referrals')).body;
    assert.deepEqual(templates.map((t) => t.id), ['referral-commission']);
});

test('edit: a draft can be customized, but it cannot be turned into a different kind of agreement', async () => {
    const edited = await call('PATCH', `/api/partner-contracts/${created.id}`, { partner_name: 'Andrea M. Campbell', custom_terms: { flat_commission_amount: 2500 }, payment_due_days: 30 });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.partner_name, 'Andrea M. Campbell');
    assert.equal(edited.body.custom_terms_json.flat_commission_amount, 2500);
    assert.equal(edited.body.custom_terms_json.commission_percent, 5, 'untouched terms are kept');
    assert.equal(edited.body.payment_due_days, 30);
    assert.match((await call('PATCH', `/api/partner-contracts/${created.id}`, { template_id: 'client-acquisition' })).body.error, /cannot be changed/);
    assert.match((await call('PATCH', `/api/partner-contracts/${created.id}`, { custom_terms: { commission_percent: -1 } })).body.error, /between 0 and 100/);
    // back to the standard terms for the rest of the flow
    await call('PATCH', `/api/partner-contracts/${created.id}`, { custom_terms: { flat_commission_amount: 2000 }, payment_due_days: 14 });
});

test('preview: the PDF can be generated for a draft', async () => {
    const res = await call('GET', `/api/partner-contracts/${created.id}/pdf`);
    assert.equal(res.status, 200);
    assert.match(res.type, /application\/pdf/);
    assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(res.body.length > 8000);
});

test('send: the partner gets the signing request, and the terms are frozen', async () => {
    const res = await call('POST', `/api/partner-contracts/${created.id}/send`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.contract.status, 'sent');
    const mail = sentEmails.find((m) => m.kind === 'contract' && m.to === 'andrea@example.com' && /Ready to Sign/.test(m.subject));
    assert.ok(mail, 'signing request emailed to the partner');
    assert.match(mail.subject, /^Your Referral Partner Commission Agreement is Ready to Sign \(REF-/);
    assert.match(mail.html, /JMD \$2,000 per completed referral/);
    assert.match(mail.html, /5% of the amount received/);
    assert.match(mail.html, /Within 14 business days/);
    assert.match(mail.html, /Your Referral Agreement is Ready/);
    assert.doesNotMatch(mail.html, /Revenue Share|HaloManage|undefined/);
    assert.ok(mail.html.includes(res.body.signUrl));
    assert.match(mail.text, /Review and sign here:/);
    assert.ok(rows.find((r) => r.id === created.id).terms_snapshot_json.custom_terms_json, 'snapshot includes the referral terms');
    assert.match((await call('PATCH', `/api/partner-contracts/${created.id}`, { partner_name: 'X' })).body.error, /Only draft/);
});

let token;
test('public page: the partner sees the agreement, referral acknowledgements, and the fields to fill in', async () => {
    token = rows.find((r) => r.id === created.id).sign_token;
    const res = await call('GET', `/api/partner-contracts/public/${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.docLabel, 'Referral Partner Commission Agreement');
    assert.equal(res.body.kind, 'referral');
    assert.deepEqual(res.body.acknowledgements.map((a) => a.key), ['commission_ack', 'independent_ack', 'conduct_ack', 'signature_confirmation']);
    assert.match(res.body.acknowledgements[0].text, /JMD \$2,000.*JMD \$120,000.*5%/s);
    assert.deepEqual(res.body.signerFields, { needsAddress: false, needsPhone: false, trn: true, witness: true }, 'address and phone were provided by the Company');
    assert.match(res.body.html, /<h1 class="contract-title">REFERRAL PARTNER COMMISSION AGREEMENT<\/h1>/);
    assert.match(res.body.html, /Andrea M\. Campbell|Andrea Campbell/);
    assert.equal(res.body.contract.signer_extra_json, undefined, 'internal fields are not exposed');
    assert.equal(rows.find((r) => r.id === created.id).status, 'viewed');
});

test('sign: every acknowledgement is required, and bad details are refused', async () => {
    const sign = (extra) => call('POST', `/api/partner-contracts/public/${token}/sign`, { legal_name: 'Andrea Campbell', signature_type: 'typed', signature_data: 'Andrea Campbell', acknowledgements: allAcks, ...extra });
    assert.match((await sign({ acknowledgements: { ...allAcks, conduct_ack: false } })).body.error, /agree to all terms/);
    assert.match((await sign({ legal_name: ' ' })).body.error, /full legal name/);
    assert.match((await sign({ signature_type: 'scribble' })).body.error, /valid signature/);
    assert.match((await sign({ signature_type: 'drawn', signature_data: 'not-an-image' })).body.error, /provide your signature/);
    assert.match((await sign({ signer_details: { trn: '!!' } })).body.error, /TRN/);
    assert.match((await sign({ signer_details: { witness_name: 'Pat Witness' } })).body.error, /witness must also type/i);
    assert.equal(rows.find((r) => r.id === created.id).status, 'viewed', 'nothing was signed by the failed attempts');
});

test('sign: success stores the signature, the optional TRN and witness, and emails everyone', async () => {
    const before = sentEmails.length;
    const res = await call('POST', `/api/partner-contracts/public/${token}/sign`, {
        legal_name: 'Andrea Campbell', signature_type: 'drawn', signature_data: PNG, acknowledgements: allAcks,
        signer_details: { trn: '123-456-789', witness_name: 'Pat Witness', witness_signature: 'Pat Witness' }
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = rows.find((r) => r.id === created.id);
    assert.equal(row.status, 'signed');
    assert.equal(row.signer_legal_name, 'Andrea Campbell');
    assert.deepEqual(Object.keys(row.acknowledgements).sort(), ['commission_ack', 'conduct_ack', 'independent_ack', 'signature_confirmation']);
    assert.equal(row.signer_extra_json.trn, '123-456-789');
    assert.equal(row.signer_extra_json.witness_name, 'Pat Witness');
    assert.ok(row.signer_extra_json.witness_signed_at);

    const newMail = sentEmails.slice(before);
    const confirmation = newMail.find((m) => m.kind === 'contract');
    assert.ok(confirmation, 'signed copy emailed to the partner');
    assert.equal(confirmation.to, 'andrea@example.com');
    assert.match(confirmation.subject, /Signed: Your Referral Partner Commission Agreement/);
    assert.match(confirmation.html, /Your Commission/);
    assert.match(confirmation.html, /JMD \$2,000 per referral/);
    assert.doesNotMatch(confirmation.html, /123-456-789/, 'the TRN never appears in an email');
    assert.equal(confirmation.filename, `${row.agreement_reference}.pdf`);
    assert.equal(confirmation.pdf.subarray(0, 5).toString(), '%PDF-');
    const notify = newMail.find((m) => m.kind === 'notify');
    assert.ok(notify, 'the owner is notified');
    assert.match(notify.subject, /Referral Agreement Signed: Andrea/);
    assert.match(notify.html, /referral-contracts/);

    assert.equal((await call('POST', `/api/partner-contracts/public/${token}/sign`, { legal_name: 'x', signature_type: 'typed', signature_data: 'x', acknowledgements: allAcks })).status, 409, 'cannot be signed twice');
});

test('signed agreement: partner can download the PDF, the admin sees the signer details, nothing leaks publicly', async () => {
    const pub = await call('GET', `/api/partner-contracts/public/${token}`);
    assert.equal(pub.body.alreadySigned, true);
    assert.equal(JSON.stringify(pub.body.contract).includes('123-456-789'), false);
    const pdf = await call('GET', `/api/partner-contracts/public/${token}/pdf`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.type, /application\/pdf/);
    const admin = (await call('GET', `/api/partner-contracts/${created.id}`)).body;
    assert.equal(admin.signer_extra_json.trn, '123-456-789');
});

test('a partner is asked for the address and phone when the Company did not have them', async () => {
    const draft = (await call('POST', '/api/partner-contracts', { template_id: 'referral-commission', partner_name: 'Sam Sparse', partner_email: 'sam@example.com' })).body;
    assert.equal(draft.status, 'draft');
    await call('POST', `/api/partner-contracts/${draft.id}/send`);
    const tk = rows.find((r) => r.id === draft.id).sign_token;
    const view = (await call('GET', `/api/partner-contracts/public/${tk}`)).body;
    assert.deepEqual(view.signerFields, { needsAddress: true, needsPhone: true, trn: true, witness: true });
    assert.match(view.html, /the address stated in the Referral Partner’s signature details below/);
    const sign = (details) => call('POST', `/api/partner-contracts/public/${tk}/sign`, { legal_name: 'Sam Sparse', signature_type: 'typed', signature_data: 'Sam Sparse', acknowledgements: allAcks, signer_details: details });
    assert.match((await sign({})).body.error, /address/i);
    assert.match((await sign({ address: '5 Palm Ave, Montego Bay' })).body.error, /telephone/i);
    const ok = await sign({ address: '5 Palm Ave, Montego Bay', phone: '876 555 0199' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const row = rows.find((r) => r.id === draft.id);
    assert.equal(row.signer_extra_json.address, '5 Palm Ave, Montego Bay');
    assert.equal(row.signer_extra_json.phone, '876 555 0199');
    assert.equal(row.signer_extra_json.witness_name, undefined, 'no witness unless one is added');
    const pdf = await generatePartnerContractPDF(row);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('void and delete behave like the other contracts', async () => {
    const draft = (await call('POST', '/api/partner-contracts', baseReferral({ partner_email: 'void@example.com' }))).body;
    await call('POST', `/api/partner-contracts/${draft.id}/send`);
    const tk = rows.find((r) => r.id === draft.id).sign_token;
    const voided = await call('DELETE', `/api/partner-contracts/${draft.id}`);
    assert.equal(voided.body.message, 'Agreement voided.');
    assert.equal((await call('GET', `/api/partner-contracts/public/${tk}`)).status, 410, 'a voided link stops working');
    assert.match((await call('POST', `/api/partner-contracts/${draft.id}/send`)).body.error, /voided/);
    await call('DELETE', `/api/partner-contracts/${draft.id}?permanent=true`);
    assert.equal(rows.some((r) => r.id === draft.id), false);
});

test('the existing HaloManage agreements still work exactly as before', async () => {
    const halo = (await call('POST', '/api/partner-contracts', { template_id: 'client-acquisition', partner_name: 'Halo Partner', partner_email: 'hp@example.com', revenue_share_percent: 12, payment_due_days: 10 })).body;
    assert.equal(halo.company_slug, 'halomanage');
    assert.equal(halo.product_name, 'HaloManage');
    assert.equal(halo.company_signer_name, 'S. Baker');
    assert.equal(Number(halo.revenue_share_percent), 12);
    assert.equal(halo.custom_terms_json, undefined, 'no referral columns are written for HaloManage');
    await call('POST', `/api/partner-contracts/${halo.id}/send`);
    const request = sentEmails.filter((m) => m.to === 'hp@example.com').pop();
    assert.match(request.subject, /^Your HaloManage Partner Agreement is Ready to Sign/);
    assert.match(request.html, /Revenue Share/);
    assert.match(request.html, /12%/);
    const tk = rows.find((r) => r.id === halo.id).sign_token;
    const view = (await call('GET', `/api/partner-contracts/public/${tk}`)).body;
    assert.equal(view.kind, 'revenue-share');
    assert.equal(view.signerFields, null);
    assert.deepEqual(view.acknowledgements.map((a) => a.key), ['relationship_ack', 'revenue_share_ack', 'duties_and_authority_ack', 'signature_confirmation']);
    assert.match((await call('POST', `/api/partner-contracts/public/${tk}/sign`, { legal_name: 'Halo Partner', signature_type: 'typed', signature_data: 'HP', acknowledgements: allAcks })).body.error, /agree to all terms/, 'referral acknowledgements do not satisfy a HaloManage agreement');
    const ok = await call('POST', `/api/partner-contracts/public/${tk}/sign`, { legal_name: 'Halo Partner', signature_type: 'typed', signature_data: 'HP', acknowledgements: { relationship_ack: true, revenue_share_ack: true, duties_and_authority_ack: true, signature_confirmation: true } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(rows.find((r) => r.id === halo.id).signer_extra_json, undefined, 'HaloManage signing does not touch the referral-only column');
    const pdf = await generatePartnerContractPDF(rows.find((r) => r.id === halo.id));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('emails are escaped and never contain raw placeholders', () => {
    const contract = { ...baseReferral({ partner_name: '<b>Bad</b> Name' }), agreement_reference: 'REF-2026-AAAAAA', company_name: 'iCreate Solutions & Services', company_signer_name: 'Shamar Baker', custom_terms_json: {}, status: 'sent' };
    const request = getPartnerContractSigningRequestTemplate(contract, 'https://x.test/sign?token=abc', 'https://x.test/sig.png');
    assert.doesNotMatch(request.html, /<b>Bad<\/b>/);
    assert.match(request.html, /JMD \$120,000\+/);
    const signed = getPartnerContractSignedConfirmationTemplate({ ...contract, status: 'signed', signed_at: new Date().toISOString(), signature_type: 'typed', signature_data: 'Bad Name', signer_legal_name: 'Bad Name' }, 'https://x.test/sig.png');
    assert.match(signed.text, /Your commission:/);
    assert.doesNotMatch(signed.html + signed.text + request.html + request.text, /undefined|NaN|\[object|\[DATE\]/);
});
