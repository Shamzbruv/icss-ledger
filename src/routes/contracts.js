const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../db');
const { sendEmail, sendContractEmail } = require('../services/emailService');
const { getContractSigningRequestTemplate, getContractSignedConfirmationTemplate } = require('../services/emailTemplates');
const { renderContractHtml, ACKNOWLEDGEMENTS, defaultPaymentArrangement } = require('../services/contractTemplate');
const { generateContractPDF } = require('../services/contractPdfService');

const ACTIVE_STATUSES = new Set(['draft', 'sent', 'viewed']);
// Some deployments mount the app under a subpath (see DEPLOYMENT.md, cPanel Scenario A) —
// generated links must include it or they'll 404 for the client.
const APP_BASE_PATH = process.env.APP_BASE_PATH || '';

function generateSignToken() {
    return crypto.randomBytes(24).toString('hex');
}

function generateAgreementReference() {
    const year = new Date().getFullYear();
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `ICSS-CON-${year}-${rand}`;
}

function buildSignUrl(req, token) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return `${origin}${APP_BASE_PATH}/sign-contract?token=${token}`;
}

// Attaches the authoritative, deployment-aware sign_url so the admin frontend never has to
// guess it (it can't reliably account for APP_BASE_PATH on its own).
function attachSignUrl(req, contract) {
    if (!contract) return contract;
    return { ...contract, sign_url: buildSignUrl(req, contract.sign_token) };
}

// Fields the admin is allowed to set/edit on a draft.
const EDITABLE_FIELDS = [
    'client_name', 'business_name', 'client_email', 'client_phone',
    'project_type', 'project_description',
    'currency', 'project_cost', 'deposit_percent', 'payment_arrangement',
    'company_signer_name'
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
        client_name: contract.client_name,
        business_name: contract.business_name,
        client_email: contract.client_email,
        signer_legal_name: contract.signer_legal_name,
        signed_at: contract.signed_at,
        company_signer_name: contract.company_signer_name,
        company_signed_at: contract.company_signed_at
    };
}

// =============================================================================
// PUBLIC ROUTES (no auth — mounted under /api/contracts/public/*, allow-listed in server.js)
// =============================================================================

router.get('/public/:token', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('contracts').select('*').eq('sign_token', req.params.token).maybeSingle();
        if (error) throw error;
        if (!contract) return res.status(404).json({ error: 'This agreement link is invalid.' });
        if (contract.status === 'void') return res.status(410).json({ error: 'This agreement is no longer available.' });

        // Mark as viewed (first view only), without disturbing a signed record.
        if (ACTIVE_STATUSES.has(contract.status) && !contract.viewed_at) {
            const { data: updated } = await supabase
                .from('contracts')
                .update({ status: 'viewed', viewed_at: new Date().toISOString() })
                .eq('id', contract.id)
                .select()
                .single();
            if (updated) Object.assign(contract, updated);
        }

        const renderSource = contract.terms_snapshot_json || contract;
        const html = renderContractHtml(renderSource);

        res.set('Cache-Control', 'no-store');
        res.json({
            contract: toPublicContract(contract),
            html,
            acknowledgements: ACKNOWLEDGEMENTS.map((a) => ({
                key: a.key,
                title: a.title,
                text: a.text({ depositPercent: renderSource.deposit_percent ?? contract.deposit_percent }),
                items: a.items || null
            })),
            alreadySigned: contract.status === 'signed'
        });
    } catch (err) {
        console.error('[CONTRACTS] Public fetch error:', err);
        res.status(500).json({ error: 'Unable to load this agreement right now.' });
    }
});

