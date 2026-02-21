const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Checks Time to First Byte (TTFB) and Total Download Time
 * @param {string} urlStr 
 * @returns {Promise<Object>}
 */
async function performanceLightCheck(urlStr) {
    return new Promise((resolve) => {
        const start = Date.now();
        let ttfb = 0;

        try {
            const url = new URL(urlStr);
            const client = url.protocol === 'https:' ? https : http;

            const req = client.get(urlStr, (res) => {
                ttfb = Date.now() - start;

                let dataLen = 0;
                res.on('data', (chunk) => { dataLen += chunk.length; });

                res.on('end', () => {
                    const totalDuration = Date.now() - start;
                    const status = totalDuration < 800 ? 'pass' : (totalDuration < 2000 ? 'warn' : 'fail');

                    resolve({
                        status: status,
                        details: `TTFB: ${ttfb}ms, Total: ${totalDuration}ms`,
                        evidence: { ttfb, totalDuration, sizeBytes: dataLen }
                    });
                });
            });

            req.on('error', (err) => {
                resolve({
                    status: 'fail',
                    details: `Connection failed: ${err.message}`,
                    evidence: { error: err.message }
                });
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'Check timed out', evidence: { timeout: true } });
            });

        } catch (err) {
            resolve({ status: 'fail', details: `Invalid URL`, evidence: { error: err.message } });
        }
    });
}

/**
 * Checks if an API endpoint returns 200 OK and valid JSON
 * @param {string} urlStr 
 * @returns {Promise<Object>}
 */
async function apiHealthCheck(urlStr) {
    return new Promise((resolve) => {
        const start = Date.now();
        try {
            const url = new URL(urlStr);
            const client = url.protocol === 'https:' ? https : http;

            const req = client.get(urlStr, { headers: { 'Accept': 'application/json' } }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    const duration = Date.now() - start;
                    let isValidJson = false;
                    try {
                        JSON.parse(data);
                        isValidJson = true;
                    } catch (e) { }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        if (isValidJson) {
                            resolve({
                                status: 'pass',
                                details: `API is healthy (200 OK, JSON)`,
                                evidence: { statusCode: res.statusCode, durationMs: duration, isJson: true }
                            });
                        } else {
                            resolve({
                                status: 'warn',
                                details: `API returned 200 but not valid JSON`,
                                evidence: { statusCode: res.statusCode, isJson: false, partialBody: data.substring(0, 50) }
                            });
                        }
                    } else {
                        resolve({
                            status: 'fail',
                            details: `API returned error: ${res.statusCode}`,
                            evidence: { statusCode: res.statusCode, durationMs: duration }
                        });
                    }
                });
            });

            req.on('error', (err) => resolve({ status: 'fail', details: err.message, evidence: {} }));
            req.setTimeout(5000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'Timeout', evidence: {} });
            });

        } catch (err) {
            resolve({ status: 'fail', details: `Invalid URL: ${err.message}`, evidence: {} });
        }
    });
}

/**
 * Simple Webhook availability check (Accesses endpoint, expects 405 Method Not Allowed or 200, but ensuring it's reachable)
 * @param {string} urlStr 
 */
async function webhookHealthCheck(urlStr) {
    return new Promise((resolve) => {
        try {
            const url = new URL(urlStr);
            const client = url.protocol === 'https:' ? https : http;

            // Webhooks usually listen for POST. If we GET, we might get 404 or 405, which actually means it's ALIVE (server responded).
            // Status fail means timeout or connection refused.
            const req = client.request(urlStr, { method: 'POST' }, (res) => {
                res.resume();
                resolve({
                    status: 'pass',
                    details: `Webhook endpoint reachable (Status: ${res.statusCode})`,
                    evidence: { statusCode: res.statusCode }
                });
            });

            req.on('error', (err) => {
                resolve({
                    status: 'fail',
                    details: `Webhook endpoint unreachable: ${err.message}`,
                    evidence: { error: err.message }
                });
            });

            req.setTimeout(5000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'Webhook check timed out', evidence: {} });
            });

            req.write(JSON.stringify({ test: 'ping' }));
            req.end();

        } catch (err) {
            resolve({ status: 'fail', details: `Invalid URL`, evidence: {} });
        }
    });
}

module.exports = {
    performanceLightCheck,
    apiHealthCheck,
    webhookHealthCheck
};
