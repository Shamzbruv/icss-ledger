const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../db');
const { sendEmail, sendContractEmail } = require('../services/emailService');
const { getPartnerContractSigningRequestTemplate, getPartnerContractSignedConfirmationTemplate } = require('../services/emailTemplates');
const { renderPartnerContractHtml, ACKNOWLEDGEMENTS, listTemplateSummaries, findTemplate } = require('../services/partnerContractTemplate');
const { generatePartnerContractPDF } = require('../services/partnerContractPdfService');

const ACTIVE_STATUSES = new Set(['draft', 'sent', 'viewed']);
// Some deployments mount the app under a subpath (see DEPLOYMENT.md, cPanel Scenario A) —
// generated links must include it or they'll 404 for the partner.
const APP_BASE_PATH = process.env.APP_BASE_PATH || '';

function generateSignToken() {
    return crypto.randomBytes(24).toString('hex');
}

function generateAgreementReference() {
    const year = new Date().getFullYear();
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `HALO-${year}-${rand}`;
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

// Fields the admin is allowed to set/edit on a draft.
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

function buildTermsSnapshot(contract) {
    return {
        template_id: contract.template_id,
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

router.get('/templates', (req, res) => {
    res.json(listTemplateSummaries());
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

        res.set('Cache-Control', 'no-store');
        res.json({
            contract: toPublicContract(contract),
            html,
            templateTitle: t.title,
            acknowledgements: ACKNOWLEDGEMENTS.map((a) => ({
                key: a.key,
                title: a.title,
                text: a.text({
                    relationshipType: renderSource.relationship_type ?? contract.relationship_type,
                    revenueSharePercent: renderSource.revenue_share_percent ?? contract.revenue_share_percent,
                    companyName: renderSource.company_name ?? contract.company_name
                }),
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

        const { legal_name, signature_type, signature_data, acknowledgements } = req.body || {};

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

        const ackInput = acknowledgements || {};
        const missing = ACKNOWLEDGEMENTS.filter((a) => ackInput[a.key] !== true);
        if (missing.length > 0) {
            return res.status(400).json({ error: 'You must agree to all terms before signing.', missing: missing.map((m) => m.key) });
        }

        // Freeze the exact terms shown to the signer, if this hadn't already been locked in at send-time.
        const termsSnapshot = contract.terms_snapshot_json || buildTermsSnapshot(contract);

        const nowIso = new Date().toISOString();
        const forwardedFor = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const signerIp = forwardedFor || req.ip || null;

        const { data: signed, error: updateError } = await supabase
            .from('partner_contracts')
            .update({
                status: 'signed',
                signed_at: nowIso,
                updated_at: nowIso,
                signature_type,
                signature_data,
                signer_legal_name: legalName,
                signer_ip: signerIp,
                signer_user_agent: req.get('User-Agent') || null,
                acknowledgements: {
                    relationship_ack: ackInput.relationship_ack === true,
                    revenue_share_ack: ackInput.revenue_share_ack === true,
                    duties_and_authority_ack: ackInput.duties_and_authority_ack === true,
                    signature_confirmation: ackInput.signature_confirmation === true
                },
                terms_snapshot_json: termsSnapshot
            })
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
            const notifyHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #129c86; border-radius: 10px; overflow: hidden;">
                    <div style="background-color: #129c86; color: #fff; padding: 18px; text-align: center;">
                        <h2 style="margin:0;">✅ Partner Agreement Signed</h2>
                    </div>
                    <div style="padding: 20px;">
                        <p><strong>Partner:</strong> ${signed.partner_name}</p>
                        <p><strong>Email:</strong> ${signed.partner_email}</p>
                        <p><strong>Product:</strong> ${signed.product_name || 'HaloManage'}</p>
                        <p><strong>Reference:</strong> ${signed.agreement_reference || 'N/A'}</p>
                        <p><strong>Signed:</strong> ${new Date(signed.signed_at).toLocaleString('en-US')}</p>
                        <p style="text-align:center; margin-top: 20px;">
                            <a href="https://icreatesolutionsandservices.com/partner-contracts" style="background:#129c86; color:white; padding: 10px 20px; text-decoration:none; border-radius:5px;">View in Admin</a>
                        </p>
                    </div>
                </div>`;
            await sendEmail(adminEmail, `✅ Partner Agreement Signed: ${signed.partner_name}`, notifyHtml);
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
        if (!findTemplate(body.template_id)) {
            return res.status(400).json({ error: 'Unknown template selected.' });
        }
        if (!validateNumericFields(body, res)) return;

        const nowIso = new Date().toISOString();
        const insertPayload = {
            status: 'draft',
            sign_token: generateSignToken(),
            agreement_reference: generateAgreementReference(),
            contract_version: 'v1',
            company_slug: 'halomanage',
            template_id: body.template_id,
            company_name: body.company_name || 'iCreate Solutions & Services',
            product_name: body.product_name || 'HaloManage',
            partner_name: body.partner_name,
            partner_email: body.partner_email,
            partner_phone: body.partner_phone || null,
            partner_address: body.partner_address || null,
            effective_date: body.effective_date || null,
            term_text: body.term_text || null,
            revenue_share_percent: body.revenue_share_percent ?? 10,
            payment_frequency: body.payment_frequency || 'Monthly',
            revenue_scope: body.revenue_scope || null,
            payment_due_days: body.payment_due_days ?? 10,
            termination_notice_days: body.termination_notice_days ?? 14,
            expense_approval_threshold: body.expense_approval_threshold || 'JMD $25,000',
            tail_period_text: body.tail_period_text || '90 days',
            relationship_type: body.relationship_type === 'formal' ? 'formal' : 'commercial',
            additional_duties: body.additional_duties || null,
            company_signer_name: body.company_signer_name || 'S. Baker',
            company_signature_path: '/assets/signature.png',
            company_signed_at: nowIso
        };

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
        const { data: existing, error: fetchError } = await supabase.from('partner_contracts').select('status').eq('id', req.params.id).single();
        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ error: 'Partner contract not found.' });
        if (existing.status !== 'draft') {
            return res.status(400).json({ error: 'Only draft agreements can be edited. Void this one and create a new agreement instead.' });
        }

        const updates = pickEditableFields(req.body || {});
        if (updates.template_id && !findTemplate(updates.template_id)) {
            return res.status(400).json({ error: 'Unknown template selected.' });
        }
        if (!validateNumericFields(updates, res)) return;
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
