const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../db');
const { sendEmail } = require('../services/emailService');
const { getInfoRequestTemplate } = require('../services/emailTemplates');
const { computeMissingFields, TOKEN_TTL_DAYS } = require('../services/clientInfoRequestService');
const { normalizePublicDomain, parsePublicHttpUrl } = require('../services/checks/targetSafety');

// Some deployments mount the app under a subpath (see DEPLOYMENT.md, cPanel Scenario A) —
// generated links must include it or they'll 404 for the client.
const APP_BASE_PATH = process.env.APP_BASE_PATH || '';

function generateToken() {
    return crypto.randomBytes(24).toString('hex');
}

function buildUpdateUrl(req, token) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return `${origin}${APP_BASE_PATH}/update-info?token=${token}`;
}

async function findServiceByToken(token) {
    const { data, error } = await supabase
        .from('client_services')
        .select('*, clients(id, name, email), service_plans(name)')
        .contains('service_meta_json', { info_update_token: token })
        .maybeSingle();
    if (error) throw error;
    return data;
}

function isExpired(meta) {
    return Boolean(meta.info_update_token_expires_at) && new Date(meta.info_update_token_expires_at) < new Date();
}

// =============================================================================
// ADMIN: trigger the request email (JWT-protected by the checkAuth middleware in server.js)
// =============================================================================

router.post('/:serviceId/send', async (req, res) => {
    try {
        const { data: service, error } = await supabase
            .from('client_services')
            .select('*, clients(id, name, email), service_plans(name)')
            .eq('id', req.params.serviceId)
            .single();
        if (error || !service) return res.status(404).json({ error: 'Subscription not found' });
        if (!service.clients?.email) return res.status(400).json({ error: 'Client has no email address' });

        const meta = service.service_meta_json || {};
        const planName = service.service_plans?.name || '';
        const missing = computeMissingFields(meta, planName);
        if (missing.length === 0) {
            return res.status(400).json({ error: 'Nothing is missing for this client right now.' });
        }

        // Reuse an existing, still-valid token so asking twice doesn't hand the
        // client a second, different link (or quietly invalidate the first one).
        const stillValid = meta.info_update_token && !isExpired(meta);
        const token = stillValid ? meta.info_update_token : generateToken();
        const expiresAt = stillValid
            ? meta.info_update_token_expires_at
            : new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const updateUrl = buildUpdateUrl(req, token);
        const { subject, text, html } = getInfoRequestTemplate(service.clients, missing, updateUrl, TOKEN_TTL_DAYS);

        await sendEmail(service.clients.email, subject, html);

        const { error: updateError } = await supabase
            .from('client_services')
            .update({
                service_meta_json: {
                    ...meta,
                    info_update_token: token,
                    info_update_token_expires_at: expiresAt,
                    info_update_last_sent_at: new Date().toISOString()
                }
            })
            .eq('id', service.id);
        if (updateError) throw updateError;

        console.log(`📋 Info request sent to ${service.clients.email} (${missing.length} field${missing.length > 1 ? 's' : ''} missing)`);
        res.json({ success: true, message: `Request sent to ${service.clients.name}`, missingCount: missing.length });
    } catch (err) {
        console.error('[INFO REQUEST] Send error:', err);
        res.status(500).json({ error: err.message || 'Failed to send the request email.' });
    }
});

// =============================================================================
// PUBLIC ROUTES (no auth — mounted under /api/info-requests/public/*, allow-listed in server.js)
// =============================================================================

router.get('/public/:token', async (req, res) => {
    try {
        const service = await findServiceByToken(req.params.token);
        if (!service) return res.status(404).json({ error: 'This link is invalid.' });

        const meta = service.service_meta_json || {};
        if (isExpired(meta)) {
            return res.status(410).json({ error: "This link has expired. Please contact us and we'll send a new one." });
        }

        const planName = service.service_plans?.name || '';
        const missing = computeMissingFields(meta, planName);

        res.set('Cache-Control', 'no-store');
        res.json({
            clientName: service.clients?.name || '',
            fields: missing.map((field) => ({ key: field.key, label: field.label, why: field.why })),
            alreadyComplete: missing.length === 0
        });
    } catch (err) {
        console.error('[INFO REQUEST] Public fetch error:', err);
        res.status(500).json({ error: 'Unable to load this right now.' });
    }
});

router.post('/public/:token', async (req, res) => {
    try {
        const service = await findServiceByToken(req.params.token);
        if (!service) return res.status(404).json({ error: 'This link is invalid.' });

        const meta = service.service_meta_json || {};
        if (isExpired(meta)) {
            return res.status(410).json({ error: "This link has expired. Please contact us and we'll send a new one." });
        }

        const body = req.body || {};
        const updates = {};

        if (body.contact_name !== undefined) {
            const value = String(body.contact_name).trim().slice(0, 120);
            if (value) updates.contact_name = value;
        }
        if (body.contact_phone !== undefined) {
            const value = String(body.contact_phone).trim().slice(0, 50);
            if (value) updates.contact_phone = value;
        }
        if (body.birthday_month !== undefined || body.birthday_day !== undefined) {
            const month = Number(body.birthday_month);
            const day = Number(body.birthday_day);
            const probe = new Date(Date.UTC(2000, month - 1, day));
            const valid = month >= 1 && month <= 12 && day >= 1 && day <= 31
                && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
            if (!valid) return res.status(400).json({ error: 'Please choose a valid birthday month and day.' });
            updates.birthday_month = month;
            updates.birthday_day = day;
        }
        if (body.website_url) {
            try { updates.website_url = parsePublicHttpUrl(String(body.website_url).trim()).toString(); }
            catch (e) { return res.status(400).json({ error: e.message || 'Please enter a valid website URL.' }); }
        }
        if (body.domain) {
            try { updates.domain = normalizePublicDomain(String(body.domain).trim()); }
            catch (e) { return res.status(400).json({ error: e.message || 'Please enter a valid domain.' }); }
        }
        if (body.ga_property_id) {
            const value = String(body.ga_property_id).trim().replace(/^properties\//i, '');
            if (!/^\d+$/.test(value)) return res.status(400).json({ error: 'Please enter a valid numeric GA4 Property ID.' });
            updates.ga_property_id = value;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Please fill in at least one field.' });
        }

        const newMeta = { ...meta, ...updates };
        const { error: updateError } = await supabase
            .from('client_services')
            .update({ service_meta_json: newMeta })
            .eq('id', service.id);
        if (updateError) throw updateError;

        // Let the admin know — non-fatal if this fails, the client's update is already saved.
        try {
            const adminEmail = process.env.ADMIN_EMAIL || 'Shamzbiz1@gmail.com';
            const fieldList = Object.keys(updates).join(', ');
            await sendEmail(
                adminEmail,
                `📋 ${service.clients?.name || 'A client'} updated their Client Care info`,
                `<p><strong>${service.clients?.name || 'A client'}</strong> (${service.clients?.email || ''}) just submitted: ${fieldList}.</p>`
            );
        } catch (notifyErr) {
            console.error('[INFO REQUEST] Admin notify failed:', notifyErr);
        }

        const planName = service.service_plans?.name || '';
        const stillMissing = computeMissingFields(newMeta, planName);
        res.json({ success: true, remaining: stillMissing.length });
    } catch (err) {
        console.error('[INFO REQUEST] Public submit error:', err);
        res.status(500).json({ error: 'Something went wrong while saving your details. Please try again.' });
    }
});

module.exports = router;