router.post('/public/:token/sign', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('contracts').select('*').eq('sign_token', req.params.token).maybeSingle();
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
        const termsSnapshot = contract.terms_snapshot_json || {
            client_name: contract.client_name,
            business_name: contract.business_name,
            client_email: contract.client_email,
            client_phone: contract.client_phone,
            project_type: contract.project_type,
            project_description: contract.project_description,
            currency: contract.currency,
            project_cost: contract.project_cost,
            deposit_percent: contract.deposit_percent,
            payment_arrangement: contract.payment_arrangement,
            company_signer_name: contract.company_signer_name,
            company_signed_at: contract.company_signed_at,
            agreement_reference: contract.agreement_reference,
            contract_version: contract.contract_version
        };

        const nowIso = new Date().toISOString();
        const forwardedFor = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const signerIp = forwardedFor || req.ip || null;

        const { data: signed, error: updateError } = await supabase
            .from('contracts')
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
                    deposit_ack: ackInput.deposit_ack === true,
                    variable_pricing_ack: ackInput.variable_pricing_ack === true,
                    key_clauses_ack: ackInput.key_clauses_ack === true,
                    signature_confirmation: ackInput.signature_confirmation === true
                },
                terms_snapshot_json: termsSnapshot
            })
            .eq('id', contract.id)
            .select()
            .single();

        if (updateError) throw updateError;

        // Generate the signed PDF and email it to the client (non-blocking for the response, but we await
        // so we can report a real failure back to the client if delivery fails).
        try {
            const pdfBuffer = await generateContractPDF(signed);
            const { subject, html, text } = getContractSignedConfirmationTemplate(signed);
            const filename = `${signed.agreement_reference || 'Service-Agreement'}.pdf`;
            await sendContractEmail(signed.client_email, subject, text, html, pdfBuffer, filename);
        } catch (emailErr) {
            console.error('[CONTRACTS] Failed to email signed copy to client:', emailErr);
        }

        // Notify the business owner that a contract was just signed.
        try {
            const adminEmail = process.env.ADMIN_EMAIL || 'Shamzbiz1@gmail.com';
            const notifyHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #2ed573; border-radius: 10px; overflow: hidden;">
                    <div style="background-color: #2ed573; color: #fff; padding: 18px; text-align: center;">
                        <h2 style="margin:0;">✅ Contract Signed</h2>
                    </div>
                    <div style="padding: 20px;">
                        <p><strong>Client:</strong> ${signed.client_name}${signed.business_name ? ` (${signed.business_name})` : ''}</p>
                        <p><strong>Email:</strong> ${signed.client_email}</p>
                        <p><strong>Reference:</strong> ${signed.agreement_reference || 'N/A'}</p>
                        <p><strong>Signed:</strong> ${new Date(signed.signed_at).toLocaleString('en-US')}</p>
                        <p style="text-align:center; margin-top: 20px;">
                            <a href="https://icreatesolutionsandservices.com/contracts" style="background:#2ed573; color:white; padding: 10px 20px; text-decoration:none; border-radius:5px;">View in Admin</a>
                        </p>
                    </div>
                </div>`;
            await sendEmail(adminEmail, `✅ Contract Signed: ${signed.client_name}`, notifyHtml);
        } catch (notifyErr) {
            console.error('[CONTRACTS] Admin signed-notification failed:', notifyErr);
        }

        res.json({ success: true, message: 'Agreement signed successfully.' });
    } catch (err) {
        console.error('[CONTRACTS] Sign error:', err);
        res.status(500).json({ error: 'Something went wrong while submitting your signature. Please try again.' });
    }
});

router.get('/public/:token/pdf', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('contracts').select('*').eq('sign_token', req.params.token).maybeSingle();
        if (error) throw error;
        if (!contract || contract.status !== 'signed') {
            return res.status(404).json({ error: 'A signed copy is not available yet.' });
        }
        const pdfBuffer = await generateContractPDF(contract);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${contract.agreement_reference || 'Service-Agreement'}.pdf"`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error('[CONTRACTS] Public PDF error:', err);
        res.status(500).json({ error: 'Unable to generate PDF right now.' });
    }
});

// =============================================================================
// ADMIN ROUTES (JWT-protected by the checkAuth middleware in server.js)
// =============================================================================

