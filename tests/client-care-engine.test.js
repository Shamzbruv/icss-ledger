const test = require('node:test');
const assert = require('node:assert/strict');

// The Client Care modules load the Supabase-backed service; these inert values let the pure
// logic under test load without contacting a database.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const { analyzeHtml, analyzeRobots, analyzeSitemap } = require('../src/services/checks/htmlAnalysis');
const { _internals: ga } = require('../src/services/checks/analyticsChecks');
const { isMeaningfullyBehind } = require('../src/services/checks/siteChecks');
const { parseRdap, registrableDomain } = require('../src/services/checks/domainChecks');
const { parsePagespeed } = require('../src/services/checks/pagespeedCheck');
const { TIERS, resolveTier, greetingFor } = require('../src/services/care/carePlans');
const { explainItem, fmt } = require('../src/services/care/careExplainers');
const { buildAnalyticsSection, describeChange, friendlyPageName } = require('../src/services/care/careAnalytics');
const { scoreResults, buildWeeklyReport, buildMonthlyReport, diffAgainstPrevious } = require('../src/services/care/careReport');
const { renderWeeklyHtml, renderWeeklyText, renderMonthlyHtml, renderAdminAlert } = require('../src/services/care/careReportEmail');
const { planChecksFor, targetsFor, collectAlertReasons } = require('../src/services/clientCarePulseService');

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
const HOME_HTML = `<!doctype html><html lang="en"><head>
<title>Sky Beach &amp; Bar | Hopewell</title>
<meta name="description" content="Dine by the sea &mdash; fresh seafood.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="WordPress 6.2.1">
<meta property="og:image" content="https://example.com/share.jpg">
<link rel="icon" href="/favicon.ico">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDE12345"></script>
<script src="/wp-content/plugins/contact-form-7/includes/js/index.js?ver=5.7.1"></script>
<script type="application/ld+json">{}</script>
</head><body>
<h1>Taste the sea</h1>
<img src="/a.jpg" alt="A plate of fish"><img src="/b.jpg"><img src="/c.jpg" alt="">
<a href="/menu">Menu</a> <a href="https://www.facebook.com/skybeach">Facebook</a> <a href="tel:+18765550123">Call</a> <a href="mailto:hi@example.com">Email</a>
<a href="https://wa.me/18765550123">WhatsApp</a>
<img src="http://insecure.example.com/x.png" alt="x">
<form action="/contact"></form>
<p>${'word '.repeat(300)}</p>
</body></html>`;

function item(code, status, evidence = {}, extra = {}) {
    return { item_code: code, label: code, status, details: `${code} ${status}`, evidence, engine: 2, ...extra };
}

const SERVICE = (tierCode, meta = {}) => ({
    id: 'svc-1',
    service_meta_json: { plan_code: tierCode, website_url: 'https://www.example.com/', domain: 'example.com', contact_name: 'Clive Brown', ...meta },
    service_plans: { name: TIERS[tierCode].name },
    frequency: 'weekly'
});

const HEALTHY = [
    item('UPTIME', 'pass', { statusCode: 200, ttfbMs: 300, finalUrl: 'https://www.example.com/', attempts: 1 }),
    item('PERF_LIGHT', 'pass', { ttfb: 300, totalDuration: 520, sizeBytes: 60000, compression: 'gzip', scriptCount: 4, imageCount: 6 }),
    item('SSL', 'pass', { validTo: '2027-04-07T00:00:00.000Z', daysRemaining: 184, issuer: "Let's Encrypt" }),
    item('HTTPS_REDIRECT', 'pass', { redirectsToHttps: true }),
    item('MOBILE_READY', 'pass', {}),
    item('PAGE_PROFILE', 'info', {
        url: 'https://www.example.com/', host: 'www.example.com', title: 'Sky Beach & Bar | Hopewell', titleLength: 25,
        description: 'Dine by the sea.', descriptionLength: 16, h1: 'Taste the sea', h1Count: 1, h2Count: 3, wordCount: 437,
        imagesTotal: 12, imagesMissingAlt: 0, linkCount: 14, internalLinkCount: 9,
        contact: { phone: false, email: true, form: true, whatsapp: true }, social: ['Facebook'], hasMapsLink: false,
        hasOpenGraphImage: false, hasFavicon: true, structuredData: 0, mobileReady: true, platform: 'WordPress', behindCloudflare: false, https: true, hasTracking: true, gaIds: ['G-ABCDE12345']
    }),
    item('ANALYTICS_TAG', 'pass', { installed: true, gaIds: ['G-ABCDE12345'], gtmIds: [] })
];

const GA_OK = item('GA_TRAFFIC', 'pass', {
    analytics: {
        propertyId: '123456789', period: { current: { startDate: '2026-09-28', endDate: '2026-10-04' }, previous: { startDate: '2026-09-21', endDate: '2026-09-27' } },
        current: { users: 214, newUsers: 150, sessions: 300, pageViews: 620, engagementRate: 0.62, avgSessionSeconds: 80 },
        previous: { users: 190, newUsers: 120, sessions: 270, pageViews: 500, engagementRate: 0.6, avgSessionSeconds: 75 },
        topPages: [{ title: 'Menu | Sky Beach & Bar', path: '/menu', views: 200, users: 150 }, { title: 'Sky Beach & Bar', path: '/', views: 150, users: 140 }],
        channels: [{ name: 'Organic Search', sessions: 200 }, { name: 'Direct', sessions: 100 }],
        devices: [{ name: 'mobile', sessions: 220 }, { name: 'desktop', sessions: 80 }],
        countries: [{ name: 'Jamaica', users: 150 }, { name: 'United States', users: 50 }],
        daily: [{ date: '2026-09-28', sessions: 30 }, { date: '2026-09-29', sessions: 60 }, { date: '2026-09-30', sessions: 40 }]
    }
});

const GA_BROKEN = item('GA_TRAFFIC', 'skip', {
    configIssue: true, propertyId: '15838977471',
    diagnosis: { code: 'NO_ACCESS', title: 'Google will not let our reporting account read this property', plain: 'Google refused access to property 15838977471.', steps: ['Fix it'], serviceAccountEmail: 'reader@example.iam.gserviceaccount.com' }
});

// -----------------------------------------------------------------------------
// HTML analysis
// -----------------------------------------------------------------------------
test('analyzeHtml extracts the facts the report is built from', () => {
    const a = analyzeHtml(HOME_HTML, 'https://www.example.com/');
    assert.equal(a.title, 'Sky Beach & Bar | Hopewell');
    assert.equal(a.description, 'Dine by the sea — fresh seafood.');
    assert.deepEqual(a.h1, ['Taste the sea']);
    assert.equal(a.hasResponsiveViewport, true);
    assert.equal(a.images.total, 4);
    assert.equal(a.images.missingAltAttribute, 1, 'alt="" is decorative; only a missing alt attribute counts');
    assert.equal(a.images.emptyAlt, 1);
    assert.equal(a.hasPhoneLink, true);
    assert.equal(a.hasEmailLink, true);
    assert.equal(a.formCount, 1);
    assert.deepEqual(a.tracking.gaIds, ['G-ABCDE12345']);
    assert.equal(a.cms.name, 'WordPress');
    assert.equal(a.cms.version, '6.2.1');
    assert.deepEqual(a.cms.plugins.map(p => `${p.slug}@${p.version}`), ['contact-form-7@5.7.1']);
    assert.equal(a.mixedContent.length, 1);
    assert.ok(a.wordCount >= 300);
    assert.equal(a.structuredData, 1);
    assert.equal(a.openGraph.image, 'https://example.com/share.jpg');
    assert.ok(a.links.some(l => l.url === 'https://www.example.com/menu' && l.internal));
    assert.ok(a.links.some(l => l.url.startsWith('https://www.facebook.com') && !l.internal));
});

