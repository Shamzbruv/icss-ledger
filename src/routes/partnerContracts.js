const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../db');
const { sendEmail, sendContractEmail } = require('../services/emailService');
const { getPartnerContractSigningRequestTemplate, getPartnerContractSignedConfirmationTemplate } = require('../services/emailTemplates');
const { renderPartnerContractHtml, getAcknowledgements, listTemplateSummaries, findTemplate, getTemplate, buildPartnerContractData } = require('../services/partnerContractTemplate');
const { normalizeReferralTerms, REFERRAL_DEFAULTS, REFERRAL_COMPANY_SIGNER } = require('../services/referralContractTemplate');
const { generatePartnerContractPDF } = require('../services/partnerContractPdfService');

const ACTIVE_STATUSES = new Set(['draft', 'sent', 'viewed']);
// Some deployments mount the app under a subpath (see DEPLOYMENT.md, cPanel Scenario A) —
// generated links must include it or they'll 404 for the partner.
const APP_BASE_PATH = process.env.APP_BASE_PATH || '';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function generateSignToken() {
    return crypto.randomBytes(24).toString('hex');
}

// Reference prefix per programme: HALO-2026-AB12CD (HaloManage), REF-2026-AB12CD (referrals).
const REFERENCE_PREFIX = { halomanage: 'HALO', referrals: 'REF' };

