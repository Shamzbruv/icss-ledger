const https = require('https');
const http = require('http');
const { getPinnedRequest, normalizePublicDomain, resolvePublicHost } = require('./targetSafety');

function failedResult(prefix, error, startedAt = null) {
    return {
        status: 'fail',
        details: `${prefix}: ${error.message}`,
        evidence: { error: error.message, ...(startedAt ? { durationMs: Date.now() - startedAt } : {}) }
    };
}

async function uptimeCheck(urlStr) {
    const startedAt = Date.now();
    try {
        const { url, options } = await getPinnedRequest(urlStr);
        const client = url.protocol === 'https:' ? https : http;
        return await new Promise(resolve => {
            const req = client.request(options, res => {
                const duration = Date.now() - startedAt;
                res.resume();
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ status: 'pass', details: `Site is online (Status: ${res.statusCode})`, evidence: { statusCode: res.statusCode, durationMs: duration } });
                } else if (res.statusCode >= 300 && res.statusCode < 400) {
                    resolve({ status: 'warn', details: `Site is redirecting (Status: ${res.statusCode})`, evidence: { statusCode: res.statusCode, durationMs: duration } });
                } else {
                    resolve({ status: 'fail', details: `Site returned error status: ${res.statusCode}`, evidence: { statusCode: res.statusCode, durationMs: duration } });
                }
            });
            req.on('error', error => resolve(failedResult('Connection failed', error, startedAt)));
            req.setTimeout(10000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'Connection timed out (10s)', evidence: { timeout: true } });
            });
            req.end();
        });
    } catch (error) {
        return failedResult('URL rejected', error, startedAt);
    }
}

async function sslExpiryCheck(domainOrUrl) {
    try {
        const hostname = normalizePublicDomain(domainOrUrl);
        const record = await resolvePublicHost(hostname);
        return await new Promise(resolve => {
            const req = https.request({
                hostname,
                port: 443,
                method: 'GET',
                rejectUnauthorized: false,
                agent: new https.Agent({ maxCachedSessions: 0 }),
                servername: hostname,
                lookup: (_hostname, options, callback) => options?.all
                    ? callback(null, [record])
                    : callback(null, record.address, record.family)
            }, res => {
                const cert = res.socket.getPeerCertificate();
                res.resume();
                if (!cert || Object.keys(cert).length === 0) {
                    return resolve({ status: 'fail', details: 'No SSL certificate was presented', evidence: {} });
                }
                const validTo = new Date(cert.valid_to);
                const daysRemaining = Math.ceil((validTo - Date.now()) / 86400000);
                if (daysRemaining < 0) {
                    resolve({ status: 'fail', details: `SSL certificate expired on ${validTo.toISOString().split('T')[0]}`, evidence: { validTo, daysRemaining } });
                } else if (daysRemaining < 14) {
                    resolve({ status: 'warn', details: `SSL certificate expires soon (${daysRemaining} days left)`, evidence: { validTo, daysRemaining } });
                } else {
                    resolve({ status: 'pass', details: `SSL valid (${daysRemaining} days remaining)`, evidence: { validTo, daysRemaining, issuer: cert.issuer?.O || null } });
                }
            });
            req.on('error', error => resolve(failedResult('SSL connection failed', error)));
            req.setTimeout(5000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'SSL check timed out', evidence: { timeout: true } });
            });
            req.end();
        });
    } catch (error) {
        return failedResult('Domain rejected', error);
    }
}

async function dnsCheck(domain) {
    const startedAt = Date.now();
    try {
        const hostname = normalizePublicDomain(domain);
        const record = await resolvePublicHost(hostname);
        return {
            status: 'pass',
            details: 'DNS resolves to a public address',
            evidence: { ip: record.address, durationMs: Date.now() - startedAt }
        };
    } catch (error) {
        return failedResult('DNS resolution failed', error, startedAt);
    }
}

async function redirectCheck(urlStr) {
    try {
        const { url, options } = await getPinnedRequest(urlStr);
        const client = url.protocol === 'https:' ? https : http;
        return await new Promise(resolve => {
            const req = client.request(options, res => {
                res.resume();
                if (res.statusCode >= 300 && res.statusCode < 400) {
                    resolve({ status: 'pass', details: `Redirect found (Status: ${res.statusCode})`, evidence: { statusCode: res.statusCode, location: res.headers.location || null } });
                } else {
                    resolve({ status: 'warn', details: `No redirect detected (Status: ${res.statusCode})`, evidence: { statusCode: res.statusCode } });
                }
            });
            req.on('error', error => resolve(failedResult('Redirect check failed', error)));
            req.setTimeout(5000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'Redirect check timed out', evidence: { timeout: true } });
            });
            req.end();
        });
    } catch (error) {
        return failedResult('URL rejected', error);
    }
}

module.exports = { uptimeCheck, sslExpiryCheck, dnsCheck, redirectCheck };
