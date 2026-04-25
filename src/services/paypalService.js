const https = require('https');

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
        req.write(data);
        req.end();
    });
}

/**
 * Validates the Webhook Signature with PayPal to ensure authenticity
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
        return false; // Missing header properties mean the request is likely not from PayPal
    }

    const token = await getPayPalAccessToken();

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
                        // PayPal returns verification_status as SUCCESS or FAILURE
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
        req.write(requestBody);
        req.end();
    });
}

module.exports = {
    verifyPayPalWebhookSignature
};