test('analyzeHtml survives hostile or broken markup without hanging', () => {
    const started = Date.now();
    const nasty = `<title>${'<'.repeat(50000)}</title>` + '<a href="x"'.repeat(20000) + '<img '.repeat(20000) + '<meta content='.repeat(20000);
    const a = analyzeHtml(nasty, 'https://example.com');
    assert.ok(typeof a.title === 'string');
    assert.ok(Date.now() - started < 3000, 'analysis must stay fast on garbage input');
    assert.doesNotThrow(() => analyzeHtml('', 'not a url'));
    assert.doesNotThrow(() => analyzeHtml(null, undefined));
});

test('robots.txt and sitemap parsing', () => {
    assert.equal(analyzeRobots('User-agent: *\nDisallow: /').blocksEverything, true);
    assert.equal(analyzeRobots('User-agent: *\nDisallow: /private/\nSitemap: https://e.com/sitemap.xml').blocksEverything, false);
    assert.deepEqual(analyzeRobots('User-agent: *\nDisallow:\nSitemap: https://e.com/s.xml').sitemaps, ['https://e.com/s.xml']);
    assert.equal(analyzeRobots('User-agent: *\nDisallow: /\nAllow: /public').blocksEverything, false);
    const sm = analyzeSitemap('<urlset><url><loc>https://e.com/</loc><lastmod>2026-01-02</lastmod></url><url><loc>https://e.com/a?x=1&amp;y=2</loc></url></urlset>');
    assert.equal(sm.urlCount, 2);
    assert.equal(sm.entries[1].loc, 'https://e.com/a?x=1&y=2');
    assert.equal(sm.entries[0].lastmod, '2026-01-02');
    assert.equal(analyzeSitemap('<sitemapindex><sitemap><loc>https://e.com/p.xml</loc></sitemap></sitemapindex>').isIndex, true);
});

test('update comparisons and domain helpers', () => {
    assert.equal(isMeaningfullyBehind('6.2.1', '6.5.3'), true);
    assert.equal(isMeaningfullyBehind('6.5.1', '6.5.3'), false, 'a patch-level gap is not alarming');
    assert.equal(isMeaningfullyBehind('5.9', '6.1'), true);
    assert.equal(isMeaningfullyBehind('', '6.1'), false);
    assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
    assert.equal(registrableDomain('www.skybeachja.com'), 'skybeachja.com');
    assert.equal(registrableDomain('app.thing.com.jm'), 'thing.com.jm');
    const rdap = parseRdap({ events: [{ eventAction: 'expiration', eventDate: '2034-06-01T00:00:00Z' }, { eventAction: 'registration', eventDate: '2020-06-01T00:00:00Z' }], entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'GoDaddy.com, LLC']]] }], status: ['client transfer prohibited'] });
    assert.equal(rdap.expiresAt, '2034-06-01T00:00:00Z');
    assert.equal(rdap.registrar, 'GoDaddy.com, LLC');
});

test('PageSpeed results are parsed defensively', () => {
    assert.equal(parsePagespeed({}), null);
    const parsed = parsePagespeed({ lighthouseResult: { categories: { performance: { score: 0.72 } }, audits: {
        'largest-contentful-paint': { numericValue: 2400.4 }, 'cumulative-layout-shift': { numericValue: 0.0123 },
        'unused-javascript': { title: 'Reduce unused JavaScript', score: 0.2, details: { overallSavingsMs: 900 } },
        'uses-text-compression': { title: 'x', score: 1, details: { overallSavingsMs: 5000 } }
    } } });
    assert.equal(parsed.score, 72);
    assert.equal(parsed.lcpMs, 2400);
    assert.equal(parsed.cls, 0.012);
    assert.deepEqual(parsed.opportunities.map(o => o.id), ['unused-javascript'], 'already-passing audits are not "opportunities"');
});

// -----------------------------------------------------------------------------
// Google Analytics: classification, safe matching, the Stream-ID mix-up
// -----------------------------------------------------------------------------
test('Google errors are classified instead of leaked to clients', () => {
    const c = ga.classifyGaError;
    assert.equal(c({ httpStatus: 403, message: 'User does not have sufficient permissions for this property' }).code, 'NO_ACCESS');
    assert.equal(c({ httpStatus: 404, message: 'not found' }).code, 'NOT_FOUND');
    assert.equal(c({ httpStatus: 400, message: 'bad' }).code, 'BAD_ID');
    assert.equal(c({ httpStatus: 429, message: 'quota' }).code, 'QUOTA');
    assert.equal(c({ message: 'socket hang up' }).code, 'NETWORK');
    assert.equal(c({ gaCode: 'CREDENTIALS', message: 'x' }).code, 'CREDENTIALS');
    const disabled = c({ httpStatus: 403, reason: 'SERVICE_DISABLED', service: 'analyticsadmin.googleapis.com', activationUrl: 'https://console.developers.google.com/apis/api/analyticsadmin.googleapis.com/overview?project=1', message: 'API has not been used in project 1 before or it is disabled.' });
    assert.equal(disabled.code, 'ADMIN_API_DISABLED');
    assert.match(disabled.activationUrl, /analyticsadmin/);
    assert.equal(c({ httpStatus: 403, reason: 'SERVICE_DISABLED', service: 'analyticsdata.googleapis.com', message: 'disabled' }).code, 'DATA_API_DISABLED');
});

test('an 11-digit number is recognised as a Data Stream ID, not a Property ID', () => {
    assert.equal(ga.looksLikeStreamId('15838977471'), true);
    assert.equal(ga.looksLikeStreamId('447328921'), false);
    assert.equal(ga.looksLikeStreamId('4473289211'), false);
    assert.equal(ga.cleanPropertyId(' properties/123456789 '), '123456789');
    const d = ga.buildDiagnosis('NO_ACCESS', { storedId: '15838977471', host: 'https://www.skybeachja.com/' });
    assert.equal(d.looksLikeStreamId, true);
    assert.match(d.plain, /11 digits/);
    assert.match(d.plain, /Stream ID/);
    assert.ok(d.steps.some(s => /Viewer/.test(s)));
});

