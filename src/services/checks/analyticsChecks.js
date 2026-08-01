const crypto = require('crypto');
const https = require('https');

const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
let cachedToken = null;

function base64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function loadServiceAccount() {
    const raw = process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON
        || (process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_BASE64
            ? Buffer.from(process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
            : '');
    if (!raw) throw new Error('Google Analytics credentials are not configured');
    let credentials;
    try { credentials = JSON.parse(raw); }
    catch (_) { throw new Error('Google Analytics credentials are not valid JSON'); }
    if (!credentials.client_email || !credentials.private_key) throw new Error('Google Analytics credentials are incomplete');
    return credentials;
}

function request(url, { method = 'GET', headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method, headers }, res => {
            let responseBody = '';
            res.on('data', chunk => {
                if (responseBody.length < 2 * 1024 * 1024) responseBody += chunk;
            });
            res.on('end', () => {
                let parsed = {};
                try { parsed = responseBody ? JSON.parse(responseBody) : {}; }
                catch (_) { return reject(new Error('Google Analytics returned an unreadable response')); }
                if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
                reject(new Error(parsed.error?.message || parsed.error_description || `Google Analytics request failed (${res.statusCode})`));
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('Google Analytics request timed out')));
        if (body) req.write(body);
        req.end();
    });
}

async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
    const credentials = loadServiceAccount();
    const now = Math.floor(Date.now() / 1000);
    const tokenUrl = credentials.token_uri || 'https://oauth2.googleapis.com/token';
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(JSON.stringify({
        iss: credentials.client_email,
        scope: ANALYTICS_SCOPE,
        aud: tokenUrl,
        iat: now,
        exp: now + 3600
    }));
    const unsigned = `${header}.${claims}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url');
    const assertion = `${unsigned}.${signature}`;
    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
    }).toString();
    const token = await request(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        body
    });
    if (!token.access_token) throw new Error('Google Analytics did not issue an access token');
    cachedToken = { value: token.access_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 };
    return cachedToken.value;
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function daysAgo(days) {
    const value = new Date();
    value.setUTCHours(0, 0, 0, 0);
    value.setUTCDate(value.getUTCDate() - days);
    return value;
}

async function queryPeriod(propertyId, startDate, endDate, token) {
    const payload = JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }]
    });
    const result = await request(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        body: payload
    });
    const metrics = result.rows?.[0]?.metricValues || [];
    return {
        activeUsers: Number(metrics[0]?.value || 0),
        sessions: Number(metrics[1]?.value || 0),
        pageViews: Number(metrics[2]?.value || 0)
    };
}

function comparison(current, previous) {
    if (!previous) return current ? 'new activity compared with the previous week' : 'no change from the previous week';
    const percent = Math.round(((current - previous) / previous) * 100);
    return `${Math.abs(percent)}% ${percent >= 0 ? 'higher' : 'lower'} than the previous week`;
}

async function googleAnalyticsTrafficCheck(propertyValue) {
    const propertyId = String(propertyValue || '').trim().replace(/^properties\//i, '');
    if (!/^\d+$/.test(propertyId)) {
        return {
            status: 'warn',
            details: 'Google Analytics traffic analysis is pending connection of the GA4 property.',
            evidence: { configured: false }
        };
    }
    try {
        const token = await getAccessToken();
        const currentStart = isoDate(daysAgo(7));
        const currentEnd = isoDate(daysAgo(1));
        const previousStart = isoDate(daysAgo(14));
        const previousEnd = isoDate(daysAgo(8));
        const [current, previous] = await Promise.all([
            queryPeriod(propertyId, currentStart, currentEnd, token),
            queryPeriod(propertyId, previousStart, previousEnd, token)
        ]);
        return {
            status: 'pass',
            details: `Last 7 days: ${current.activeUsers.toLocaleString()} active users, ${current.sessions.toLocaleString()} sessions and ${current.pageViews.toLocaleString()} page views. Sessions were ${comparison(current.sessions, previous.sessions)}.`,
            evidence: { propertyId, currentPeriod: { start: currentStart, end: currentEnd, ...current }, previousPeriod: { start: previousStart, end: previousEnd, ...previous } }
        };
    } catch (error) {
        return {
            status: 'warn',
            details: `Google Analytics traffic could not be retrieved: ${error.message}`,
            evidence: { propertyId, error: error.message }
        };
    }
}

module.exports = { googleAnalyticsTrafficCheck };
