/**
 * Google PageSpeed Insights (Lighthouse) check. Optional: it only runs when PAGESPEED_API_KEY is
 * set on the server (Google's shared keyless quota is exhausted almost immediately). Without a
 * key the check is left out of the report entirely rather than reported as "skipped".
 */
const { fetchPage } = require('./pageFetch');

const API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const AUDIT_IDS = [
    'first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'speed-index',
    'uses-optimized-images', 'modern-image-formats', 'offscreen-images', 'unused-javascript', 'unused-css-rules',
    'render-blocking-resources', 'uses-text-compression', 'unminified-javascript', 'unminified-css',
    'server-response-time', 'uses-responsive-images', 'efficiently-encode-images', 'total-byte-weight'
];

function isConfigured() {
    return !!process.env.PAGESPEED_API_KEY;
}

function buildUrl(target, { withFields }) {
    const params = new URLSearchParams({ url: target, strategy: 'mobile', category: 'performance', key: process.env.PAGESPEED_API_KEY });
    if (withFields) {
        params.set('fields', `lighthouseResult(categories/performance/score,audits(${AUDIT_IDS.map(id => `${id}(title,score,numericValue,details/overallSavingsMs)`).join(',')}))`);
    }
    return `${API}?${params.toString()}`;
}

function parsePagespeed(json) {
    const lh = json?.lighthouseResult;
    const rawScore = lh?.categories?.performance?.score;
    if (typeof rawScore !== 'number') return null;
    const audits = lh.audits || {};
    const ms = id => (typeof audits[id]?.numericValue === 'number' ? Math.round(audits[id].numericValue) : null);
    const opportunities = Object.entries(audits)
        .map(([id, a]) => ({ id, title: a?.title || id, savingsMs: Math.round(a?.details?.overallSavingsMs || 0), score: a?.score }))
        .filter(o => o.savingsMs >= 300 && o.score !== null && o.score < 0.9)
        .sort((a, b) => b.savingsMs - a.savingsMs)
        .slice(0, 3);
    const cls = audits['cumulative-layout-shift']?.numericValue;
    return {
        score: Math.round(rawScore * 100),
        strategy: 'mobile',
        fcpMs: ms('first-contentful-paint'),
        lcpMs: ms('largest-contentful-paint'),
        tbtMs: ms('total-blocking-time'),
        speedIndexMs: ms('speed-index'),
        cls: typeof cls === 'number' ? Math.round(cls * 1000) / 1000 : null,
        opportunities
    };
}

async function pagespeedCheck(_target, ctx) {
    if (!isConfigured()) return { status: 'skip', details: 'PageSpeed API key is not configured', evidence: { reason: 'no-key' } };
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return { status: 'skip', details: 'Not checked because the website could not be reached', evidence: { reason: 'unreachable' } };

    const attempt = (withFields, maxBytes) => fetchPage(buildUrl(snap.finalUrl, { withFields }), {
        timeoutMs: 55000, maxBytes, headers: { Accept: 'application/json' }
    });
    let res = await attempt(true, 3_000_000);
    if (res.ok && res.status === 400) res = await attempt(false, 8_000_000);
    if (!res.ok || res.status !== 200) {
        const quota = res.status === 429;
        return { status: 'skip', details: `PageSpeed result unavailable (${quota ? 'quota' : res.error || `HTTP ${res.status}`})`, evidence: { reason: quota ? 'quota' : 'unavailable' } };
    }
    let parsed = null;
    try { parsed = parsePagespeed(JSON.parse(res.html)); } catch (_) { /* fall through */ }
    if (!parsed) return { status: 'skip', details: 'PageSpeed returned an unreadable result', evidence: { reason: 'unreadable' } };

    // A low Lighthouse score is advice, not an outage: never scored as a failure.
    const status = parsed.score >= 70 ? 'pass' : 'warn';
    return { status, details: `Google PageSpeed (mobile): ${parsed.score}/100`, evidence: parsed };
}

module.exports = { pagespeedCheck, isConfigured, parsePagespeed };