function generateAgreementReference(companySlug = 'halomanage') {
    const year = new Date().getFullYear();
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${REFERENCE_PREFIX[companySlug] || 'PARTNER'}-${year}-${rand}`;
}

function buildSignUrl(req, token) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return `${origin}${APP_BASE_PATH}/sign-partner-contract?token=${token}`;
}

// Publicly reachable URL for the company signature image, used to show it inline in emails.
function buildCompanySignatureUrl(req) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return `${origin}${APP_BASE_PATH}/assets/signature.png`;
}

// Attaches the authoritative, deployment-aware sign_url so the admin frontend never has to
// guess it (it can't reliably account for APP_BASE_PATH on its own).
function attachSignUrl(req, contract) {
    if (!contract) return contract;
    return { ...contract, sign_url: buildSignUrl(req, contract.sign_token) };
}

// Fields the admin is allowed to set/edit on a draft. (Referral commission terms are validated
// separately and stored in custom_terms_json — see applyReferralTerms.)
const EDITABLE_FIELDS = [
    'template_id', 'company_name', 'product_name',
    'partner_name', 'partner_email', 'partner_phone', 'partner_address',
    'effective_date', 'term_text', 'revenue_share_percent', 'payment_frequency',
    'revenue_scope', 'payment_due_days', 'termination_notice_days',
    'expense_approval_threshold', 'tail_period_text', 'relationship_type',
    'additional_duties', 'company_signer_name'
];

function pickEditableFields(body) {
    const out = {};
    EDITABLE_FIELDS.forEach((key) => {
        if (body[key] !== undefined) out[key] = body[key];
    });
    return out;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Strips internal/audit fields before a record is sent to the public sign page.
function toPublicContract(contract) {
    return {
        id: contract.id,
        status: contract.status,
        agreement_reference: contract.agreement_reference,
        template_id: contract.template_id,
        company_name: contract.company_name,
        product_name: contract.product_name,
        partner_name: contract.partner_name,
        partner_email: contract.partner_email,
        signer_legal_name: contract.signer_legal_name,
        signed_at: contract.signed_at,
        company_signer_name: contract.company_signer_name,
        company_signed_at: contract.company_signed_at
    };
}

function isReferralTemplate(templateId) {
    const t = getTemplate(templateId);
    return !!t && t.kind === 'referral';
}

/**
 * Referral agreements keep their commercial terms in custom_terms_json (flat commission,
 * threshold, percentage, extra terms). The percentage is mirrored into revenue_share_percent so
 * generic lists and the column's NOT NULL rule stay meaningful. Returns an error message or null.
 */
function applyReferralTerms(target, body, existingTerms = {}) {
    const incoming = body.custom_terms !== undefined ? body.custom_terms : null;
    if (incoming === null && Object.keys(existingTerms).length) return null; // nothing to change
    const merged = { ...existingTerms, ...(incoming || {}) };
    const { terms, error } = normalizeReferralTerms(merged);
    if (error) return error;
    target.custom_terms_json = terms;
    target.revenue_share_percent = terms.commission_percent;
    return null;
}

function cleanText(value, max) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Validates what a referral partner types on the signing page. The address and telephone are
 * required only when the Company did not already have them on file; the TRN and the witness are
 * always optional (a witness needs both a name and a typed signature).
 * @returns {{ details?: object, error?: string }}
 */
function collectReferralSignerDetails(input, snapshot) {
    const raw = (input && typeof input === 'object') ? input : {};
    const address = cleanText(raw.address, 300);
    const phone = cleanText(raw.phone, 50);
    const trn = cleanText(raw.trn, 30);
    const witnessName = cleanText(raw.witness_name, 150);
    const witnessSignature = cleanText(raw.witness_signature, 150);

    if (!snapshot.partner_address && address.length < 5) return { error: 'Please enter your address.' };
    if (!snapshot.partner_phone && phone.replace(/\D/g, '').length < 7) return { error: 'Please enter a telephone number we can reach you on.' };
    if (trn && !/^[0-9A-Za-z][0-9A-Za-z\- ]{3,29}$/.test(trn)) return { error: 'Please check the TRN / Identification No. — it should contain only letters, numbers and dashes.' };
    if (witnessName && witnessName.length < 2) return { error: "Please enter the witness's full name." };
    if (witnessName && witnessSignature.length < 2) return { error: 'A witness must also type their signature.' };

    const details = {};
    if (address) details.address = address;
    if (phone) details.phone = phone;
    if (trn) details.trn = trn;
    if (witnessName) {
        details.witness_name = witnessName;
        details.witness_signature = witnessSignature;
        details.witness_signed_at = new Date().toISOString();
    }
    return { details };
}

function buildTermsSnapshot(contract) {
    return {
        template_id: contract.template_id,
        company_slug: contract.company_slug,
        custom_terms_json: contract.custom_terms_json || null,
        company_name: contract.company_name,
        product_name: contract.product_name,
        partner_name: contract.partner_name,
        partner_email: contract.partner_email,
        partner_phone: contract.partner_phone,
        partner_address: contract.partner_address,
        effective_date: contract.effective_date,
        term_text: contract.term_text,
        revenue_share_percent: contract.revenue_share_percent,
        payment_frequency: contract.payment_frequency,
        revenue_scope: contract.revenue_scope,
        payment_due_days: contract.payment_due_days,
        termination_notice_days: contract.termination_notice_days,
        expense_approval_threshold: contract.expense_approval_threshold,
        tail_period_text: contract.tail_period_text,
        relationship_type: contract.relationship_type,
        additional_duties: contract.additional_duties,
        company_signer_name: contract.company_signer_name,
        company_signed_at: contract.company_signed_at,
        agreement_reference: contract.agreement_reference,
        contract_version: contract.contract_version
    };
}

function validateNumericFields(body, res) {
    if (body.revenue_share_percent !== undefined) {
        const v = Number(body.revenue_share_percent);
        if (Number.isNaN(v) || v < 0 || v > 100) {
            res.status(400).json({ error: 'Revenue share % must be a number between 0 and 100.' });
            return false;
        }
        body.revenue_share_percent = v;
    }
    if (body.payment_due_days !== undefined) body.payment_due_days = Number(body.payment_due_days) || 0;
    if (body.termination_notice_days !== undefined) body.termination_notice_days = Number(body.termination_notice_days) || 0;
    return true;
}

// =============================================================================
// TEMPLATE METADATA (admin-auth — used by the "New Partner Contract" picker)
// =============================================================================

// ?company=halomanage | referrals  limits the list to one programme's templates.
router.get('/templates', (req, res) => {
    res.json(listTemplateSummaries(req.query.company ? String(req.query.company) : undefined));
});

// =============================================================================
// PUBLIC ROUTES (no auth — mounted under /api/partner-contracts/public/*, allow-listed in server.js)
// =============================================================================

router.get('/public/:token', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('partner_contracts').select('*').eq('sign_token', req.params.token).maybeSingle();
        if (error) throw error;
        if (!contract) return res.status(404).json({ error: 'This agreement link is invalid.' });
        if (contract.status === 'void') return res.status(410).json({ error: 'This agreement is no longer available.' });

        // Mark as viewed (first view only), without disturbing a signed record.
        if (ACTIVE_STATUSES.has(contract.status) && !contract.viewed_at) {
            const { data: updated } = await supabase
                .from('partner_contracts')
                .update({ status: 'viewed', viewed_at: new Date().toISOString() })
                .eq('id', contract.id)
                .select()
                .single();
            if (updated) Object.assign(contract, updated);
        }

        const renderSource = contract.terms_snapshot_json || contract;
        const html = renderPartnerContractHtml(renderSource);
        const t = findTemplate(renderSource.template_id);
        const data = buildPartnerContractData(renderSource);

        // Referral agreements ask the partner for the details the Company may not have (address,
        // telephone), plus an optional TRN and an optional witness. Other agreements ask for nothing extra.
        const signerFields = t.kind === 'referral'
            ? { needsAddress: !data.partnerAddress, needsPhone: !data.partnerPhone, trn: true, witness: true }
            : null;

        res.set('Cache-Control', 'no-store');
        res.json({
            contract: toPublicContract(contract),
            html,
            templateTitle: t.title,
            docLabel: data.docLabel,
            kind: t.kind,
            signerFields,
            acknowledgements: getAcknowledgements(renderSource.template_id).map((a) => ({
                key: a.key,
                title: a.title,
                text: a.text(data),
                items: a.items || null
            })),
            alreadySigned: contract.status === 'signed'
        });
    } catch (err) {
        console.error('[PARTNER CONTRACTS] Public fetch error:', err);
        res.status(500).json({ error: 'Unable to load this agreement right now.' });
    }
});

router.post('/public/:token/sign', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('partner_contracts').select('*').eq('sign_token', req.params.token).maybeSingle();
        if (error) throw error;
        if (!contract) return res.status(404).json({ error: 'This agreement link is invalid.' });
        if (contract.status === 'void') return res.status(410).json({ error: 'This agreement is no longer available.' });
        if (contract.status === 'signed') return res.status(409).json({ error: 'This agreement has already been signed.' });

        const { legal_name, signature_type, signature_data, acknowledgements, signer_details } = req.body || {};

        const legalName = (legal_name || '').trim();
        if (legalName.length < 2) {
            return res.status(400).json({ error: 'Please enter your full legal name.' });
        }
        if (!['drawn', 'typed'].includes(signature_type)) {
            return res.status(400).json({ error: 'A valid signature is required.' });
        }
        if (!signature_data || (signature_type === 'drawn' && !String(signature_data).startsWith('data:image'))) {
            return res.status(400).json({ error: 'Please provide your signature before submitting.' });
        }
        // A drawn signature is a PNG data URL; refuse anything absurdly large.
        if (String(signature_data).length > 1_500_000) {
            return res.status(400).json({ error: 'That signature is too large. Please clear it and sign again.' });
        }

        // Freeze the exact terms shown to the signer, if this hadn't already been locked in at send-time.
        const termsSnapshot = contract.terms_snapshot_json || buildTermsSnapshot(contract);
        const templateForSigning = findTemplate(termsSnapshot.template_id || contract.template_id);

        const ackInput = acknowledgements || {};
        const requiredAcks = getAcknowledgements(templateForSigning.id);
        const missing = requiredAcks.filter((a) => ackInput[a.key] !== true);
        if (missing.length > 0) {
            return res.status(400).json({ error: 'You must agree to all terms before signing.', missing: missing.map((m) => m.key) });
        }

        // Referral agreements: details the partner supplies at signing (address / telephone when the
        // Company did not have them, an optional TRN, and an optional witness).
        let signerExtra = null;
        if (templateForSigning.kind === 'referral') {
            const checked = collectReferralSignerDetails(signer_details, termsSnapshot);
            if (checked.error) return res.status(400).json({ error: checked.error });
            signerExtra = checked.details;
        }

        const nowIso = new Date().toISOString();
        const forwardedFor = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const signerIp = forwardedFor || req.ip || null;

        const signedUpdate = {
            status: 'signed',
            signed_at: nowIso,
            updated_at: nowIso,
            signature_type,
            signature_data,
            signer_legal_name: legalName,
            signer_ip: signerIp,
            signer_user_agent: req.get('User-Agent') || null,
            acknowledgements: Object.fromEntries(requiredAcks.map((a) => [a.key, ackInput[a.key] === true])),
            terms_snapshot_json: termsSnapshot
        };
        // Only referral agreements write this column, so HaloManage signing keeps working even
        // before the column exists on an older database.
        if (signerExtra) signedUpdate.signer_extra_json = signerExtra;

        const { data: signed, error: updateError } = await supabase
            .from('partner_contracts')
            .update(signedUpdate)
            .eq('id', contract.id)
            .select()
            .single();

        if (updateError) throw updateError;

        // Generate the signed PDF and email it to the partner (awaited so we can report a real
        // failure back to the client if delivery fails, but never blocks the signed status itself).
        try {
            const pdfBuffer = await generatePartnerContractPDF(signed);
            const { subject, html, text } = getPartnerContractSignedConfirmationTemplate(signed, buildCompanySignatureUrl(req));
            const filename = `${signed.agreement_reference || 'Partner-Agreement'}.pdf`;
            await sendContractEmail(signed.partner_email, subject, text, html, pdfBuffer, filename);
        } catch (emailErr) {
            console.error('[PARTNER CONTRACTS] Failed to email signed copy to partner:', emailErr);
        }

        // Notify the business owner that a partner contract was just signed.
        try {
            const adminEmail = process.env.ADMIN_EMAIL || 'Shamzbiz1@gmail.com';
            const isReferral = templateForSigning.kind === 'referral';
            const label = isReferral ? 'Referral Agreement' : 'Partner Agreement';
            const subjectLine = signed.partner_name;
            const notifyHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #129c86; border-radius: 10px; overflow: hidden;">
                    <div style="background-color: #129c86; color: #fff; padding: 18px; text-align: center;">
                        <h2 style="margin:0;">✅ ${label} Signed</h2>
                    </div>
                    <div style="padding: 20px;">
                        <p><strong>${isReferral ? 'Referral partner' : 'Partner'}:</strong> ${escapeHtml(signed.partner_name)}</p>
                        <p><strong>Email:</strong> ${escapeHtml(signed.partner_email)}</p>
                        <p><strong>${isReferral ? 'Agreement' : 'Product'}:</strong> ${escapeHtml(isReferral ? templateForSigning.title : (signed.product_name || 'HaloManage'))}</p>
                        <p><strong>Reference:</strong> ${escapeHtml(signed.agreement_reference || 'N/A')}</p>
                        <p><strong>Signed:</strong> ${new Date(signed.signed_at).toLocaleString('en-US')}</p>
                        <p style="text-align:center; margin-top: 20px;">
                            <a href="https://icreatesolutionsandservices.com${isReferral ? '/referral-contracts' : '/partner-contracts'}" style="background:#129c86; color:white; padding: 10px 20px; text-decoration:none; border-radius:5px;">View in Admin</a>
                        </p>
                    </div>
                </div>`;
            await sendEmail(adminEmail, `✅ ${label} Signed: ${String(subjectLine).replace(/[\r\n]+/g, ' ')}`, notifyHtml);
        } catch (notifyErr) {
            console.error('[PARTNER CONTRACTS] Admin signed-notification failed:', notifyErr);
        }

        res.json({ success: true, message: 'Agreement signed successfully.' });
    } catch (err) {
        console.error('[PARTNER CONTRACTS] Sign error:', err);
        res.status(500).json({ error: 'Something went wrong while submitting your signature. Please try again.' });
    }
});

