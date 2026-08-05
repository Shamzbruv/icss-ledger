const https = require('https');
const PAYPAL_REQUEST_TIMEOUT_MS = 15000;

function applyRequestTimeout(req, operation) {
    req.setTimeout(PAYPAL_REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`PayPal ${operation} timed out after ${PAYPAL_REQUEST_TIMEOUT_MS}ms`));
    });
}

function getPayPalApiBase() {
    const mode = process.env.PAYPAL_MODE || 'live';
    return mode.toLowerCase() === 'sandbox' 
        ? 'api-m.sandbox.paypal.com' 
        : 'api-m.paypal.com';
}

/**
 * Gets a Bearer token from PayPal using standard Basic Auth with Client ID & Secret
 */
async function getPayPalAccessToken() {
    return new Promise((resolve, reject) => {
        const clientId = process.env.PAYPAL_CLIENT_ID;
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
        
        if (!clientId || !clientSecret) {
            return reject(new Error('Missing PayPal credentials in environment variables'));
        }

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const data = 'grant_type=client_credentials';

        const options = {
            hostname: getPayPalApiBase(),
            path: '/v1/oauth2/token',
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-Language': 'en_US',
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(body);
                        resolve(json.access_token);
                    } catch (e) {
                        reject(new Error('Failed to parse Access Token JSON'));
                    }
                } else {
                    reject(new Error(`Failed to get Access Token: ${res.statusCode} - ${body}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        applyRequestTimeout(req, 'access token request');
        req.write(data);
        req.end();
    });
}

/**
 * Attempts to verify a webhook signature against a single webhook ID.
 * @returns {Promise<boolean>}
 */
async function verifySingleWebhookId(headers, body, webhookId, token) {
    const authAlgo = headers['paypal-auth-algo'];
    const certUrl = headers['paypal-cert-url'];
    const transmissionId = headers['paypal-transmission-id'];
    const transmissionSig = headers['paypal-transmission-sig'];
    const transmissionTime = headers['paypal-transmission-time'];

    const requestBody = JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: body
    });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: getPayPalApiBase(),
            path: '/v1/notifications/verify-webhook-signature',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        const req = https.request(options, (res) => {
            let resBody = '';
            res.on('data', chunk => resBody += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(resBody);
                        resolve(json.verification_status === 'SUCCESS');
                    } catch (e) {
                        reject(new Error('Failed to parse Webhook Verification response'));
                    }
                } else {
                    reject(new Error(`Failed to verify webhook signature: ${res.statusCode} - ${resBody}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        applyRequestTimeout(req, 'webhook verification request');
        req.write(requestBody);
        req.end();
    });
}

/**
 * Validates the Webhook Signature with PayPal to ensure authenticity.
 * Uses PAYPAL_WEBHOOK_ID environment variable (set to the iCreate Website webhook ID).
 * @param {Object} headers Request headers
 * @param {Object} body Parsed request body
 */
async function verifyPayPalWebhookSignature(headers, body) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;

    if (!webhookId) {
        throw new Error('PAYPAL_WEBHOOK_ID is missing from environment variables');
    }

    // Required PayPal Webhook Headers
    const authAlgo = headers['paypal-auth-algo'];
    const certUrl = headers['paypal-cert-url'];
    const transmissionId = headers['paypal-transmission-id'];
    const transmissionSig = headers['paypal-transmission-sig'];
    const transmissionTime = headers['paypal-transmission-time'];

    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
        console.warn('[PAYPAL] Missing required webhook headers.');
        return false;
    }

    const token = await getPayPalAccessToken();

    return verifySingleWebhookId(headers, body, webhookId, token);
}

async function paypalApiRequest(path, { method = 'GET', body = null } = {}) {
    const token = await getPayPalAccessToken();
    const requestBody = body === null ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: getPayPalApiBase(),
            path,
            method,
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(requestBody ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                } : {})
            }
        }, res => {
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => {
                let parsed;
                try { parsed = responseBody ? JSON.parse(responseBody) : {}; }
                catch { return reject(new Error('PayPal returned an unreadable response')); }
                if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
                reject(new Error(`PayPal request failed (${res.statusCode}): ${parsed.message || responseBody}`));
            });
        });
        req.on('error', reject);
        applyRequestTimeout(req, 'API request');
        if (requestBody) req.write(requestBody);
        req.end();
    });
}

async function getPayPalSubscription(subscriptionId) {
    if (!/^I-[A-Z0-9]+$/i.test(String(subscriptionId || ''))) throw new Error('Invalid PayPal subscription ID');
    return paypalApiRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

async function resendPayPalWebhookEvent(eventId) {
    const normalizedEventId = String(eventId || '').trim();
    const webhookId = String(process.env.PAYPAL_WEBHOOK_ID || '').trim();
    if (!/^[A-Z0-9-]{1,80}$/i.test(normalizedEventId)) throw new Error('Invalid PayPal webhook event ID');
    if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID is missing from environment variables');
    return paypalApiRequest(
        `/v1/notifications/webhooks-events/${encodeURIComponent(normalizedEventId)}/resend`,
        { method: 'POST', body: { webhook_ids: [webhookId] } }
    );
}

module.exports = {
    verifyPayPalWebhookSignature,
    getPayPalSubscription,
    resendPayPalWebhookEvent
};
