const https = require('https');
const http = require('http');
const { getPinnedRequest } = require('./targetSafety');

function failure(prefix, error, startedAt = null) {
    return {
        status: 'fail',
        details: `${prefix}: ${error.message}`,
        evidence: { error: error.message, ...(startedAt ? { durationMs: Date.now() - startedAt } : {}) }
    };
}

async function performanceLightCheck(urlStr) {
    const startedAt = Date.now();
    try {
        const { url, options } = await getPinnedRequest(urlStr);
        const client = url.protocol === 'https:' ? https : http;
        return await new Promise(resolve => {
            let settled = false;
            const finish = result => {
                if (!settled) {
                    settled = true;
                    resolve(result);
                }
            };
            const req = client.request(options, res => {
                const ttfb = Date.now() - startedAt;
                let dataLength = 0;
                res.on('data', chunk => {
                    dataLength += chunk.length;
                    if (dataLength > 2 * 1024 * 1024) req.destroy();
                });
                res.on('end', () => {
                    const totalDuration = Date.now() - startedAt;
                    const status = totalDuration < 800 ? 'pass' : (totalDuration < 2000 ? 'warn' : 'fail');
                    finish({ status, details: `TTFB: ${ttfb}ms, Total: ${totalDuration}ms`, evidence: { ttfb, totalDuration, sizeBytes: dataLength } });
                });
            });
            req.on('error', error => finish(failure('Connection failed', error, startedAt)));
            req.setTimeout(10000, () => {
                req.destroy();
                finish({ status: 'fail', details: 'Performance check timed out', evidence: { timeout: true } });
            });
            req.end();
        });
    } catch (error) {
        return failure('URL rejected', error, startedAt);
    }
}

async function apiHealthCheck(urlStr) {
    const startedAt = Date.now();
    try {
        const { url, options } = await getPinnedRequest(urlStr, { headers: { Accept: 'application/json' } });
        const client = url.protocol === 'https:' ? https : http;
        return await new Promise(resolve => {
            const req = client.request(options, res => {
                let data = '';
                res.on('data', chunk => {
                    if (data.length < 65536) data += chunk;
                });
                res.on('end', () => {
                    const durationMs = Date.now() - startedAt;
                    let isJson = false;
                    try { JSON.parse(data); isJson = true; } catch (_) { /* handled below */ }
                    if (res.statusCode >= 200 && res.statusCode < 300 && isJson) {
                        resolve({ status: 'pass', details: 'API is healthy (successful JSON response)', evidence: { statusCode: res.statusCode, durationMs, isJson } });
                    } else if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ status: 'warn', details: 'API responded successfully but did not return JSON', evidence: { statusCode: res.statusCode, durationMs, isJson } });
                    } else {
                        resolve({ status: 'fail', details: `API returned error status ${res.statusCode}`, evidence: { statusCode: res.statusCode, durationMs } });
                    }
                });
            });
            req.on('error', error => resolve(failure('API connection failed', error, startedAt)));
            req.setTimeout(5000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'API check timed out', evidence: { timeout: true } });
            });
            req.end();
        });
    } catch (error) {
        return failure('URL rejected', error, startedAt);
    }
}

async function webhookHealthCheck(urlStr) {
    try {
        const { url, options } = await getPinnedRequest(urlStr, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': '15' }
        });
        const client = url.protocol === 'https:' ? https : http;
        return await new Promise(resolve => {
            const req = client.request(options, res => {
                res.resume();
                resolve({ status: 'pass', details: `Webhook endpoint is reachable (Status: ${res.statusCode})`, evidence: { statusCode: res.statusCode } });
            });
            req.on('error', error => resolve(failure('Webhook endpoint unreachable', error)));
            req.setTimeout(5000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'Webhook check timed out', evidence: { timeout: true } });
            });
            req.write(JSON.stringify({ test: 'ping' }));
            req.end();
        });
    } catch (error) {
        return failure('URL rejected', error);
    }
}

module.exports = { performanceLightCheck, apiHealthCheck, webhookHealthCheck };
