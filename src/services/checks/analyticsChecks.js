/**
 * Google Analytics 4 integration for Client Care reports.
 *
 *  - googleAnalyticsTrafficCheck(): pulls a rich picture of the last 7 days (visitors, visits,
 *    pages, top pages, sources, devices, countries, daily trend) vs the previous 7 days.
 *  - Failures are *classified* (no access / wrong ID / API switched off / quota ...) instead of
 *    passing Google's raw developer error text through to a client's inbox. A failed analytics
 *    connection is an iCreate set-up task, never a client-facing "health problem".
 *  - When Google's Admin API is enabled for our Google Cloud project, a wrong Property ID
 *    (the classic mistake is saving the 11-digit *Data Stream ID*) is found and corrected
 *    automatically, matching on the site's Measurement ID / domain. Matching is deliberately
 *    strict (exactly one property may match) so one client's analytics can never be attached
 *    to another client.
 */
const crypto = require('crypto');
const https = require('https');

const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';
let cachedToken = null;
let discoveryCache = { at: 0, ttl: 0, value: null };

function base64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function loadServiceAccount() {
    const raw = process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON
        || (process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_BASE64
            ? Buffer.from(process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
            : '');
    if (!raw) throw Object.assign(new Error('Google Analytics credentials are not configured'), { gaCode: 'CREDENTIALS' });
    let credentials;
    try { credentials = JSON.parse(raw); }
    catch (_) { throw Object.assign(new Error('Google Analytics credentials are not valid JSON'), { gaCode: 'CREDENTIALS' }); }
    if (!credentials.client_email || !credentials.private_key) throw Object.assign(new Error('Google Analytics credentials are incomplete'), { gaCode: 'CREDENTIALS' });
    return credentials;
}

/** The reporting account's email (safe to show to admins; this is an identifier, not a secret). */
function getServiceAccountEmail() {
    try { return loadServiceAccount().client_email; } catch (_) { return null; }
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
                catch (_) { return reject(Object.assign(new Error('Google Analytics returned an unreadable response'), { httpStatus: res.statusCode })); }
                if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
                const details = Array.isArray(parsed.error?.details) ? parsed.error.details : [];
                const info = details.find(d => d.reason) || {};
                const error = new Error(parsed.error?.message || parsed.error_description || `Google Analytics request failed (${res.statusCode})`);
                error.httpStatus = res.statusCode;
                error.gaStatus = parsed.error?.status || null;
                error.reason = info.reason || null;
                error.activationUrl = info.metadata?.activationUrl || null;
                error.service = info.metadata?.service || info.metadata?.serviceTitle || null;
                reject(error);
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(Object.assign(new Error('Google Analytics request timed out'), { code: 'ETIMEDOUT' })));
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
    let token;
    try {
        token = await request(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
            body
        });
    } catch (error) {
        error.gaCode = 'CREDENTIALS';
        throw error;
    }
    if (!token.access_token) throw Object.assign(new Error('Google Analytics did not issue an access token'), { gaCode: 'CREDENTIALS' });
    cachedToken = { value: token.access_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 };
    return cachedToken.value;
}

// -----------------------------------------------------------------------------
// Dates & small helpers
// -----------------------------------------------------------------------------
function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function daysAgo(days, from = new Date()) {
    const value = new Date(from);
    value.setUTCHours(0, 0, 0, 0);
    value.setUTCDate(value.getUTCDate() - days);
    return value;
}

