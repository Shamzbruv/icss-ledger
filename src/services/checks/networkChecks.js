const https = require('https');
const http = require('http');
const dns = require('dns');
const { URL } = require('url');

/**
 * Standardized Check Result
 * @typedef {Object} CheckResult
 * @property {string} status - 'pass', 'warn', 'fail'
 * @property {string} details - Human readable summary
 * @property {Object} evidence - Technical details (latency, codes, etc)
 */

/**
 * Checks if a website is up and returning 200 OK
 * @param {string} urlStr 
 * @returns {Promise<CheckResult>}
 */
async function uptimeCheck(urlStr) {
    return new Promise((resolve) => {
        const start = Date.now();
        try {
            const url = new URL(urlStr);
            const client = url.protocol === 'https:' ? https : http;

            const req = client.get(urlStr, (res) => {
                const duration = Date.now() - start;
                // Consume response data to free up memory
                res.resume();

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        status: 'pass',
                        details: `Site is online (Status: ${res.statusCode})`,
                        evidence: { statusCode: res.statusCode, durationMs: duration }
                    });
                } else if (res.statusCode >= 300 && res.statusCode < 400) {
                    resolve({
                        status: 'warn',
                        details: `Site is redirecting (Status: ${res.statusCode})`,
                        evidence: { statusCode: res.statusCode, durationMs: duration }
                    });
                } else {
                    resolve({
                        status: 'fail',
                        details: `Site returned error status: ${res.statusCode}`,
                        evidence: { statusCode: res.statusCode, durationMs: duration }
                    });
                }
            });

            req.on('error', (err) => {
                resolve({
                    status: 'fail',
                    details: `Connection failed: ${err.message}`,
                    evidence: { error: err.message, durationMs: Date.now() - start }
                });
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve({
                    status: 'fail',
                    details: 'Connection timed out (10s)',
                    evidence: { timeout: true }
                });
            });

        } catch (err) {
            resolve({ status: 'fail', details: `Invalid URL: ${err.message}`, evidence: { error: err.message } });
        }
    });
}

/**
 * Checks SSL Certificate Expiry
 * @param {string} domainOrUrl 
 * @returns {Promise<CheckResult>}
 */
async function sslExpiryCheck(domainOrUrl) {
    return new Promise((resolve) => {
        try {
            // Extract hostname if a URL is provided
            let hostname = domainOrUrl;
            if (domainOrUrl.startsWith('http')) {
                hostname = new URL(domainOrUrl).hostname;
            }

            const options = {
                hostname: hostname,
                port: 443,
                method: 'GET',
                rejectUnauthorized: false, // We want to inspect the cert even if invalid
                agent: new https.Agent({ maxCachedSessions: 0 }) // Don't cache, force new handshake
            };

            const req = https.request(options, (res) => {
                const cert = res.socket.getPeerCertificate();

                if (!cert || Object.keys(cert).length === 0) {
                    resolve({
                        status: 'fail',
                        details: 'No SSL Header found or connection not encrypted',
                        evidence: {}
                    });
                    return;
                }

                const validTo = new Date(cert.valid_to);
                const daysRemaining = Math.ceil((validTo - Date.now()) / (1000 * 60 * 60 * 24));

                if (daysRemaining < 0) {
                    resolve({
                        status: 'fail',
                        details: `SSL Certificate expired on ${validTo.toISOString().split('T')[0]}`,
                        evidence: { validTo: validTo, daysRemaining }
                    });
                } else if (daysRemaining < 14) {
                    resolve({
                        status: 'warn',
                        details: `SSL Certificate expires soon (${daysRemaining} days left)`,
                        evidence: { validTo: validTo, daysRemaining }
                    });
                } else {
                    resolve({
                        status: 'pass',
                        details: `SSL Valid (${daysRemaining} days remaining)`,
                        evidence: { validTo: validTo, daysRemaining, issuer: cert.issuer.O }
                    });
                }
            });

            req.on('error', (err) => {
                resolve({
                    status: 'fail',
                    details: `SSL Connection failed: ${err.message}`,
                    evidence: { error: err.message }
                });
            });

            req.setTimeout(5000, () => {
                req.destroy();
                resolve({ status: 'fail', details: 'SSL Check timed out', evidence: { timeout: true } });
            });

            req.end();

        } catch (err) {
            resolve({ status: 'fail', details: `Invalid Domain: ${err.message}`, evidence: { error: err.message } });
        }
    });
}

/**
 * Checks if DNS resolves
 * @param {string} domain 
 * @returns {Promise<CheckResult>}
 */
async function dnsCheck(domain) {
    return new Promise((resolve) => {
        try {
            let hostname = domain;
            if (domain.startsWith('http')) {
                hostname = new URL(domain).hostname;
            }

            const start = Date.now();
            let isResolved = false;

            // Timeout wrapper
            const timer = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    resolve({
                        status: 'fail',
                        details: 'DNS Resolution timed out (10s)',
                        evidence: { timeout: true }
                    });
                }
            }, 10000);

            dns.resolve(hostname, (err, addresses) => {
                if (isResolved) return;
                isResolved = true;
                clearTimeout(timer);

                const duration = Date.now() - start;
                if (err) {
                    resolve({
                        status: 'fail',
                        details: `DNS Resolution failed: ${err.code}`,
                        evidence: { error: err.code, durationMs: duration }
                    });
                } else {
                    resolve({
                        status: 'pass',
                        details: `DNS Resolved to ${addresses.length} IP(s)`,
                        evidence: { ips: addresses, durationMs: duration }
                    });
                }
            });
        } catch (err) {
            resolve({ status: 'fail', details: `Invalid Domain input`, evidence: { error: err.message } });
        }
    });
}

/**
 * Checks if a URL redirects (e.g. HTTP to HTTPS)
 * @param {string} urlStr 
 * @returns {Promise<CheckResult>}
 */
async function redirectCheck(urlStr) {
    return new Promise((resolve) => {
        try {
            const url = new URL(urlStr);
            const client = url.protocol === 'https:' ? https : http;

            const req = client.get(urlStr, (res) => {
                res.resume();
                if (res.statusCode >= 300 && res.statusCode < 400) {
                    resolve({
                        status: 'pass',
                        details: `Redirect found (Status: ${res.statusCode} -> ${res.headers.location})`,
                        evidence: { statusCode: res.statusCode, location: res.headers.location }
                    });
                } else {
                    resolve({
                        status: 'warn',
                        details: `No redirect detected (Status: ${res.statusCode})`,
                        evidence: { statusCode: res.statusCode }
                    });
                }
            });

            req.on('error', (err) => resolve({ status: 'fail', details: err.message, evidence: {} }));
            req.end();

        } catch (err) {
            resolve({ status: 'fail', details: err.message, evidence: {} });
        }
    });
}

module.exports = {
    uptimeCheck,
    sslExpiryCheck,
    dnsCheck,
    redirectCheck
};
