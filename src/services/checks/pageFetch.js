/**
 * Shared, SSRF-safe page fetcher for Client Care checks.
 *
 * Every hop (including redirects) goes through targetSafety.getPinnedRequest, so a client's
 * website can never be used to point our server at a private/internal address. One fetch of
 * the homepage is shared by many checks (uptime, speed, SEO, security headers, links, ...)
 * instead of each check re-downloading the page.
 */
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { getPinnedRequest } = require('./targetSafety');

const USER_AGENT = 'Mozilla/5.0 (compatible; iCreateCareBot/2.0; +https://icreatesolutionsandservices.com)';

function decoderFor(encoding) {
    switch (String(encoding || '').toLowerCase().trim()) {
        case 'gzip':
        case 'x-gzip': return zlib.createGunzip();
        case 'deflate': return zlib.createInflate();
        case 'br': return zlib.createBrotliDecompress();
        default: return null;
    }
}

/**
 * One HTTP request (no redirect following). Resolves with the response metadata and, unless
 * headersOnly is set, the decoded body (capped at maxBytes).
 */
function requestOnce(url, options, { maxBytes, deadlineMs, headersOnly }) {
    const client = url.protocol === 'https:' ? https : http;
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };
        const req = client.request(options, res => {
            const ttfbMs = Date.now() - startedAt;
            const meta = { statusCode: res.statusCode, headers: res.headers, ttfbMs };

            if (headersOnly || (res.statusCode >= 300 && res.statusCode < 400)) {
                res.resume();
                req.destroy();
                return finish(resolve, { ...meta, body: Buffer.alloc(0), wireBytes: 0, decodedBytes: 0, totalMs: Date.now() - startedAt, truncated: false });
            }

            let wireBytes = 0;
            let decodedBytes = 0;
            let truncated = false;
            const chunks = [];

            const decoder = decoderFor(res.headers['content-encoding']);
            res.on('data', chunk => { wireBytes += chunk.length; });
            const source = decoder ? res.pipe(decoder) : res;
            if (decoder) decoder.on('error', () => finish(resolve, { ...meta, body: Buffer.concat(chunks), wireBytes, decodedBytes, totalMs: Date.now() - startedAt, truncated, decodeError: true }));

            source.on('data', chunk => {
                decodedBytes += chunk.length;
                if (decodedBytes <= maxBytes) chunks.push(chunk);
                else if (!truncated) {
                    truncated = true;
                    req.destroy();
                }
            });
            source.on('end', () => finish(resolve, { ...meta, body: Buffer.concat(chunks), wireBytes, decodedBytes, totalMs: Date.now() - startedAt, truncated }));
            source.on('close', () => finish(resolve, { ...meta, body: Buffer.concat(chunks), wireBytes, decodedBytes, totalMs: Date.now() - startedAt, truncated }));
            res.on('error', error => finish(reject, error));
        });
        const timer = setTimeout(() => {
            req.destroy(Object.assign(new Error(`Timed out after ${Math.round(deadlineMs / 1000)}s`), { code: 'ETIMEDOUT' }));
        }, deadlineMs);
        req.on('error', error => finish(reject, error));
        req.end();
    });
}

/**
 * Fetches a URL, following up to maxRedirects redirects. Never throws: failures come back as
 * { ok: false, error, errorCode } so callers can turn them into plain-language results.
 */
async function fetchPage(urlStr, {
    method = 'GET',
    maxBytes = 1_500_000,
    timeoutMs = 12000,
    maxRedirects = 5,
    headers = {},
    headersOnly = false,
    followRedirects = true
} = {}) {
    const startedAt = Date.now();
    const chain = [];
    let current = String(urlStr || '').trim();

    try {
        for (let hop = 0; hop <= maxRedirects; hop++) {
            const remaining = Math.max(1500, timeoutMs - (Date.now() - startedAt));
            const { url, options } = await getPinnedRequest(current, {
                method,
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept-Language': 'en-US,en;q=0.9',
                    ...headers
                }
            });
            const res = await requestOnce(url, options, { maxBytes, deadlineMs: remaining, headersOnly });

            const location = res.headers.location;
            const isRedirect = res.statusCode >= 300 && res.statusCode < 400 && location;
            if (isRedirect) {
                const next = new URL(location, current).toString();
                chain.push({ from: current, status: res.statusCode, to: next });
                if (!followRedirects || hop === maxRedirects) {
                    return {
                        ok: true, requestedUrl: urlStr, finalUrl: current, status: res.statusCode, headers: res.headers,
                        html: '', chain, ttfbMs: res.ttfbMs, totalMs: Date.now() - startedAt, redirectedTo: next, tooManyRedirects: followRedirects && hop === maxRedirects
                    };
                }
                current = next;
                continue;
            }

            const contentType = String(res.headers['content-type'] || '');
            const isText = /text|html|xml|json|javascript/i.test(contentType) || !contentType;
            return {
                ok: true,
                requestedUrl: urlStr,
                finalUrl: current,
                status: res.statusCode,
                headers: res.headers,
                html: isText && !headersOnly ? res.body.toString('utf8') : '',
                chain,
                ttfbMs: res.ttfbMs,
                totalMs: Date.now() - startedAt,
                wireBytes: res.wireBytes,
                decodedBytes: res.decodedBytes,
                truncated: res.truncated,
                compression: String(res.headers['content-encoding'] || '').toLowerCase() || null,
                contentType
            };
        }
    } catch (error) {
        return {
            ok: false,
            requestedUrl: urlStr,
            finalUrl: current,
            chain,
            error: error.message,
            errorCode: error.code || null,
            totalMs: Date.now() - startedAt
        };
    }
    return { ok: false, requestedUrl: urlStr, finalUrl: current, chain, error: 'Too many redirects', errorCode: 'REDIRECT_LOOP', totalMs: Date.now() - startedAt };
}

module.exports = { fetchPage, USER_AGENT };