test('property matching is strict: only a single unambiguous property is ever chosen', () => {
    const index = { available: true, properties: [
        { id: '111111111', displayName: 'Sky Beach', streams: [{ streamId: '15838977471', type: 'WEB_DATA_STREAM', host: 'skybeachja.com', measurementId: 'G-6SQ86DFT9N' }] },
        { id: '222222222', displayName: 'Hoilett', streams: [{ streamId: '15776167966', type: 'WEB_DATA_STREAM', host: 'hoilettstechnicalservices.com', measurementId: 'G-PVZYWDVXRJ' }] },
        { id: '333333333', displayName: 'Dup A', streams: [{ streamId: '1', type: 'WEB_DATA_STREAM', host: 'shared.com', measurementId: 'G-DUPLICATE1' }] },
        { id: '444444444', displayName: 'Dup B', streams: [{ streamId: '2', type: 'WEB_DATA_STREAM', host: 'shared.com', measurementId: 'G-DUPLICATE2' }] }
    ] };
    const byStream = ga.matchProperty(index, { storedId: '15838977471', measurementIds: [], host: '' });
    assert.deepEqual([byStream.matched, byStream.propertyId, byStream.reason], [true, '111111111', 'stream-id']);
    const byTag = ga.matchProperty(index, { storedId: '', measurementIds: ['G-PVZYWDVXRJ'], host: 'x.com' });
    assert.deepEqual([byTag.matched, byTag.propertyId, byTag.reason], [true, '222222222', 'measurement-id']);
    const byHost = ga.matchProperty(index, { host: 'https://www.skybeachja.com/' });
    assert.deepEqual([byHost.matched, byHost.propertyId, byHost.reason], [true, '111111111', 'domain']);
    const ambiguous = ga.matchProperty(index, { host: 'shared.com' });
    assert.equal(ambiguous.matched, false);
    assert.equal(ambiguous.reason, 'ambiguous');
    assert.equal(ga.matchProperty(index, { host: 'nobody.com' }).matched, false);
    assert.equal(ga.matchProperty({ available: false }, { host: 'skybeachja.com' }).matched, false);
});

test('privacy guard: another business\'s property is never shown to a client', () => {
    const index = { available: true, properties: [
        { id: '111111111', streams: [{ type: 'WEB_DATA_STREAM', host: 'other-business.com', measurementId: 'G-OTHER00001' }] },
        { id: '222222222', streams: [{ type: 'WEB_DATA_STREAM', host: 'skybeachja.com', measurementId: 'G-6SQ86DFT9N' }] },
        { id: '333333333', streams: [] }
    ] };
    assert.equal(ga.verifyOwnership(index, '111111111', { measurementIds: ['G-6SQ86DFT9N'], host: 'skybeachja.com' }), 'mismatch');
    assert.equal(ga.verifyOwnership(index, '222222222', { measurementIds: ['G-6SQ86DFT9N'], host: 'skybeachja.com' }), 'verified');
    assert.equal(ga.verifyOwnership(index, '333333333', { measurementIds: ['G-6SQ86DFT9N'], host: 'skybeachja.com' }), 'unknown');
    assert.equal(ga.verifyOwnership(index, '111111111', { measurementIds: [], host: '' }), 'unknown', 'one signal is not enough to withhold data');
    assert.equal(ga.verifyOwnership({ available: false }, '111111111', {}), 'unknown');
});

test('Google Analytics responses are parsed into plain numbers', () => {
    const overview = ga.parseOverview({ rows: [
        { dimensionValues: [{ value: 'date_range_0' }], metricValues: ['10', '4', '12', '30', '0.5', '61.2'].map(value => ({ value })) },
        { dimensionValues: [{ value: 'date_range_1' }], metricValues: ['8', '3', '9', '20', '0.4', '50'].map(value => ({ value })) }
    ] });
    assert.deepEqual([overview.current.users, overview.current.sessions, overview.previous.pageViews], [10, 12, 20]);
    const pages = ga.parseTopPages({ rows: [
        { dimensionValues: [{ value: 'Menu' }, { value: '/menu' }], metricValues: [{ value: '5' }, { value: '3' }] },
        { dimensionValues: [{ value: 'Menu' }, { value: '/menu' }], metricValues: [{ value: '4' }, { value: '2' }] },
        { dimensionValues: [{ value: '(not set)' }, { value: '/' }], metricValues: [{ value: '1' }, { value: '1' }] }
    ] });
    assert.deepEqual(pages.map(p => [p.path, p.views]), [['/menu', 9], ['/', 1]]);
    assert.equal(pages[1].title, '');
});

// -----------------------------------------------------------------------------
// Scoring
// -----------------------------------------------------------------------------
test('scoring is weighted, ignores ideas and skipped checks, and caps serious failures', () => {
    assert.equal(scoreResults(HEALTHY).score, 100);
    const withIdeas = [...HEALTHY, item('SECURITY_HEADERS', 'info', { count: 0, total: 5, missing: [] }), item('GA_TRAFFIC', 'skip', { configIssue: true })];
    assert.equal(scoreResults(withIdeas).score, 100, 'info results and a Google Analytics set-up problem never lower the score');
    const down = scoreResults([item('UPTIME', 'fail'), item('SSL', 'pass'), item('PERF_LIGHT', 'pass')]);
    assert.ok(down.score <= 40, `a down website cannot score ${down.score}`);
    assert.equal(down.capped, true);
    const warn = scoreResults([item('UPTIME', 'pass'), item('SSL', 'pass'), item('PERF_LIGHT', 'warn')]);
    assert.ok(warn.score < 100 && warn.score >= 90);
    assert.equal(scoreResults([]).score, 100);
    assert.equal(scoreResults([item('UPTIME', 'skip')]).score, 100);
});