router.get('/', async (req, res) => {
    try {
        let query = supabase.from('contracts').select('*').order('created_at', { ascending: false }).limit(300);
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
        const { data, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
        if (error) throw error;
        res.json(attachSignUrl(req, data));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.client_name || !body.client_email) {
            return res.status(400).json({ error: 'Client name and email are required.' });
        }

        const depositPercent = body.deposit_percent !== undefined && body.deposit_percent !== ''
            ? Number(body.deposit_percent)
            : 50;
        if (Number.isNaN(depositPercent) || depositPercent < 0 || depositPercent > 100) {
            return res.status(400).json({ error: 'Deposit % must be a number between 0 and 100.' });
        }

        const nowIso = new Date().toISOString();
        const insertPayload = {
            status: 'draft',
            sign_token: generateSignToken(),
            agreement_reference: generateAgreementReference(),
            contract_version: 'v1',
            client_name: body.client_name,
            business_name: body.business_name || null,
            client_email: body.client_email,
            client_phone: body.client_phone || null,
            project_type: body.project_type || null,
            project_description: body.project_description || null,
            currency: body.currency || 'JMD',
            project_cost: Number(body.project_cost) || 0,
            deposit_percent: depositPercent,
            payment_arrangement: body.payment_arrangement || defaultPaymentArrangement(depositPercent, Math.round((100 - depositPercent) * 100) / 100),
            company_signer_name: body.company_signer_name || 'S. Baker',
            company_signature_path: '/assets/signature.png',
            company_signed_at: nowIso
        };

        const { data, error } = await supabase.from('contracts').insert(insertPayload).select().single();
        if (error) throw error;

        res.json(attachSignUrl(req, data));
    } catch (err) {
        console.error('[CONTRACTS] Create error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const { data: existing, error: fetchError } = await supabase.from('contracts').select('status').eq('id', req.params.id).single();
        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ error: 'Contract not found.' });
        if (existing.status !== 'draft') {
            return res.status(400).json({ error: 'Only draft contracts can be edited. Void this one and create a new contract instead.' });
        }

        const updates = pickEditableFields(req.body || {});
        if (updates.deposit_percent !== undefined) {
            const dp = Number(updates.deposit_percent);
            if (Number.isNaN(dp) || dp < 0 || dp > 100) {
                return res.status(400).json({ error: 'Deposit % must be a number between 0 and 100.' });
            }
            updates.deposit_percent = dp;
        }
        if (updates.project_cost !== undefined) updates.project_cost = Number(updates.project_cost) || 0;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase.from('contracts').update(updates).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json(attachSignUrl(req, data));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/send', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
        if (error) throw error;
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });
        if (contract.status === 'signed') return res.status(400).json({ error: 'This agreement has already been signed.' });
        if (contract.status === 'void') return res.status(400).json({ error: 'This agreement has been voided.' });

        // Freeze the figures the client is about to see.
        const termsSnapshot = {
            client_name: contract.client_name,
            business_name: contract.business_name,
            client_email: contract.client_email,
            client_phone: contract.client_phone,
            project_type: contract.project_type,
            project_description: contract.project_description,
            currency: contract.currency,
            project_cost: contract.project_cost,
            deposit_percent: contract.deposit_percent,
            payment_arrangement: contract.payment_arrangement,
            company_signer_name: contract.company_signer_name,
            company_signed_at: contract.company_signed_at,
            agreement_reference: contract.agreement_reference,
            contract_version: contract.contract_version
        };

        const signUrl = buildSignUrl(req, contract.sign_token);
        const { subject, html, text } = getContractSigningRequestTemplate(contract, signUrl);
        await sendContractEmail(contract.client_email, subject, text, html);

        const wasFirstSend = !contract.sent_at;
        const { data: updated, error: updateError } = await supabase
            .from('contracts')
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
        console.error('[CONTRACTS] Send error:', err);
        res.status(500).json({ error: err.message || 'Failed to send the agreement email.' });
    }
});

router.get('/:id/pdf', async (req, res) => {
    try {
        const { data: contract, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
        if (error) throw error;
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });

        const pdfBuffer = await generateContractPDF(contract);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${contract.agreement_reference || 'Service-Agreement'}.pdf"`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error('[CONTRACTS] Admin PDF error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { data: existing, error: fetchError } = await supabase.from('contracts').select('status').eq('id', req.params.id).single();
        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ error: 'Contract not found.' });

        if (existing.status === 'signed') {
            return res.status(400).json({ error: 'Signed agreements cannot be deleted — they are a legal record.' });
        }

        if (existing.status === 'draft') {
            const { error: deleteError } = await supabase.from('contracts').delete().eq('id', req.params.id);
            if (deleteError) throw deleteError;
            return res.json({ success: true, message: 'Draft deleted.' });
        }

        // Sent / viewed — void instead of hard-deleting, so the link stops working but the record remains.
        const { error: voidError } = await supabase
            .from('contracts')
            .update({ status: 'void', void_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', req.params.id);
        if (voidError) throw voidError;
        res.json({ success: true, message: 'Agreement voided.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