router.get('/public/:token/pdf', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('partner_contracts').select('*').eq('sign_token', req.params.token).maybeSingle();
        if (error) throw error;
        if (!contract || contract.status !== 'signed') {
            return res.status(404).json({ error: 'A signed copy is not available yet.' });
        }
        const pdfBuffer = await generatePartnerContractPDF(contract);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${contract.agreement_reference || 'Partner-Agreement'}.pdf"`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error('[PARTNER CONTRACTS] Public PDF error:', err);
        res.status(500).json({ error: 'Unable to generate PDF right now.' });
    }
});

// =============================================================================
// ADMIN ROUTES (JWT-protected by the checkAuth middleware in server.js)
// =============================================================================

router.get('/', async (req, res) => {
    try {
        let query = supabase.from('partner_contracts').select('*').order('created_at', { ascending: false }).limit(300);
        if (req.query.status) query = query.eq('status', req.query.status);
        // ?company=halomanage | referrals keeps each programme's page to its own agreements.
        if (req.query.company) query = query.eq('company_slug', String(req.query.company));
        const { data, error } = await query;
        if (error) throw error;
        res.json((data || []).map((c) => attachSignUrl(req, c)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('partner_contracts').select('*').eq('id', req.params.id).single();
        if (error) throw error;
        res.json(attachSignUrl(req, data));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.partner_name || !body.partner_email || !body.template_id) {
            return res.status(400).json({ error: 'Partner name, partner email, and a template selection are required.' });
        }
        const template = getTemplate(body.template_id);
        if (!template) {
            return res.status(400).json({ error: 'Unknown template selected.' });
        }
        if (!EMAIL_PATTERN.test(String(body.partner_email).trim())) {
            return res.status(400).json({ error: 'Please enter a valid partner email address.' });
        }
        if (!validateNumericFields(body, res)) return;

        const isReferral = template.kind === 'referral';
        const nowIso = new Date().toISOString();
        const insertPayload = {
            status: 'draft',
            sign_token: generateSignToken(),
            agreement_reference: generateAgreementReference(template.companySlug),
            contract_version: 'v1',
            company_slug: template.companySlug || 'halomanage',
            template_id: template.id,
            company_name: body.company_name || 'iCreate Solutions & Services',
            product_name: body.product_name || (isReferral ? 'iCreate Referral Program' : 'HaloManage'),
            partner_name: String(body.partner_name).trim(),
            partner_email: String(body.partner_email).trim(),
            partner_phone: body.partner_phone || null,
            partner_address: body.partner_address || null,
            effective_date: body.effective_date || null,
            term_text: body.term_text || (isReferral ? template.term : null),
            revenue_share_percent: body.revenue_share_percent ?? 10,
            payment_frequency: body.payment_frequency || 'Monthly',
            revenue_scope: body.revenue_scope || null,
            payment_due_days: body.payment_due_days ?? (isReferral ? REFERRAL_DEFAULTS.paymentDueDays : 10),
            termination_notice_days: body.termination_notice_days ?? (isReferral ? REFERRAL_DEFAULTS.terminationNoticeDays : 14),
            // No default figure — an unset threshold is meant to stay open to ongoing
            // agreement between the parties rather than lock a number into the agreement.
            expense_approval_threshold: body.expense_approval_threshold || null,
            tail_period_text: body.tail_period_text || '90 days',
            relationship_type: body.relationship_type === 'formal' ? 'formal' : 'commercial',
            additional_duties: body.additional_duties || null,
            company_signer_name: body.company_signer_name || (isReferral ? REFERRAL_COMPANY_SIGNER : 'S. Baker'),
            company_signature_path: '/assets/signature.png',
            company_signed_at: nowIso
        };

        if (isReferral) {
            if (!(insertPayload.payment_due_days >= 1 && insertPayload.payment_due_days <= 365)) {
                return res.status(400).json({ error: 'Payment due (business days) must be between 1 and 365.' });
            }
            if (!(insertPayload.termination_notice_days >= 1 && insertPayload.termination_notice_days <= 365)) {
                return res.status(400).json({ error: 'Termination notice (days) must be between 1 and 365.' });
            }
            const termsError = applyReferralTerms(insertPayload, body);
            if (termsError) return res.status(400).json({ error: termsError });
        }

        const { data, error } = await supabase.from('partner_contracts').insert(insertPayload).select().single();
        if (error) throw error;

        res.json(attachSignUrl(req, data));
    } catch (err) {
        console.error('[PARTNER CONTRACTS] Create error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const { data: existing, error: fetchError } = await supabase.from('partner_contracts').select('*').eq('id', req.params.id).single();
        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ error: 'Partner contract not found.' });
        if (existing.status !== 'draft') {
            return res.status(400).json({ error: 'Only draft agreements can be edited. Void this one and create a new agreement instead.' });
        }

        const body = req.body || {};
        const updates = pickEditableFields(body);
        if (updates.template_id) {
            const requested = getTemplate(updates.template_id);
            if (!requested) return res.status(400).json({ error: 'Unknown template selected.' });
            const current = getTemplate(existing.template_id);
            // A referral agreement and a HaloManage role agreement have different terms; switching
            // between them would silently drop or invent fields, so a new agreement is required.
            if (current && requested.companySlug !== current.companySlug) {
                return res.status(400).json({ error: 'This agreement type cannot be changed. Create a new agreement instead.' });
            }
        }
        if (updates.partner_email !== undefined && !EMAIL_PATTERN.test(String(updates.partner_email).trim())) {
            return res.status(400).json({ error: 'Please enter a valid partner email address.' });
        }
        if (!validateNumericFields(updates, res)) return;

        if (isReferralTemplate(existing.template_id)) {
            const outOfRange = ['payment_due_days', 'termination_notice_days']
                .some((key) => updates[key] !== undefined && !(updates[key] >= 1 && updates[key] <= 365));
            if (outOfRange) {
                return res.status(400).json({ error: 'Payment due and termination notice must each be between 1 and 365 days.' });
            }
            const termsError = applyReferralTerms(updates, body, existing.custom_terms_json || {});
            if (termsError) return res.status(400).json({ error: termsError });
        }
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase.from('partner_contracts').update(updates).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json(attachSignUrl(req, data));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/send', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('partner_contracts').select('*').eq('id', req.params.id).single();
        if (error) throw error;
        if (!contract) return res.status(404).json({ error: 'Partner contract not found.' });
        if (contract.status === 'signed') return res.status(400).json({ error: 'This agreement has already been signed.' });
        if (contract.status === 'void') return res.status(400).json({ error: 'This agreement has been voided.' });

        // Freeze the figures the partner is about to see.
        const termsSnapshot = buildTermsSnapshot(contract);

        const signUrl = buildSignUrl(req, contract.sign_token);
        const { subject, html, text } = getPartnerContractSigningRequestTemplate(contract, signUrl, buildCompanySignatureUrl(req));
        await sendContractEmail(contract.partner_email, subject, text, html);

        const wasFirstSend = !contract.sent_at;
        const { data: updated, error: updateError } = await supabase
            .from('partner_contracts')
            .update({
                status: contract.status === 'draft' ? 'sent' : contract.status,
                sent_at: contract.sent_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
                terms_snapshot_json: termsSnapshot
            })
            .eq('id', contract.id)
            .select()
            .single();
        if (updateError) throw updateError;

        res.json({ success: true, resent: !wasFirstSend, contract: attachSignUrl(req, updated), signUrl });
    } catch (err) {
        console.error('[PARTNER CONTRACTS] Send error:', err);
        res.status(500).json({ error: err.message || 'Failed to send the agreement email.' });
    }
});

router.get('/:id/pdf', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('partner_contracts').select('*').eq('id', req.params.id).single();
        if (error) throw error;
        if (!contract) return res.status(404).json({ error: 'Partner contract not found.' });

        const pdfBuffer = await generatePartnerContractPDF(contract);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${contract.agreement_reference || 'Partner-Agreement'}.pdf"`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error('[PARTNER CONTRACTS] Admin PDF error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { data: existing, error: fetchError } = await supabase.from('partner_contracts').select('status').eq('id', req.params.id).single();
        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ error: 'Partner contract not found.' });

        // ?permanent=true hard-deletes regardless of status — including signed agreements.
        const permanent = req.query.permanent === 'true';

        if (existing.status === 'draft' || permanent) {
            const { error: deleteError } = await supabase.from('partner_contracts').delete().eq('id', req.params.id);
            if (deleteError) throw deleteError;
            return res.json({ success: true, message: 'Agreement permanently deleted.' });
        }

        // Sent / viewed — void instead of hard-deleting by default, so the link stops working
        // but the record remains.
        const { error: voidError } = await supabase
            .from('partner_contracts')
            .update({ status: 'void', void_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', req.params.id);
        if (voidError) throw voidError;
        res.json({ success: true, message: 'Agreement voided.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