// -----------------------------------------------------------------------------
// Plain-language output
// -----------------------------------------------------------------------------
const JARGON = /\b(TTFB|RDAP|HSTS|CSP|JSON|SSR|payload|HTTP\/\d|stack trace|undefined|NaN|\[object)\b/;

test('every explanation is plain English and never leaks raw errors or "undefined"', () => {
    const env = { tier: TIERS.REFRESH, host: 'example.com', siteUrl: 'https://example.com', alerted: true };
    const samples = [
        item('UPTIME', 'pass', { ttfbMs: 300, finalUrl: 'https://example.com/', attempts: 2 }),
        item('UPTIME', 'fail', { error: 'getaddrinfo ENOTFOUND example.com', errorCode: 'ENOTFOUND', attempts: 2 }),
        item('UPTIME', 'fail', { statusCode: 503 }),
        item('UPTIME', 'warn', { statusCode: 403, blocked: true }),
        item('UPTIME', 'warn', { statusCode: 302, tooManyRedirects: true }),
        item('PERF_LIGHT', 'pass', { totalDuration: 500, sizeBytes: 60000 }),
        item('PERF_LIGHT', 'warn', { totalDuration: 2100, sizeBytes: 3 * 1024 * 1024, compression: null, imageCount: 40, scriptCount: 30 }),
        item('PERF_LIGHT', 'fail', { totalDuration: 4200 }),
        item('SSL', 'pass', { validTo: '2027-01-01T00:00:00Z', daysRemaining: 90, issuer: 'Let\'s Encrypt' }),
        item('SSL', 'warn', { validTo: '2026-10-20T00:00:00Z', daysRemaining: 15 }),
        item('SSL', 'fail', { validTo: '2026-09-01T00:00:00Z', daysRemaining: -4 }),
        item('SSL', 'fail', { daysRemaining: 90, authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID' }),
        item('HTTPS_REDIRECT', 'pass', { redirectsToHttps: true }),
        item('HTTPS_REDIRECT', 'warn', { redirectsToHttps: false }),
        item('MIXED_CONTENT', 'warn', { count: 3 }),
        item('SECURITY_HEADERS', 'info', { count: 1, total: 5, missing: ['Strict-Transport-Security', 'Content-Security-Policy'] }),
        item('DOMAIN_EXPIRY', 'pass', { domain: 'example.com', expiresAt: '2030-01-01T00:00:00Z', daysRemaining: 1200, registrar: 'NameCheap, Inc.' }),
        item('DOMAIN_EXPIRY', 'warn', { domain: 'example.com', expiresAt: '2026-11-01T00:00:00Z', daysRemaining: 30 }),
        item('DOMAIN_EXPIRY', 'fail', { domain: 'example.com', expiresAt: '2026-10-08T00:00:00Z', daysRemaining: 3 }),
        item('DOMAIN_EXPIRY', 'info', { domain: 'example.com.jm', supported: false }),
        item('DNS', 'pass', { host: 'example.com', ip: '1.2.3.4', alternateHost: 'www.example.com', alternateResolves: false }),
        item('EMAIL_DNS', 'warn', { hasMail: true, hasSpf: false }),
        item('SEO_BASICS', 'pass', {}),
        item('SEO_BASICS', 'warn', { description: '', h1Count: 0 }),
        item('SEO_BASICS', 'fail', { noindex: true }),
        item('MOBILE_READY', 'fail', {}),
        item('SITEMAP_ROBOTS', 'info', { sitemapFound: false }),
        item('SITEMAP_ROBOTS', 'fail', { blocksEverything: true }),
        item('IMAGES_ALT', 'warn', { total: 10, missingAlt: 4 }),
        item('CMS_DETECT', 'warn', { platform: 'WordPress', version: '6.2.1', latestVersion: '7.1.2' }),
        item('CMS_DETECT', 'info', { platform: 'Wix' }),
        item('PLUGIN_UPDATES', 'warn', { checked: 3, outdated: [{ name: 'Contact Form 7', installed: '5.1', latest: '6.0' }] }),
        item('BROKEN_LINKS', 'warn', { checked: 14, broken: [{ url: 'https://example.com/old-page', text: 'Old page', status: 404 }], unverifiable: 2 }),
        item('CONTENT_PAGES', 'warn', { pages: [{ path: '/', status: 200, title: 'Home', description: 'x' }, { path: '/about', status: 200, title: '', description: '' }] }),
        item('API_HEALTH', 'fail', { statusCode: 500 }, { label: 'API (https://api.example.com/health)' }),
        item('WEBHOOK', 'fail', { timeout: true })
    ];
    for (const sample of samples) {
        const ex = explainItem(sample, env);
        if (!ex) continue;
        const text = [ex.title, ex.headline, ex.detail, ex.meaning, ex.action].filter(Boolean).join(' | ');
        assert.ok(ex.headline, `${sample.item_code}/${sample.status} needs a headline`);
        assert.doesNotMatch(text, JARGON, `${sample.item_code}/${sample.status}: ${text}`);
        assert.doesNotMatch(text, /sufficient permissions|ENOTFOUND|getaddrinfo|ECONN/i, `raw error leaked: ${text}`);
        assert.doesNotMatch(text, /\s{2,}|\.\./, `bad spacing/punctuation: ${text}`);
        // Terms we do use must be explained in the glossary printed at the bottom of the email.
        if (/\b(SPF|DMARC)\b/.test(text)) assert.ok((ex.glossary || []).includes('spf'), `${sample.item_code} mentions SPF/DMARC without a glossary entry`);
    }
});

test('skipped checks never claim a failure', () => {
    const skipped = explainItem(item('SEO_BASICS', 'skip', { reason: 'unreachable' }), { host: 'x.com' });
    assert.equal(skipped.status, 'skip');
    assert.match(skipped.detail, /couldn't open your website/i);
    assert.equal(explainItem(item('PLUGIN_UPDATES', 'skip', { reason: 'not-wordpress' }), {}), null);
    assert.equal(explainItem(item('PAGESPEED', 'skip', { reason: 'no-key' }), {}), null);
});

test('who fixes what depends on the plan', () => {
    const slow = item('PERF_LIGHT', 'warn', { totalDuration: 2400 });
    const basic = explainItem(slow, { tier: TIERS.HOST_PRO, host: 'x.com', alerted: true });
    const maint = explainItem(slow, { tier: TIERS.MAINT, host: 'x.com', alerted: true });
    const refresh = explainItem(slow, { tier: TIERS.REFRESH, host: 'x.com', alerted: true });
    assert.match(basic.action, /how we can help/i);
    assert.match(maint.action, /up to five website updates/i);
    // Content Refresh: unlimited *content* edits, but technical work still uses the monthly updates.
    assert.match(refresh.action, /up to five website updates/i, 'a speed fix is technical work, not a content edit');
    const content = explainItem(item('SEO_BASICS', 'warn', { description: '', h1Count: 1 }), { tier: TIERS.REFRESH, host: 'x.com', alerted: true });
    assert.match(content.action, /unlimited content edits/i);
    const contentOnMaint = explainItem(item('SEO_BASICS', 'warn', { description: '', h1Count: 1 }), { tier: TIERS.MAINT, host: 'x.com', alerted: true });
    assert.match(contentOnMaint.action, /up to five website updates/i, 'Web Maintenance has no unlimited edits');
    const down = explainItem(item('UPTIME', 'fail', { errorCode: 'ETIMEDOUT' }), { host: 'x.com', alerted: true });
    assert.match(down.action, /already been alerted/);
    const unalerted = explainItem(item('UPTIME', 'fail', { errorCode: 'ETIMEDOUT' }), { host: 'x.com', alerted: false });
    assert.doesNotMatch(unalerted.action, /already been alerted/, 'never claim the team was alerted when the alert did not go out');
});

test('formatting helpers', () => {
    assert.equal(fmt.seconds(400), '0.4 seconds');
    assert.equal(fmt.seconds(1000), '1 second');
    assert.equal(fmt.seconds(2340), '2.3 seconds');
    assert.equal(fmt.seconds(12000), '12 seconds');
    assert.equal(fmt.seconds(null), null);
    assert.equal(fmt.date('2026-12-05T10:00:00Z'), '5 December 2026');
    assert.equal(fmt.bytes(62 * 1024), '62 KB');
    assert.equal(fmt.bytes(1.5 * 1024 * 1024), '1.5 MB');
    assert.equal(fmt.plural(1, 'visit'), '1 visit');
    assert.equal(fmt.plural(1200, 'visit'), '1,200 visits');
    assert.equal(fmt.list(['a', 'b', 'c']), 'a, b and c');
    assert.equal(fmt.duration(80), '1 min 20 sec');
});

// -----------------------------------------------------------------------------
// Visitor section
// -----------------------------------------------------------------------------
test('weekly change is described with care for small numbers', () => {
    assert.equal(describeChange(120, 100).short, 'up 20%');
    assert.equal(describeChange(80, 100).dir, 'down');
    assert.equal(describeChange(101, 100).dir, 'same');
    assert.equal(describeChange(6, 3).long, 'up from 3 last week', 'no "100% more" for tiny numbers');
    assert.equal(describeChange(0, 0).dir, 'same');
    assert.equal(friendlyPageName('Menu | Sky Beach & Bar', '/menu', 'Sky Beach & Bar | Hopewell'), 'Menu');
    assert.equal(friendlyPageName('', '/', ''), 'Home page');
    assert.equal(friendlyPageName('(not set)', '/x', ''), '/x');
});

test('visitor section: detail grows with the plan, and set-up problems never show Google\'s error', () => {
    const base = { gaItem: GA_OK, tagInstalled: true, siteTitle: 'Sky Beach & Bar | Hopewell' };
    const basic = buildAnalyticsSection({ ...base, tier: TIERS.HOST_PRO });
    const dom = buildAnalyticsSection({ ...base, tier: TIERS.HOST_DOM });
    const refresh = buildAnalyticsSection({ ...base, tier: TIERS.REFRESH });
    assert.equal(basic.state, 'ok');
    assert.equal(basic.channels, undefined);
    assert.ok(dom.channels && dom.devices);
    assert.equal(dom.daily, undefined);
    assert.ok(refresh.daily && refresh.countries && refresh.insights.length >= 4);
    assert.equal(basic.tiles[0].value, '214');
    assert.match(basic.headline, /About 214 people/);
    assert.equal(basic.topPages[0].name, 'Menu');

    const broken = buildAnalyticsSection({ gaItem: GA_BROKEN, tagInstalled: true, tier: TIERS.REFRESH });
    assert.equal(broken.state, 'connecting');
    const clientText = JSON.stringify(broken);
    assert.doesNotMatch(clientText, /15838977471|permission|Stream|Viewer|iam\.gserviceaccount|NO_ACCESS/i, 'raw diagnosis must stay admin-only');

    const noTag = buildAnalyticsSection({ gaItem: item('GA_TRAFFIC', 'skip', { configIssue: true, diagnosis: { code: 'NOT_CONFIGURED' } }), tagInstalled: false, tier: TIERS.HOST_PRO });
    assert.equal(noTag.state, 'not-installed');
    assert.match(noTag.action, /reply to this email/i);

    const transient = buildAnalyticsSection({ gaItem: item('GA_TRAFFIC', 'skip', { configIssue: true, diagnosis: { code: 'QUOTA' } }), tagInstalled: true, tier: TIERS.HOST_PRO });
    assert.equal(transient.state, 'unavailable');

    const quiet = buildAnalyticsSection({ gaItem: item('GA_TRAFFIC', 'pass', { analytics: { ...GA_OK.evidence.analytics, current: { users: 0, newUsers: 0, sessions: 0, pageViews: 0, engagementRate: 0, avgSessionSeconds: 0 } } }), tagInstalled: false, tier: TIERS.HOST_PRO });
    assert.equal(quiet.state, 'not-installed', 'a connected property that receives nothing means the tag is missing');

    const legacy = buildAnalyticsSection({ gaItem: item('GA_TRAFFIC', 'pass', { currentPeriod: { start: '2026-09-01', end: '2026-09-07', activeUsers: 5, sessions: 7, pageViews: 9 }, previousPeriod: { activeUsers: 3, sessions: 4, pageViews: 6 } }), tagInstalled: true, tier: TIERS.HOST_PRO });
    assert.equal(legacy.state, 'ok', 'reports built from older stored runs still work');
});

// -----------------------------------------------------------------------------
// The report itself
// -----------------------------------------------------------------------------
function report(tierCode, results, extra = {}) {
    const service = SERVICE(tierCode, extra.meta);
    return buildWeeklyReport({ service, client: { name: 'Sky Beach Restaurant', email: 'c@example.com' }, tier: TIERS[tierCode], results, now: new Date('2026-10-05T12:00:00Z'), periodStart: '2026-09-28T12:00:00Z', periodEnd: '2026-10-05T12:00:00Z', ...extra.args });
}

test('plans resolve to tiers, including legacy names', () => {
    assert.equal(resolveTier({ service_meta_json: { plan_code: 'MAINT' } }).rank, 3);
    assert.equal(resolveTier({ service_plans: { name: 'Professional Hosting' } }).code, 'HOST_PRO');
    assert.equal(resolveTier({ service_plans: { name: 'Hosting + Domain' } }).code, 'HOST_DOM');
    assert.equal(resolveTier({ service_plans: { name: 'Website Content Refresh' } }).code, 'REFRESH');
    assert.equal(resolveTier({ service_plans: { name: 'App Monitoring' } }), null);
    assert.ok(TIERS.HOST_PRO.rank < TIERS.HOST_DOM.rank && TIERS.HOST_DOM.rank < TIERS.MAINT.rank && TIERS.MAINT.rank < TIERS.REFRESH.rank);
    for (const lower of Object.values(TIERS)) {
        for (const higher of Object.values(TIERS)) {
            if (higher.rank > lower.rank) {
                const missing = lower.checks.filter(c => c !== 'PAGESPEED' && !higher.checks.includes(c));
                assert.deepEqual(missing, [], `${higher.name} must include everything ${lower.name} checks`);
            }
        }
    }
});

test('greetings use a first name when confident and the business name otherwise', () => {
    assert.equal(greetingFor({ name: 'Gary Mitchell' }, {}), 'Gary');
    assert.equal(greetingFor({ name: 'Mr. Hoilett' }, {}), 'Mr. Hoilett');
    assert.equal(greetingFor({ name: 'Sky Beach Restaurant' }, {}), 'Sky Beach Restaurant team');
    assert.equal(greetingFor({ name: 'Foryou Skin Bar' }, {}), 'Foryou Skin Bar team');
    assert.equal(greetingFor({ name: 'Sky Beach Restaurant' }, { service_meta_json: { contact_name: 'Clive Brown' } }), 'Clive');
    assert.equal(greetingFor({}, {}), 'there');
});

test('a healthy site gets a calm, specific report', () => {
    const r = report('HOST_DOM', [...HEALTHY, GA_OK]);
    assert.equal(r.health.score, 100);
    assert.equal(r.health.tone, 'great');
    assert.equal(r.attention.length, 0);
    assert.match(r.subject, /all good/);
    assert.match(r.subject, /214 visitors \(up 13%\)/);
    assert.equal(r.meta.greeting, 'Clive');
    assert.ok(r.good.length >= 4);
    assert.ok(r.scoreboard.length >= 3);
    assert.equal(r.adminNotes.length, 0, 'client reports carry no internal notes');
});

test('a problem is explained, scored and addressed', () => {
    const results = HEALTHY.map(r => (r.item_code === 'SSL' ? item('SSL', 'fail', { validTo: '2026-09-30T00:00:00Z', daysRemaining: -5 }) : r));
    const r = report('HOST_PRO', results);
    assert.equal(r.health.tone, 'critical');
    assert.ok(r.health.score <= 60);
    assert.match(r.subject, /Action needed/);
    assert.equal(r.attention[0].code, 'SSL');
    assert.match(r.todo.body, /alerted/i);
    const down = report('HOST_PRO', [item('UPTIME', 'fail', { errorCode: 'ECONNREFUSED' }), ...HEALTHY.filter(h => h.item_code !== 'UPTIME')]);
    assert.match(down.subject, /couldn't open/);
    assert.match(down.health.headline, /down right now/);
    const unalerted = report('HOST_PRO', [item('UPTIME', 'fail', { errorCode: 'ECONNREFUSED' })], { args: { alerted: false } });
    assert.match(unalerted.todo.body, /reply to this email right away/);
});

test('the Google Analytics problem is admin-only and never lowers the client\'s score', () => {
    const asClient = report('REFRESH', [...HEALTHY, GA_BROKEN]);
    assert.equal(asClient.health.score, 100);
    assert.equal(asClient.analytics.state, 'connecting');
    assert.equal(asClient.adminNotes.length, 0);
    const html = renderWeeklyHtml(asClient) + renderWeeklyText(asClient);
    assert.doesNotMatch(html, /sufficient permissions|15838977471|Stream ID|iam\.gserviceaccount/);
    const asAdmin = report('REFRESH', [...HEALTHY, GA_BROKEN], { args: { audience: 'admin' } });
    const noteTitles = asAdmin.adminNotes.map(n => n.title).join(' | ');
    assert.match(noteTitles, /Google Analytics/);
    assert.match(noteTitles, /Cloudflare was not detected/, 'plans that include Cloudflare flag a missing Cloudflare to the team only');
    assert.match(renderWeeklyHtml(asAdmin), /iCreate team only/);
});

test('higher plans say more about the page', () => {
    const results = [...HEALTHY, GA_OK,
        item('SECURITY_HEADERS', 'info', { count: 1, total: 5, missing: [] }),
        item('CMS_DETECT', 'info', { platform: 'WordPress', version: '7.1.2' }),
        item('BROKEN_LINKS', 'pass', { checked: 14, broken: [], unverifiable: 0 }),
        item('SITEMAP_ROBOTS', 'pass', { sitemapFound: true, urlCount: 9, latestModified: '2026-01-01T00:00:00Z' }),
        item('CONTENT_PAGES', 'pass', { pages: [{ path: '/', status: 200, title: 'Home', description: 'x', words: 400, loadMs: 400 }, { path: '/menu', status: 200, title: 'Menu', description: 'x', words: 200, loadMs: 500 }], sampledFrom: 'sitemap' })
    ];
    const sections = tier => new Set(Object.keys(report(tier, results).page).filter(k => report(tier, results).page[k] && (!Array.isArray(report(tier, results).page[k]) || report(tier, results).page[k].length)));
    const basic = sections('HOST_PRO');
    const dom = sections('HOST_DOM');
    const maint = sections('MAINT');
    const refresh = sections('REFRESH');
    assert.ok(basic.has('google') && basic.has('glance'));
    assert.ok(!basic.has('contact') && dom.has('contact'));
    assert.ok(!dom.has('technical') && maint.has('technical'));
    assert.ok(!maint.has('pages') && refresh.has('pages'));
    assert.ok(refresh.has('freshness'));
    const words = tier => renderWeeklyText(report(tier, results)).length;
    assert.ok(words('HOST_PRO') < words('HOST_DOM') && words('HOST_DOM') < words('MAINT') && words('MAINT') < words('REFRESH'), 'each plan should read as more thorough than the one below');
    assert.ok(report('HOST_PRO', results).plan.stepUp, 'lower plans mention the next plan up, honestly');
    assert.equal(report('REFRESH', results).plan.stepUp, null);
});

test('content ideas appear only when the evidence supports them', () => {
    const results = [...HEALTHY, GA_OK, item('SITEMAP_ROBOTS', 'info', { sitemapFound: false })];
    const r = report('REFRESH', results);
    const ideas = r.page.ideas.map(i => i.id);
    assert.ok(ideas.includes('tap-to-call'), 'profile has no tel: link');
    assert.ok(ideas.includes('share-picture'), 'profile has no social preview image');
    assert.ok(ideas.includes('description'), 'the fixture description is only 16 characters long');
    const fuller = report('REFRESH', results.map(h => (h.item_code === 'PAGE_PROFILE' ? { ...h, evidence: { ...h.evidence, description: 'x'.repeat(120), descriptionLength: 120 } } : h)));
    assert.ok(!fuller.page.ideas.some(i => i.id === 'description'), 'a reasonable description needs no idea');
    const tapIdea = r.page.ideas.find(i => i.id === 'tap-to-call');
    assert.match(tapIdea.why, /73% of your visitors/, 'uses the real phone share from Google Analytics');
    const noIdeas = report('HOST_PRO', [...HEALTHY.map(h => (h.item_code === 'PAGE_PROFILE' ? { ...h, evidence: { ...h.evidence, contact: { phone: true, email: true, form: true, whatsapp: true }, hasOpenGraphImage: true, description: 'x'.repeat(120), descriptionLength: 120 } } : h))]);
    assert.equal(noIdeas.page.ideas.length, 0);
});

test('"what changed" only compares like with like', () => {
    const current = [item('UPTIME', 'pass'), item('PERF_LIGHT', 'pass')];
    const legacy = { score: 83, results: [{ item_code: 'UPTIME', status: 'pass' }, { item_code: 'PERF_LIGHT', status: 'warn' }] };
    assert.equal(diffAgainstPrevious(current, legacy), null, 'runs from the old, smaller check suite are not comparable');
    const modern = { score: 90, results: [item('UPTIME', 'pass'), item('PERF_LIGHT', 'warn')] };
    const diff = diffAgainstPrevious(current, modern);
    assert.deepEqual(diff.fixed, ['Page speed']);
    assert.equal(diff.previousScore, 90);
    assert.equal(diffAgainstPrevious(current, null), null);
});

test('track record uses recent history', () => {
    const history = [1, 2, 3, 4].map(() => ({ results: [{ item_code: 'UPTIME', status: 'pass' }] }));
    const r = report('HOST_PRO', HEALTHY, { args: { history } });
    assert.match(r.trackRecord.text, /every one of our last 5 weekly checks/);
    const flaky = report('HOST_PRO', HEALTHY, { args: { history: [{ results: [{ item_code: 'UPTIME', status: 'fail' }] }, ...history] } });
    assert.match(flaky.trackRecord.text, /5 of our last 6/);
    assert.equal(report('HOST_PRO', HEALTHY).trackRecord, null);
});

// -----------------------------------------------------------------------------
// Email markup
// -----------------------------------------------------------------------------
test('the email markup is email-client safe and carries its plain-text twin', () => {
    const results = [...HEALTHY, GA_OK, item('PERF_LIGHT', 'warn', { totalDuration: 2300 })].filter((r, i, all) => all.findIndex(x => x.item_code === r.item_code) === (r.item_code === 'PERF_LIGHT' ? all.length - 1 : i));
    const model = report('REFRESH', results);
    const html = renderWeeklyHtml(model);
    const text = renderWeeklyText(model);
    for (const banned of [/display\s*:\s*flex/i, /display\s*:\s*grid/i, /position\s*:\s*absolute/i, /filter\s*:\s*blur/i, /calc\(/i, /<script/i, /<style/i, /<link\b/i, /@import/i, /javascript:/i]) {
        assert.doesNotMatch(html, banned, `email markup must not contain ${banned}`);
    }
    assert.ok(html.length < 90 * 1024, `HTML is ${html.length} bytes; Gmail clips messages over ~102KB`);
    assert.match(html, /<meta name="color-scheme"/);
    assert.match(html, /lang="en"/);
    assert.doesNotMatch(html, /undefined|\bNaN\b|\[object/);
    assert.doesNotMatch(text, /undefined|\bNaN\b|\[object/);
    assert.doesNotMatch(text, /<[a-z]+[^>]*>/i, 'the plain-text version must not contain markup');
    assert.match(text, /Hello Clive,/);
    assert.match(text, /Phone \/ WhatsApp/);
    // every status is conveyed in words as well as symbols
    assert.match(html, /How to read this email/);
});

test('text from a client\'s own website cannot inject markup into the email', () => {
    const evil = '<img src=x onerror=alert(1)> & "quotes" </td><script>alert(1)</script>';
    const results = HEALTHY.map(r => (r.item_code === 'PAGE_PROFILE' ? { ...r, evidence: { ...r.evidence, title: evil, description: evil, h1: evil } } : r));
    const html = renderWeeklyHtml(report('HOST_DOM', results, { meta: { contact_name: evil } }));
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('a bold marker in text becomes <strong> and nothing else becomes markup', () => {
    const model = report('REFRESH', [...HEALTHY, GA_OK]);
    const html = renderWeeklyHtml(model);
    assert.match(html, /<strong>Menu<\/strong>/);
    assert.doesNotMatch(renderWeeklyText(model), /\*\*/);
});

// -----------------------------------------------------------------------------
// Monthly review and alerts
// -----------------------------------------------------------------------------
test('monthly review is built from real weekly runs', () => {
    const run = (date, score, perf, users, sessions) => ({
        created_at: date, score,
        results_json: [item('UPTIME', 'pass'), item('PERF_LIGHT', perf < 1500 ? 'pass' : 'warn', { totalDuration: perf }),
            item('GA_TRAFFIC', 'pass', { analytics: { ...GA_OK.evidence.analytics, current: { ...GA_OK.evidence.analytics.current, users, sessions, pageViews: sessions * 2 } } })]
    });
    const runs = [run('2026-09-07T12:00:00Z', 90, 600, 40, 50), run('2026-09-14T12:00:00Z', 94, 700, 60, 80), run('2026-09-21T12:00:00Z', 100, 500, 55, 70), run('2026-09-28T12:00:00Z', 100, 800, 70, 90)];
    const m = buildMonthlyReport({ monthStr: '2026-09', runs, summary: { overall_status: 'Mostly Healthy', total_reports_sent: 4, pass_count: 4, warn_count: 0, fail_count: 0 }, client: { name: 'Gary Mitchell' }, service: SERVICE('REFRESH'), tier: TIERS.REFRESH });
    assert.equal(m.meta.monthName, 'September 2026');
    assert.equal(m.availability.ok, 4);
    assert.match(m.availability.text, /online every time/);
    assert.equal(m.speed.averageMs, 650);
    assert.equal(m.traffic.visits, 290);
    assert.equal(m.traffic.weeks, 4);
    assert.equal(m.traffic.lastWeek, 90);
    assert.match(m.subject, /September 2026/);
    assert.match(m.subject, /290 visits/);
    const html = renderMonthlyHtml(m);
    assert.match(html, /290 visits/);
    assert.doesNotMatch(html, /undefined|\bNaN\b|calc\(/);
    // no data at all must still render sensibly
    const empty = buildMonthlyReport({ monthStr: '2026-09', runs: [], summary: { overall_status: 'Mostly Healthy', total_reports_sent: 0 }, client: { name: 'X' }, service: {}, tier: null });
    assert.doesNotThrow(() => renderMonthlyHtml(empty));
});

test('the team is alerted to real failures and to Google set-up problems, but not nagged', () => {
    const service = SERVICE('REFRESH');
    const results = [item('UPTIME', 'fail', {}), item('SSL', 'pass'), GA_BROKEN, item('ANALYTICS_TAG', 'pass')];
    const reasons = collectAlertReasons({ service, results, config: service.service_meta_json });
    assert.deepEqual(reasons.map(r => r.level), ['critical', 'action']);
    assert.match(reasons[1].title, /Google Analytics/);
    assert.equal(reasons[1].serviceAccountEmail, 'reader@example.iam.gserviceaccount.com');
    const recentlyAlerted = collectAlertReasons({ service, results, config: { ...service.service_meta_json, ga_alert_at: new Date().toISOString() } });
    assert.deepEqual(recentlyAlerted.map(r => r.level), ['critical'], 'a Google set-up alert is sent at most once a week');
    const transient = collectAlertReasons({ service, results: [item('UPTIME', 'pass'), item('GA_TRAFFIC', 'skip', { configIssue: true, diagnosis: { code: 'QUOTA' } })], config: {} });
    assert.equal(transient.length, 0);
    const noTagNotConfigured = collectAlertReasons({ service, results: [item('ANALYTICS_TAG', 'info'), item('GA_TRAFFIC', 'skip', { configIssue: true, diagnosis: { code: 'NOT_CONFIGURED' } })], config: {} });
    assert.equal(noTagNotConfigured.length, 0, 'a site with no analytics at all is a sales conversation, not an alert');
    const mail = renderAdminAlert({ clientName: 'Sky Beach', planName: 'Content Refresh', host: 'skybeachja.com', reasons, adminUrl: 'https://x.test/client-care-pulse' });
    assert.match(mail.subject, /^ALERT: Sky Beach/);
    assert.match(mail.html, /reader@example\.iam\.gserviceaccount\.com/);
    assert.ok(!/[\r\n]/.test(mail.subject));
});

// -----------------------------------------------------------------------------
// Check planning
// -----------------------------------------------------------------------------
test('each plan runs its own checks; other plans keep using their template', () => {
    const codes = tier => planChecksFor(SERVICE(tier), TIERS[tier], null).map(c => c.code);
    assert.ok(codes('HOST_PRO').includes('SSL') && !codes('HOST_PRO').includes('DOMAIN_EXPIRY'));
    assert.ok(codes('HOST_DOM').includes('DOMAIN_EXPIRY') && !codes('HOST_DOM').includes('PLUGIN_UPDATES'));
    assert.ok(codes('MAINT').includes('PLUGIN_UPDATES') && !codes('MAINT').includes('CONTENT_PAGES'));
    assert.ok(codes('REFRESH').includes('CONTENT_PAGES'));
    assert.ok(!codes('REFRESH').includes('PAGESPEED') || process.env.PAGESPEED_API_KEY, 'PageSpeed only runs when an API key is configured');
    assert.ok(!codes('REFRESH').includes('API_HEALTH'), 'website plans do not probe the URLs saved as "API URLs"');

    const template = { items_json: [{ code: 'API_HEALTH' }, { code: 'PERF_LIGHT' }, { code: 'REDIRECT' }, { code: 'NOT_A_CHECK' }] };
    const tech = planChecksFor({ service_meta_json: {} }, null, template).map(c => c.code);
    assert.deepEqual(tech, ['API_HEALTH', 'PERF_LIGHT', 'HTTPS_REDIRECT'], 'old REDIRECT items map to the new check and unknown codes are dropped');
});

test('targets come from saved settings, with sensible fallbacks and no false alarms', () => {
    const { CHECKS } = require('../src/services/clientCarePulseService');
    assert.deepEqual(targetsFor(CHECKS.UPTIME, { website_url: 'https://x.com' }).map(t => t.target), ['https://x.com']);
    assert.equal(targetsFor(CHECKS.UPTIME, {}), null);
    assert.deepEqual(targetsFor(CHECKS.SSL, { domain: 'x.com' }).map(t => t.target), ['x.com']);
    assert.deepEqual(targetsFor(CHECKS.SSL, { website_url: 'https://www.y.com/page' }).map(t => t.target), ['www.y.com'], 'the website\'s host is used when no domain is saved');
    assert.equal(targetsFor(CHECKS.SSL, {}), null);
    assert.deepEqual(targetsFor(CHECKS.GA_TRAFFIC, {}).map(t => t.target), [''], 'no property saved still lets the system try to find one');
    const api = targetsFor(CHECKS.API_HEALTH, { api_urls: ['https://a.com/health', 'https://drive.google.com/uc?id={file.id}'] });
    assert.equal(api.length, 2);
    assert.equal(api[0].placeholder, false);
    assert.equal(api[1].placeholder, true, 'template-style URLs are skipped instead of reported as failures');
    assert.equal(targetsFor(CHECKS.API_HEALTH, {}), null);
});

// -----------------------------------------------------------------------------
// Older stored runs, and very large reports
// -----------------------------------------------------------------------------
test('older runs are only used where their meaning has not changed', () => {
    const { isComparable } = require('../src/services/care/careReport');
    assert.equal(isComparable({ item_code: 'UPTIME', status: 'pass' }), true);
    assert.equal(isComparable({ item_code: 'SSL', status: 'warn' }), true);
    assert.equal(isComparable({ item_code: 'REDIRECT', status: 'warn' }), false, 'the old redirect test flagged healthy sites');
    assert.equal(isComparable({ item_code: 'PERF_LIGHT', status: 'pass' }), false, 'the old speed test timed a redirect, not the page');
    assert.equal(isComparable({ item_code: 'PERF_LIGHT', status: 'pass', engine: 2 }), true);

    const legacyRun = (date) => ({
        created_at: date, score: 83,
        results_json: [
            { item_code: 'UPTIME', status: 'pass', evidence: {} },
            { item_code: 'REDIRECT', status: 'warn', evidence: { statusCode: 200 } },
            { item_code: 'PERF_LIGHT', status: 'pass', evidence: { totalDuration: 90 } },
            { item_code: 'GA_TRAFFIC', status: 'pass', evidence: { currentPeriod: { start: '2026-09-01', end: '2026-09-07', activeUsers: 5, sessions: 8, pageViews: 12 }, previousPeriod: { activeUsers: 4, sessions: 6, pageViews: 9 } } }
        ]
    });
    const m = buildMonthlyReport({ monthStr: '2026-09', runs: [legacyRun('2026-09-07T12:00:00Z'), legacyRun('2026-09-14T12:00:00Z')], summary: { overall_status: 'Mostly Healthy', total_reports_sent: 2 }, client: { name: 'X' }, service: SERVICE('HOST_DOM'), tier: TIERS.HOST_DOM });
    assert.equal(m.availability.ok, 2, 'availability is comparable');
    assert.equal(m.speed, null, 'no speed figure from the old timer');
    assert.equal(m.scores.length, 0, 'old scores are not shown next to new ones');
    assert.deepEqual(m.recurring, [], 'the old false "secure forwarding" warning is not presented as a real problem');
    assert.equal(m.traffic.visits, 16, 'visitor numbers from old runs still count');
    assert.equal(m.recommendations.length, 0);
    assert.doesNotThrow(() => renderMonthlyHtml(m));
});

test('even the biggest report stays well under Gmail\'s clipping limit', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ path: `/page-${i}`, status: 200, title: `A fairly long page title number ${i} for testing`, description: 'd'.repeat(150), words: 120, loadMs: 3500, missingAlt: 3 }));
    const results = [
        ...HEALTHY.filter(h => h.item_code !== 'PAGE_PROFILE'),
        { ...HEALTHY.find(h => h.item_code === 'PAGE_PROFILE'), evidence: { ...HEALTHY.find(h => h.item_code === 'PAGE_PROFILE').evidence, title: 'T'.repeat(300), description: 'D'.repeat(400), h1: 'H'.repeat(200) } },
        GA_OK,
        item('DOMAIN_EXPIRY', 'warn', { domain: 'example.com', expiresAt: '2026-11-01T00:00:00Z', daysRemaining: 30, registrar: 'R'.repeat(80) }),
        item('DNS', 'pass', { host: 'example.com', ip: '1.2.3.4', alternateHost: 'www.example.com', alternateResolves: false }),
        item('EMAIL_DNS', 'warn', { hasMail: true, hasSpf: false }),
        item('SECURITY_HEADERS', 'info', { count: 0, total: 5, missing: ['Strict-Transport-Security', 'X-Content-Type-Options', 'Clickjacking protection', 'Referrer-Policy', 'Content-Security-Policy'] }),
        item('MIXED_CONTENT', 'warn', { count: 9 }),
        item('CMS_DETECT', 'warn', { platform: 'WordPress', version: '6.2.1', latestVersion: '7.1.2' }),
        item('PLUGIN_UPDATES', 'warn', { checked: 8, outdated: Array.from({ length: 8 }, (_, i) => ({ name: `Plugin number ${i}`, installed: '1.0', latest: '2.0' })) }),
        item('BROKEN_LINKS', 'fail', { checked: 20, broken: Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/old/${i}`, text: `Old ${i}`, status: 404 })), unverifiable: 3 }),
        item('SITEMAP_ROBOTS', 'info', { sitemapFound: false }),
        item('IMAGES_ALT', 'warn', { total: 30, missingAlt: 12 }),
        item('CONTENT_PAGES', 'warn', { pages: many, sampledFrom: 'sitemap' }),
        item('SEO_BASICS', 'warn', { description: '', h1Count: 0 })
    ];
    const model = report('REFRESH', results);
    const html = renderWeeklyHtml(model);
    assert.ok(Buffer.byteLength(html) < 100 * 1024, `worst-case report is ${Buffer.byteLength(html)} bytes`);
    const adminHtml = renderWeeklyHtml(report('REFRESH', results, { args: { audience: 'admin' } }));
    assert.ok(Buffer.byteLength(adminHtml) < 110 * 1024, 'the admin preview (extra notes box) may be a little larger but is not sent to clients');
});

test('fixes live inside each issue; the suggestions list holds only optional ideas', () => {
    const results = [...HEALTHY.map(r => (r.item_code === 'PERF_LIGHT' ? item('PERF_LIGHT', 'warn', { totalDuration: 2200 }) : r)), GA_OK, item('MIXED_CONTENT', 'warn', { count: 3 })];
    const m = report('MAINT', results);
    assert.equal(m.attention.length, 2);
    assert.ok(m.recommendations.some(r => r.kind === 'issue'), 'issues are still tracked (the monthly review uses them)');
    assert.ok(m.ideas.every(r => r.kind === 'idea'), 'the weekly suggestions never repeat an issue card');
    assert.match(m.todo.body, /2 things are flagged below/);
    const text = renderWeeklyText(m);
    assert.equal((text.match(/Compressing pictures and trimming extras/g) || []).length, 1, 'each fix is stated once');
    const healthy = report('MAINT', [...HEALTHY, GA_OK]);
    assert.match(healthy.todo.body, /optional suggestion/);
    assert.doesNotMatch(healthy.todo.body, /flagged below/);
});

test('a stored report from the old check suite never shows its false alarm as a problem', () => {
    const legacy = [
        { item_code: 'UPTIME', status: 'pass', details: 'ok', evidence: { statusCode: 200, durationMs: 100 } },
        { item_code: 'REDIRECT', status: 'warn', details: 'No redirect detected (Status: 200)', evidence: { statusCode: 200 } },
        { item_code: 'SSL', status: 'pass', details: 'ok', evidence: { validTo: '2027-01-01T00:00:00Z', daysRemaining: 90 } }
    ];
    const m = report('HOST_DOM', legacy);
    assert.equal(m.attention.length, 0, 'the old redirect "warning" is information, not something to look at');
    assert.ok(m.fyi.some(f => f.code === 'REDIRECT'));
    assert.equal(m.health.tone, 'great');
});