function cleanPropertyId(value) {
    return String(value || '').trim().replace(/^properties\//i, '');
}

/** Property IDs are ~9 digits; the 11-digit number beside "Stream ID" is the usual mix-up. */
function looksLikeStreamId(propertyId) {
    return /^\d{11,}$/.test(String(propertyId || ''));
}

// -----------------------------------------------------------------------------
// Error classification (so the report never shows Google's raw developer error text)
// -----------------------------------------------------------------------------
function classifyGaError(error) {
    const message = String(error?.message || '');
    if (error?.gaCode === 'CREDENTIALS') return { code: 'CREDENTIALS' };
    if (error?.reason === 'SERVICE_DISABLED' || /has not been used in project|API .* is disabled|it is disabled/i.test(message)) {
        const admin = /analyticsadmin/i.test(`${error.service || ''} ${message} ${error.activationUrl || ''}`);
        return { code: admin ? 'ADMIN_API_DISABLED' : 'DATA_API_DISABLED', activationUrl: error.activationUrl || message.match(/https:\/\/console\.developers\.google\.com\/[^\s]+/)?.[0] || null };
    }
    if (error?.httpStatus === 429 || error?.gaStatus === 'RESOURCE_EXHAUSTED') return { code: 'QUOTA' };
    if (error?.httpStatus === 403 || error?.gaStatus === 'PERMISSION_DENIED') return { code: 'NO_ACCESS' };
    if (error?.httpStatus === 404 || error?.gaStatus === 'NOT_FOUND') return { code: 'NOT_FOUND' };
    if (error?.httpStatus === 400 || error?.gaStatus === 'INVALID_ARGUMENT') return { code: 'BAD_ID' };
    if (/timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(`${message} ${error?.code || ''}`)) return { code: 'NETWORK' };
    return { code: 'UNKNOWN' };
}

// Failures worth trying to repair by looking the property up from the website.
const REPAIRABLE = new Set(['NO_ACCESS', 'NOT_FOUND', 'BAD_ID']);

// -----------------------------------------------------------------------------
// Admin API discovery (maps a website to its real GA4 property)
// -----------------------------------------------------------------------------
function hostOf(value) {
    try {
        const text = String(value || '').trim();
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        return url.hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) { return ''; }
}

async function discoverProperties({ force = false } = {}) {
    if (!force && discoveryCache.value && Date.now() - discoveryCache.at < discoveryCache.ttl) return discoveryCache.value;
    let value;
    let ttl = 30 * 60 * 1000;
    try {
        const token = await getAccessToken();
        const headers = { Authorization: `Bearer ${token}` };
        const properties = [];
        let pageToken = '';
        for (let page = 0; page < 5; page++) {
            const listed = await request(`${ADMIN_API}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers });
            (listed.accountSummaries || []).forEach(account => (account.propertySummaries || []).forEach(p => {
                properties.push({ id: String(p.property || '').replace('properties/', ''), displayName: p.displayName || '', account: account.displayName || '', streams: [] });
            }));
            pageToken = listed.nextPageToken || '';
            if (!pageToken) break;
        }
        const queue = properties.slice(0, 80);
        let cursor = 0;
        await Promise.all(Array.from({ length: 4 }, async () => {
            while (cursor < queue.length) {
                const property = queue[cursor++];
                try {
                    const streams = await request(`${ADMIN_API}/properties/${property.id}/dataStreams?pageSize=50`, { headers });
                    property.streams = (streams.dataStreams || []).map(s => ({
                        streamId: String(s.name || '').split('/').pop(),
                        type: s.type || '',
                        uri: s.webStreamData?.defaultUri || '',
                        host: hostOf(s.webStreamData?.defaultUri),
                        measurementId: s.webStreamData?.measurementId || ''
                    }));
                } catch (_) { /* a property we can't read streams for simply can't be matched */ }
            }
        }));
        value = { available: true, properties };
    } catch (error) {
        const c = classifyGaError(error);
        value = { available: false, reason: c.code, activationUrl: c.activationUrl || null, message: error.message };
        ttl = 5 * 60 * 1000;
    }
    discoveryCache = { at: Date.now(), ttl, value };
    return value;
}

/**
 * Decides which property (if any) belongs to a website. Strict by design: it only returns a
 * property when exactly ONE property matches at the strongest level that has any match.
 */
function matchProperty(index, { storedId, measurementIds = [], host = '' } = {}) {
    if (!index?.available) return { matched: false, reason: 'discovery-unavailable' };
    const properties = index.properties || [];
    const wantedHost = hostOf(host);
    const ids = new Set((measurementIds || []).filter(Boolean));

    const unique = list => [...new Map(list.map(p => [p.id, p])).values()];
    const levels = [];

    if (storedId) {
        levels.push({ reason: 'stream-id', hits: properties.filter(p => p.streams.some(s => s.streamId === String(storedId))) });
    }
    if (ids.size) {
        levels.push({ reason: 'measurement-id', hits: properties.filter(p => p.streams.some(s => ids.has(s.measurementId))) });
    }
    if (wantedHost) {
        levels.push({ reason: 'domain', hits: properties.filter(p => p.streams.some(s => s.host && s.host === wantedHost)) });
    }

    for (const level of levels) {
        const hits = unique(level.hits);
        if (hits.length === 1) return { matched: true, propertyId: hits[0].id, displayName: hits[0].displayName, reason: level.reason };
        if (hits.length > 1) return { matched: false, reason: 'ambiguous', candidates: hits.map(h => ({ id: h.id, displayName: h.displayName })), via: level.reason };
    }
    return { matched: false, reason: 'no-match' };
}

/**
 * Privacy guard: is this property really the one for this website? Returns
 * 'verified' | 'mismatch' | 'unknown'. 'mismatch' requires two independent signals, so a
 * legitimate property (e.g. one measured through Tag Manager) is never withheld by mistake.
 */
function verifyOwnership(index, propertyId, { measurementIds = [], host = '' } = {}) {
    if (!index?.available) return 'unknown';
    const property = (index.properties || []).find(p => p.id === String(propertyId));
    if (!property || !property.streams.length) return 'unknown';
    const wantedHost = hostOf(host);
    const ids = new Set((measurementIds || []).filter(Boolean));
    const idMatch = property.streams.some(s => ids.has(s.measurementId));
    const hostMatch = !!wantedHost && property.streams.some(s => s.host === wantedHost);
    if (idMatch || hostMatch) return 'verified';
    const webStreams = property.streams.filter(s => s.type === 'WEB_DATA_STREAM' && s.host);
    if (webStreams.length && ids.size && wantedHost) return 'mismatch';
    return 'unknown';
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------
async function dataApi(path, token, payload) {
    const body = JSON.stringify(payload);
    return request(`${DATA_API}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        body
    });
}

function num(row, index) {
    return Number(row?.metricValues?.[index]?.value || 0);
}

function parseOverview(report) {
    const rows = report?.rows || [];
    const empty = { users: 0, newUsers: 0, sessions: 0, pageViews: 0, engagementRate: 0, avgSessionSeconds: 0 };
    const build = row => row ? {
        users: num(row, 0), newUsers: num(row, 1), sessions: num(row, 2), pageViews: num(row, 3),
        engagementRate: num(row, 4), avgSessionSeconds: num(row, 5)
    } : { ...empty };
    // With two date ranges GA adds a "dateRange" dimension: date_range_0 / date_range_1.
    const current = rows.find(r => r.dimensionValues?.[0]?.value === 'date_range_0') || (rows.length === 1 ? rows[0] : null);
    const previous = rows.find(r => r.dimensionValues?.[0]?.value === 'date_range_1') || null;
    return { current: build(current), previous: build(previous) };
}

function rowsToList(report, labelIndex, valueIndex = 0, limit = 6) {
    return (report?.rows || []).slice(0, limit).map(r => ({ name: r.dimensionValues?.[labelIndex]?.value || '(not set)', value: Number(r.metricValues?.[valueIndex]?.value || 0) }));
}

function parseTopPages(report, limit = 6) {
    const byPath = new Map();
    (report?.rows || []).forEach(r => {
        const title = r.dimensionValues?.[0]?.value || '';
        const path = r.dimensionValues?.[1]?.value || '/';
        const views = Number(r.metricValues?.[0]?.value || 0);
        const users = Number(r.metricValues?.[1]?.value || 0);
        const existing = byPath.get(path);
        if (existing) { existing.views += views; existing.users += users; }
        else byPath.set(path, { title: title === '(not set)' ? '' : title, path, views, users });
    });
    return [...byPath.values()].sort((a, b) => b.views - a.views).slice(0, limit);
}

function parseDaily(report) {
    return (report?.rows || []).map(r => {
        const raw = r.dimensionValues?.[0]?.value || '';
        return { date: raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw, sessions: Number(r.metricValues?.[0]?.value || 0), users: Number(r.metricValues?.[1]?.value || 0) };
    }).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchAnalytics(propertyId, token, now = new Date()) {
    const current = { startDate: isoDate(daysAgo(7, now)), endDate: isoDate(daysAgo(1, now)) };
    const previous = { startDate: isoDate(daysAgo(14, now)), endDate: isoDate(daysAgo(8, now)) };

    const [batch, daily] = await Promise.all([
        dataApi(`properties/${propertyId}:batchRunReports`, token, {
            requests: [
                { dateRanges: [current, previous], metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration'].map(name => ({ name })) },
                { dateRanges: [current], dimensions: [{ name: 'pageTitle' }, { name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 25 },
                { dateRanges: [current], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 },
                { dateRanges: [current], dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 4 },
                { dateRanges: [current], dimensions: [{ name: 'country' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 6 }
            ]
        }),
        dataApi(`properties/${propertyId}:runReport`, token, {
            dateRanges: [current], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 14
        })
    ]);

    const reports = batch.reports || [];
    const overview = parseOverview(reports[0]);
    return {
        propertyId,
        period: { current, previous },
        current: overview.current,
        previous: overview.previous,
        topPages: parseTopPages(reports[1]),
        channels: rowsToList(reports[2], 0).map(r => ({ name: r.name, sessions: r.value })),
        devices: rowsToList(reports[3], 0).map(r => ({ name: r.name, sessions: r.value })),
        countries: rowsToList(reports[4], 0).map(r => ({ name: r.name, users: r.value })),
        daily: parseDaily(daily)
    };
}

function comparison(current, previous) {
    if (!previous) return current ? 'new activity compared with the previous week' : 'no change from the previous week';
    const percent = Math.round(((current - previous) / previous) * 100);
    return `${Math.abs(percent)}% ${percent >= 0 ? 'higher' : 'lower'} than the previous week`;
}

function successResult(data, extra = {}) {
    const c = data.current;
    return {
        status: 'pass',
        details: `Last 7 days: ${c.users.toLocaleString()} active users, ${c.sessions.toLocaleString()} sessions and ${c.pageViews.toLocaleString()} page views. Sessions were ${comparison(c.sessions, data.previous.sessions)}.`,
        evidence: {
            propertyId: data.propertyId,
            // Legacy keys kept so older reports and the monthly summary keep working.
            currentPeriod: { start: data.period.current.startDate, end: data.period.current.endDate, activeUsers: c.users, sessions: c.sessions, pageViews: c.pageViews },
            previousPeriod: { start: data.period.previous.startDate, end: data.period.previous.endDate, activeUsers: data.previous.users, sessions: data.previous.sessions, pageViews: data.previous.pageViews },
            analytics: data,
            ...extra
        }
    };
}

// -----------------------------------------------------------------------------
// Diagnosis (admin-facing, plain English)
// -----------------------------------------------------------------------------
function buildDiagnosis(code, { storedId, discovery, match, host } = {}) {
    host = hostOf(host) || host || '';
    const email = getServiceAccountEmail();
    const base = { code, serviceAccountEmail: email, storedId: storedId || null, looksLikeStreamId: looksLikeStreamId(storedId), suggestedPropertyId: match?.matched ? match.propertyId : null, matchReason: match?.reason || null, candidates: match?.candidates || null };
    const enable = discovery && discovery.available === false && discovery.reason === 'ADMIN_API_DISABLED'
        ? { adminApiDisabled: true, activationUrl: discovery.activationUrl || 'https://console.developers.google.com/apis/api/analyticsadmin.googleapis.com/overview' }
        : {};
    const streamHint = base.looksLikeStreamId ? ` The saved number (${storedId}) is ${String(storedId).length} digits long. Property IDs are normally 9 digits, so this looks like a Data Stream ID instead.` : '';

    switch (code) {
        case 'NOT_CONFIGURED':
            return { ...base, ...enable, title: 'Google Analytics is not connected yet', plain: `No Google Analytics Property ID is saved for this client${host ? ` (${host})` : ''}.`, steps: ['Ask the client for access, or open their Google Analytics → Admin → Property settings and copy the PROPERTY ID (the number in the top-right).', `In Google Analytics → Admin → Property access management, add ${email || 'the reporting account'} as a Viewer.`, 'Save the Property ID on the client service, then press "Test Google Analytics" to confirm.'] };
        case 'NO_ACCESS':
        case 'NOT_FOUND':
        case 'BAD_ID':
            return { ...base, ...enable, title: 'Google will not let our reporting account read this property', plain: `Google refused access to property ${storedId}.${streamHint} It means either the number is not a Property ID, or ${email || 'the reporting account'} has not been added to that property as a Viewer.`, steps: [
                'In Google Analytics, open Admin → Property settings and copy the PROPERTY ID (not the Stream ID, not the "G-" Measurement ID).',
                `Open Admin → Property access management and make sure ${email || 'the reporting account'} is added with the Viewer role.`,
                ...(enable.adminApiDisabled ? [`Optional, but recommended: enable the "Google Analytics Admin API" for our Google Cloud project (${enable.activationUrl}). Once it is on, the system finds and corrects the right Property ID by itself.`] : []),
                'Save the Property ID on the client service and press "Test Google Analytics".'
            ] };
        case 'DATA_API_DISABLED':
            return { ...base, title: 'The Google Analytics Data API is switched off', plain: 'Our Google Cloud project has the Google Analytics Data API turned off, so no client can be reported on.', steps: [`Enable the "Google Analytics Data API" for the project${discovery?.activationUrl ? `: ${discovery.activationUrl}` : ''}.`], enableUrl: discovery?.activationUrl || null };
        case 'CREDENTIALS':
            return { ...base, title: 'The reporting account credentials are missing or invalid', plain: 'GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON (or _BASE64) is not set correctly on the server.', steps: ['Check the Railway variable GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON.'] };
        case 'QUOTA':
            return { ...base, title: 'Google is rate-limiting us right now', plain: 'Google Analytics asked us to slow down. This normally clears by itself.', steps: ['No action needed — the next report will retry.'] };
        case 'NETWORK':
            return { ...base, title: 'Could not reach Google just now', plain: 'A temporary connection problem stopped the Google Analytics request.', steps: ['No action needed — the next report will retry.'] };
        case 'OWNERSHIP_MISMATCH':
            return { ...base, title: 'This property does not look like it belongs to this website', plain: `Property ${storedId} is attached to a different website than ${host || 'this client'}. Its numbers were withheld so another business's traffic is never shown to this client.`, steps: ['Open the client’s Google Analytics and copy the correct PROPERTY ID.', 'Save it on the client service and press "Test Google Analytics".'] };
        default:
            return { ...base, title: 'Google Analytics could not be read', plain: 'An unexpected problem stopped the Google Analytics request.', steps: ['Press "Test Google Analytics" for more detail, or check the server logs.'] };
    }
}

// -----------------------------------------------------------------------------
// The check used by the weekly report
// -----------------------------------------------------------------------------
/**
 * @param {string} propertyValue  GA4 property id saved on the client service
 * @param {object} ctx            { websiteUrl, domain, getMeasurementIds(), onHealed(newId, info) }
 */
async function googleAnalyticsTrafficCheck(propertyValue, ctx = {}) {
    let propertyId = cleanPropertyId(propertyValue);
    const host = ctx.websiteUrl || ctx.domain || '';
    const measurementIds = typeof ctx.getMeasurementIds === 'function' ? (await ctx.getMeasurementIds().catch(() => [])) : (ctx.measurementIds || []);

    const failure = (code, extra = {}) => ({
        status: 'skip',
        details: `Google Analytics could not be read (${code})`,
        evidence: { configIssue: true, propertyId: propertyId || null, diagnosis: buildDiagnosis(code, { storedId: propertyId, host, ...extra }) }
    });

    let healedFrom = null;
    let token;
    try {
        token = await getAccessToken();
    } catch (error) {
        return failure(classifyGaError(error).code);
    }

    // No property saved: try to find it from the website before giving up.
    if (!/^\d+$/.test(propertyId)) {
        const discovery = await discoverProperties();
        const match = matchProperty(discovery, { measurementIds, host });
        if (match.matched) {
            propertyId = match.propertyId;
            healedFrom = { from: null, reason: match.reason, displayName: match.displayName };
        } else {
            return failure('NOT_CONFIGURED', { discovery, match });
        }
    }

    const attempt = async id => fetchAnalytics(id, token);

    try {
        const data = await attempt(propertyId);
        const extra = {};
        if (healedFrom) {
            extra.autoCorrected = { from: healedFrom.from, to: propertyId, reason: healedFrom.reason };
            if (typeof ctx.onHealed === 'function') await Promise.resolve(ctx.onHealed(propertyId, extra.autoCorrected)).catch(() => {});
        }
        // Privacy guard: never show a client another business's traffic. It needs Google's Admin
        // API (to see which website a property belongs to); discovery is cached, and when the API
        // is off the guard simply cannot run.
        const discovery = await discoverProperties();
        if (discovery.available) {
            const verdict = verifyOwnership(discovery, propertyId, { measurementIds, host });
            extra.ownership = verdict;
            if (verdict === 'mismatch') return failure('OWNERSHIP_MISMATCH');
        }
        return successResult(data, extra);
    } catch (error) {
        const classified = classifyGaError(error);

        if (REPAIRABLE.has(classified.code)) {
            const discovery = await discoverProperties();
            const match = matchProperty(discovery, { storedId: propertyId, measurementIds, host });
            if (match.matched && match.propertyId !== propertyId) {
                try {
                    const data = await attempt(match.propertyId);
                    const corrected = { from: propertyId, to: match.propertyId, reason: match.reason };
                    if (typeof ctx.onHealed === 'function') await Promise.resolve(ctx.onHealed(match.propertyId, corrected)).catch(() => {});
                    return successResult(data, { autoCorrected: corrected, ownership: 'verified' });
                } catch (retryError) {
                    return failure(classifyGaError(retryError).code, { discovery, match });
                }
            }
            return failure(classified.code, { discovery, match });
        }
        if (classified.code === 'DATA_API_DISABLED') return failure(classified.code, { discovery: { activationUrl: classified.activationUrl } });
        return failure(classified.code);
    }
}

/**
 * Admin "Test Google Analytics" button: explains exactly what is wrong, in plain English,
 * and offers a corrected Property ID when one can be proven.
 */
async function diagnoseGaConnection({ propertyId, websiteUrl, domain, measurementIds = [] } = {}) {
    const id = cleanPropertyId(propertyId);
    const host = websiteUrl || domain || '';
    const result = { serviceAccountEmail: getServiceAccountEmail(), propertyId: id || null, checkedAt: new Date().toISOString() };

    let token;
    try { token = await getAccessToken(); }
    catch (error) { return { ...result, ok: false, diagnosis: buildDiagnosis(classifyGaError(error).code) }; }

    const discovery = await discoverProperties({ force: true });
    result.discovery = discovery.available
        ? { available: true, propertiesVisible: discovery.properties.length }
        : { available: false, reason: discovery.reason, activationUrl: discovery.activationUrl };
    const match = matchProperty(discovery, { storedId: id, measurementIds, host });
    result.match = match;

    if (!/^\d+$/.test(id)) {
        return { ...result, ok: false, diagnosis: buildDiagnosis('NOT_CONFIGURED', { discovery, match, host }) };
    }
    try {
        const data = await fetchAnalytics(id, token);
        result.ok = true;
        result.sample = { visitors: data.current.users, visits: data.current.sessions, pageViews: data.current.pageViews };
        result.ownership = verifyOwnership(discovery, id, { measurementIds, host });
        if (result.ownership === 'mismatch') {
            return { ...result, ok: false, diagnosis: buildDiagnosis('OWNERSHIP_MISMATCH', { storedId: id, host, discovery, match }) };
        }
        return result;
    } catch (error) {
        const code = classifyGaError(error).code;
        return { ...result, ok: false, diagnosis: buildDiagnosis(code, { storedId: id, discovery, match, host }) };
    }
}

module.exports = {
    googleAnalyticsTrafficCheck,
    diagnoseGaConnection,
    discoverProperties,
    getServiceAccountEmail,
    _internals: { classifyGaError, matchProperty, verifyOwnership, parseOverview, parseTopPages, parseDaily, rowsToList, looksLikeStreamId, buildDiagnosis, cleanPropertyId, daysAgo, hostOf, comparison, resetDiscoveryCache: () => { discoveryCache = { at: 0, ttl: 0, value: null }; }, setDiscoveryCache: value => { discoveryCache = { at: Date.now(), ttl: 60000, value }; } }
};
