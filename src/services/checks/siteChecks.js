/**
 * Real, outside-in website checks for Client Care reports.
 *
 * Every function returns { status, details, evidence } where status is one of:
 *   pass | warn | fail   - counted in the health score
 *   info                 - good-to-know / ideas, never counted against the score
 *   skip                 - could not be run (e.g. website unreachable); not scored
 * `details` is a short technical summary (logs, admin, legacy consumers). The plain-language
 * wording clients read is generated later from `evidence` by careExplainers.js, so improving
 * the wording improves old and new runs alike.
 *
 * Nothing in here reports a result it did not actually measure.
 */
const dns = require('dns').promises;
const https = require('https');
const { fetchPage } = require('./pageFetch');
const { analyzeHtml, analyzeRobots, analyzeSitemap, normalizeHost } = require('./htmlAnalysis');
const { normalizePublicDomain, resolvePublicHost } = require('./targetSafety');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

// -----------------------------------------------------------------------------
// Shared context: one homepage download is reused by every check in a run.
// -----------------------------------------------------------------------------
function createCheckContext(config = {}) {
    let snapshot = null;
    let analysis = null;
    const cache = new Map();
    return {
        config,
        // Memoizes small shared lookups (robots.txt, sitemap.xml) across checks in one run.
        memo(key, producer) {
            if (!cache.has(key)) cache.set(key, producer());
            return cache.get(key);
        },
        getSnapshot() {
            if (!snapshot) snapshot = fetchPage(config.website_url);
            return snapshot;
        },
        refetch() {
            snapshot = fetchPage(config.website_url);
            analysis = null;
            return snapshot;
        },
        async getAnalysis() {
            const snap = await this.getSnapshot();
            if (!snap.ok || !snap.html) return null;
            if (!analysis) analysis = analyzeHtml(snap.html, snap.finalUrl);
            return analysis;
        }
    };
}

function unreachable(snap) {
    return { status: 'skip', details: 'Not checked because the website could not be reached', evidence: { reason: 'unreachable', error: snap?.error || null } };
}

// -----------------------------------------------------------------------------
// Availability & speed
// -----------------------------------------------------------------------------
async function uptimeCheck(_target, ctx) {
    let snap = await ctx.getSnapshot();
    let attempts = 1;
    // One quick retry before we cry wolf: a single dropped connection is not an outage.
    if (!snap.ok || snap.status >= 500) {
        await sleep(2500);
        snap = await ctx.refetch();
        attempts = 2;
    }
    const base = { attempts, finalUrl: snap.finalUrl, redirectChain: snap.chain || [], ttfbMs: snap.ttfbMs ?? null, totalMs: snap.totalMs ?? null };

    if (!snap.ok) {
        return { status: 'fail', details: `Could not reach the website: ${snap.error}`, evidence: { ...base, error: snap.error, errorCode: snap.errorCode } };
    }
    if (snap.status >= 200 && snap.status < 300) {
        return { status: 'pass', details: `Site is online (Status: ${snap.status})`, evidence: { ...base, statusCode: snap.status, durationMs: snap.totalMs, redirected: (snap.chain || []).length > 0 } };
    }
    if (snap.status >= 300 && snap.status < 400) {
        return { status: 'warn', details: `Site keeps redirecting (Status: ${snap.status})`, evidence: { ...base, statusCode: snap.status, redirectedTo: snap.redirectedTo || null, tooManyRedirects: !!snap.tooManyRedirects } };
    }
    if (snap.status === 401 || snap.status === 403) {
        return { status: 'warn', details: `Site answered but refused our check (Status: ${snap.status})`, evidence: { ...base, statusCode: snap.status, blocked: true } };
    }
    return { status: 'fail', details: `Site returned error status: ${snap.status}`, evidence: { ...base, statusCode: snap.status } };
}

async function performanceCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const analysis = await ctx.getAnalysis();
    const totalDuration = snap.totalMs;
    // This times the homepage document itself (not every picture and script), measured from our
    // server, so the bar is "a second or two", not "instant".
    const status = totalDuration < 1500 ? 'pass' : (totalDuration < 3000 ? 'warn' : 'fail');
    return {
        status,
        details: `TTFB: ${snap.ttfbMs}ms, Total: ${totalDuration}ms`,
        evidence: {
            ttfb: snap.ttfbMs,
            totalDuration,
            sizeBytes: snap.decodedBytes ?? null,
            wireBytes: snap.wireBytes ?? null,
            compression: snap.compression,
            scriptCount: analysis?.scripts.total ?? null,
            imageCount: analysis?.images.total ?? null,
            truncated: !!snap.truncated
        }
    };
}

async function httpsRedirectCheck(target) {
    let host;
    try { host = normalizePublicDomain(target); } catch (error) { return { status: 'skip', details: `Not checked: ${error.message}`, evidence: { reason: 'bad-target' } }; }
    const r = await fetchPage(`http://${host}/`, { headersOnly: true, timeoutMs: 8000, maxRedirects: 4 });
    if (!r.ok) {
        return { status: 'info', details: `Plain http:// is not reachable (${r.error}); browsers will use https://`, evidence: { httpReachable: false, error: r.error } };
    }
    const finalIsHttps = /^https:/i.test(r.finalUrl);
    if (finalIsHttps) {
        const first = r.chain[0];
        return { status: 'pass', details: `http:// visitors are sent to the secure version (Status: ${first?.status || r.status})`, evidence: { redirectsToHttps: true, statusCode: first?.status || r.status, finalUrl: r.finalUrl, hops: r.chain.length, permanent: [301, 308].includes(first?.status) } };
    }
    return { status: 'warn', details: `http:// version does not redirect to https:// (Status: ${r.status})`, evidence: { redirectsToHttps: false, statusCode: r.status, finalUrl: r.finalUrl, hops: r.chain.length } };
}

// -----------------------------------------------------------------------------
// Search visibility & page quality
// -----------------------------------------------------------------------------
async function seoBasicsCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };

    const evidence = {
        title: a.title, titleLength: a.titleLength,
        description: a.description, descriptionLength: a.descriptionLength,
        h1Count: a.h1.length, h1First: a.h1[0] || null,
        noindex: a.noindex, canonical: a.canonical, lang: a.lang,
        hasOpenGraphImage: !!a.openGraph.image, hasFavicon: a.hasFavicon,
        structuredData: a.structuredData, wordCount: a.wordCount
    };
    if (a.noindex) return { status: 'fail', details: 'The homepage tells Google not to list it (noindex)', evidence };
    if (!a.title) return { status: 'fail', details: 'The homepage has no title', evidence };
    const gaps = [];
    if (!a.description) gaps.push('no description');
    if (a.h1.length === 0) gaps.push('no main heading');
    if (gaps.length) return { status: 'warn', details: `Search basics incomplete: ${gaps.join(', ')}`, evidence };
    return { status: 'pass', details: 'Title, description and main heading are all in place', evidence };
}

async function mobileReadyCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };
    if (a.hasResponsiveViewport) return { status: 'pass', details: 'Page is set up to fit phone screens', evidence: { viewport: a.viewport } };
    return { status: 'fail', details: 'Page is missing the mobile viewport setting', evidence: { viewport: a.viewport } };
}

async function securityHeadersCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const h = snap.headers || {};
    const csp = String(h['content-security-policy'] || '');
    const tests = {
        'Strict-Transport-Security': !!h['strict-transport-security'],
        'X-Content-Type-Options': /nosniff/i.test(String(h['x-content-type-options'] || '')),
        'Clickjacking protection': !!h['x-frame-options'] || /frame-ancestors/i.test(csp),
        'Referrer-Policy': !!h['referrer-policy'],
        'Content-Security-Policy': !!csp
    };
    const present = Object.keys(tests).filter(k => tests[k]);
    const missing = Object.keys(tests).filter(k => !tests[k]);
    // Missing extra headers is a recommendation, not a fault: never a warn/fail on its own.
    return {
        status: present.length >= 4 ? 'pass' : 'info',
        details: `${present.length} of ${Object.keys(tests).length} recommended security headers present`,
        evidence: { present, missing, count: present.length, total: Object.keys(tests).length, server: h.server || null, behindCloudflare: isBehindCloudflare(h) }
    };
}

function isBehindCloudflare(headers = {}) {
    return !!headers['cf-ray'] || /cloudflare/i.test(String(headers.server || ''));
}

const SOCIAL_HOSTS = [
    ['Facebook', /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/],
    ['Instagram', /(^|\.)instagram\.com$/],
    ['TikTok', /(^|\.)tiktok\.com$/],
    ['X (Twitter)', /(^|\.)twitter\.com$|(^|\.)x\.com$/],
    ['YouTube', /(^|\.)youtube\.com$|(^|\.)youtu\.be$/],
    ['LinkedIn', /(^|\.)linkedin\.com$/],
    ['WhatsApp', /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/],
    ['Google Maps', /(^|\.)maps\.app\.goo\.gl$|(^|\.)goo\.gl$/]
];

/**
 * A plain snapshot of what the homepage looks like to Google and to visitors. It is an
 * information-only check (never scored): the report uses it to describe the page.
 */
async function pageProfileCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };

    const social = new Set();
    let mapsLink = false;
    a.links.forEach(link => {
        let host = '';
        try { host = new URL(link.url).hostname.toLowerCase(); } catch (_) { return; }
        if (/(^|\.)google\.[a-z.]+$/.test(host) && /\/maps/i.test(link.url)) mapsLink = true;
        SOCIAL_HOSTS.forEach(([name, pattern]) => { if (pattern.test(host)) social.add(name); });
    });
    if (mapsLink) social.add('Google Maps');

    let finalHost = '';
    try { finalHost = new URL(snap.finalUrl).hostname; } catch (_) { /* keep empty */ }
    const internalLinks = a.links.filter(l => l.internal).length;

    return {
        status: 'info',
        details: `Homepage snapshot: "${a.title || 'no title'}", about ${a.wordCount} words, ${a.images.total} images`,
        evidence: {
            url: snap.finalUrl, host: finalHost,
            title: a.title, titleLength: a.titleLength,
            description: a.description, descriptionLength: a.descriptionLength,
            h1: a.h1[0] || null, h1Count: a.h1.length, h2Count: a.h2Count,
            wordCount: a.wordCount,
            imagesTotal: a.images.total, imagesMissingAlt: a.images.missingAltAttribute,
            scriptCount: a.scripts.total,
            linkCount: a.links.length, internalLinkCount: internalLinks,
            contact: { phone: a.hasPhoneLink, email: a.hasEmailLink, form: a.formCount > 0, whatsapp: social.has('WhatsApp') },
            social: [...social].filter(n => n !== 'WhatsApp' && n !== 'Google Maps'),
            hasMapsLink: social.has('Google Maps'),
            hasOpenGraphImage: !!a.openGraph.image, hasFavicon: a.hasFavicon,
            structuredData: a.structuredData, lang: a.lang,
            mobileReady: a.hasResponsiveViewport,
            platform: a.cms.name || null, platformVersion: a.cms.version || null,
            behindCloudflare: isBehindCloudflare(snap.headers || {}),
            https: /^https:/i.test(snap.finalUrl),
            hasTracking: a.tracking.gaIds.length > 0 || a.tracking.gtmIds.length > 0,
            gaIds: a.tracking.gaIds
        }
    };
}

async function mixedContentCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };
    if (!/^https:/i.test(snap.finalUrl)) return { status: 'skip', details: 'Page is not served over https', evidence: { reason: 'not-https' } };
    if (a.mixedContent.length === 0) return { status: 'pass', details: 'Everything on the page loads securely', evidence: { count: 0 } };
    return { status: 'warn', details: `${a.mixedContent.length} item(s) on the page load insecurely`, evidence: { count: a.mixedContent.length, examples: a.mixedContent.slice(0, 5) } };
}

async function imagesAltCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };
    const { total, missingAltAttribute, examplesMissingAlt } = a.images;
    if (total === 0) return { status: 'info', details: 'No images found on the homepage', evidence: { total: 0, missingAlt: 0 } };
    const status = missingAltAttribute === 0 ? 'pass' : 'warn';
    return { status, details: `${missingAltAttribute} of ${total} images have no description text`, evidence: { total, missingAlt: missingAltAttribute, examples: examplesMissingAlt } };
}

async function analyticsTagCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };
    const t = a.tracking;
    const installed = t.gaIds.length > 0 || t.gtmIds.length > 0;
    return {
        status: installed ? 'pass' : 'info',
        details: installed ? `Visitor-counting code found (${[...t.gaIds, ...t.gtmIds].join(', ')})` : 'No visitor-counting code was found on the homepage',
        evidence: { installed, gaIds: t.gaIds, gtmIds: t.gtmIds, hasLegacyUA: t.hasLegacyUA }
    };
}

// -----------------------------------------------------------------------------
// Links, sitemap and robots
// -----------------------------------------------------------------------------
async function probeLink(link) {
    const first = await fetchPage(link.url, { method: 'HEAD', headersOnly: true, timeoutMs: 7000, maxRedirects: 3 });
    let result = first;
    if (first.ok && [400, 403, 405, 429, 501, 999].includes(first.status)) {
        result = await fetchPage(link.url, { method: 'GET', headersOnly: true, timeoutMs: 7000, maxRedirects: 3 });
    }
    if (!result.ok) {
        const dead = ['ENOTFOUND', 'EAI_AGAIN'].includes(result.errorCode);
        return { ...link, status: null, broken: link.internal ? true : dead, unverifiable: !link.internal && !dead, error: result.error };
    }
    const code = result.status;
    const broken = code === 404 || code === 410 || (link.internal && code >= 500);
    const unverifiable = [401, 403, 429, 999].includes(code) || (!link.internal && code >= 500);
    return { ...link, status: code, broken, unverifiable: !broken && unverifiable };
}

async function brokenLinksCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };

    const asset = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)/i;
    const internal = a.links.filter(l => l.internal && !asset.test(l.url)).slice(0, 14);
    const external = a.links.filter(l => !l.internal).slice(0, 6);
    const toCheck = [...internal, ...external];
    if (!toCheck.length) return { status: 'info', details: 'No links found on the homepage to check', evidence: { checked: 0, broken: [], unverifiable: 0 } };

    const probed = await mapLimit(toCheck, 4, probeLink);
    const broken = probed.filter(p => p.broken).map(p => ({ url: p.url, text: p.text, status: p.status, internal: p.internal }));
    const unverifiable = probed.filter(p => p.unverifiable).length;
    const evidence = { checked: probed.length, broken, unverifiable, ok: probed.length - broken.length - unverifiable };
    const status = broken.length === 0 ? 'pass' : (broken.length <= 2 ? 'warn' : 'fail');
    return { status, details: broken.length ? `${broken.length} broken link(s) among ${probed.length} checked` : `${probed.length} links checked, none broken`, evidence };
}

async function sitemapRobotsCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    let origin;
    try { origin = new URL(snap.finalUrl).origin; } catch (_) { return { status: 'skip', details: 'Not checked', evidence: { reason: 'bad-url' } }; }

    const robotsRes = await ctx.memo('robots', () => fetchPage(`${origin}/robots.txt`, { maxBytes: 200_000, timeoutMs: 7000 }));
    const robotsFound = robotsRes.ok && robotsRes.status === 200 && /text\/plain|^$/i.test(robotsRes.contentType || '') && !/<html/i.test(robotsRes.html.slice(0, 500));
    const robots = robotsFound ? analyzeRobots(robotsRes.html) : { sitemaps: [], blocksEverything: false, hasRules: false };

    const sitemapUrl = robots.sitemaps[0] || `${origin}/sitemap.xml`;
    let sitemap = { found: false, urlCount: 0, entries: [], isIndex: false };
    const sitemapRes = await ctx.memo(`sitemap:${sitemapUrl}`, () => fetchPage(sitemapUrl, { maxBytes: 800_000, timeoutMs: 8000 }));
    if (sitemapRes.ok && sitemapRes.status === 200 && /<(urlset|sitemapindex)\b/i.test(sitemapRes.html.slice(0, 2000))) {
        const parsed = analyzeSitemap(sitemapRes.html);
        sitemap = { found: true, ...parsed };
    }
    const dates = sitemap.entries.map(e => e.lastmod).filter(Boolean).map(d => new Date(d)).filter(d => !Number.isNaN(d.getTime())).sort((x, y) => y - x);

    const evidence = {
        robotsFound, blocksEverything: robots.blocksEverything,
        sitemapFound: sitemap.found, sitemapUrl: sitemap.found ? sitemapUrl : null,
        urlCount: sitemap.urlCount, sitemapIsIndex: sitemap.isIndex,
        latestModified: dates[0] ? dates[0].toISOString() : null,
        sitemapPaths: sitemap.entries.slice(0, 40).map(e => e.loc)
    };
    if (robots.blocksEverything) return { status: 'fail', details: 'robots.txt tells every search engine to stay out of the whole site', evidence };
    if (sitemap.found) return { status: 'pass', details: `Sitemap found with ${sitemap.urlCount} ${sitemap.isIndex ? 'sitemaps' : 'pages'}`, evidence };
    return { status: 'info', details: 'No sitemap was found', evidence };
}

// -----------------------------------------------------------------------------
// Platform & updates
// -----------------------------------------------------------------------------
function versionParts(v) {
    return String(v || '').split('.').map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
}

/** true when `installed` is at least one minor version (or a major) behind `latest`. */
function isMeaningfullyBehind(installed, latest) {
    const a = versionParts(installed);
    const b = versionParts(latest);
    if (a.length < 2 || b.length < 2) return false;
    if (a[0] !== b[0]) return a[0] < b[0];
    return a[1] < b[1];
}

async function fetchJson(url, timeoutMs = 7000) {
    const r = await fetchPage(url, { timeoutMs, headers: { Accept: 'application/json' }, maxBytes: 400_000 });
    if (!r.ok || r.status !== 200) return null;
    try { return JSON.parse(r.html); } catch (_) { return null; }
}

async function cmsDetectCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };
    const cms = a.cms;
    const evidence = { platform: cms.name, version: cms.version || null, versionHidden: !!cms.versionHidden, server: snap.headers?.server || null, plugins: (cms.plugins || []).slice(0, 25) };

    if (cms.name === 'WordPress' && cms.version) {
        const latest = await fetchJson('https://api.wordpress.org/core/version-check/1.7/', 5000);
        const latestVersion = latest?.offers?.[0]?.current || null;
        evidence.latestVersion = latestVersion;
        if (latestVersion && isMeaningfullyBehind(cms.version, latestVersion)) {
            return { status: 'warn', details: `WordPress ${cms.version} is behind the current release (${latestVersion})`, evidence };
        }
    }
    return { status: 'info', details: cms.name ? `Built with ${cms.name}${cms.version ? ` ${cms.version}` : ''}` : 'Platform not identified', evidence };
}

async function pluginUpdatesCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const a = await ctx.getAnalysis();
    if (!a || a.cms.name !== 'WordPress') return { status: 'skip', details: 'Not a WordPress website', evidence: { reason: 'not-wordpress' } };

    const plugins = (a.cms.plugins || []).filter(p => p.version && /^\d+(\.\d+){1,3}$/.test(p.version)).slice(0, 8);
    if (!plugins.length) return { status: 'info', details: 'No plugin versions are visible on the public pages', evidence: { checked: 0, hidden: true, outdated: [] } };

    const lookups = await mapLimit(plugins, 4, async plugin => {
        const url = `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${encodeURIComponent(plugin.slug)}&request[fields][sections]=0&request[fields][description]=0&request[fields][short_description]=0&request[fields][reviews]=0&request[fields][banners]=0&request[fields][icons]=0&request[fields][contributors]=0&request[fields][versions]=0&request[fields][screenshots]=0&request[fields][tags]=0&request[fields][compatibility]=0&request[fields][donate_link]=0&request[fields][ratings]=0&request[fields][active_installs]=0&request[fields][support_threads]=0&request[fields][support_threads_resolved]=0&request[fields][author_profile]=0&request[fields][is_commercial]=0`;
        const info = await fetchJson(url, 7000);
        return { plugin, latest: info?.version || null, name: info?.name || plugin.slug, lastUpdated: info?.last_updated || null };
    });

    const known = lookups.filter(l => l.latest);
    const outdated = known.filter(l => isMeaningfullyBehind(l.plugin.version, l.latest))
        .map(l => ({ slug: l.plugin.slug, name: l.name, installed: l.plugin.version, latest: l.latest }));
    const evidence = { checked: known.length, visible: plugins.length, outdated, upToDate: known.length - outdated.length };
    if (!known.length) return { status: 'info', details: 'Visible plugins could not be matched to public update information', evidence };
    return { status: outdated.length ? 'warn' : 'pass', details: outdated.length ? `${outdated.length} visible plugin(s) have newer versions available` : `${known.length} visible plugin(s) are up to date`, evidence };
}

// -----------------------------------------------------------------------------
// A closer look at several pages (used by the Content Refresh plan)
// -----------------------------------------------------------------------------
const NON_PAGE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|xml|json|css|js)(\?|$)/i;

async function contentPagesCheck(_target, ctx) {
    const snap = await ctx.getSnapshot();
    if (!snap.ok) return unreachable(snap);
    const home = await ctx.getAnalysis();
    if (!home) return { status: 'skip', details: 'The homepage did not return readable page content', evidence: { reason: 'no-html' } };

    const homeUrl = new URL(snap.finalUrl);
    const homeHost = normalizeHost(homeUrl.hostname);
    const sameSite = u => { try { return normalizeHost(new URL(u).hostname) === homeHost; } catch (_) { return false; } };
    const lastmodByUrl = new Map();

    // Prefer the sitemap's own list of pages; otherwise use the homepage's internal links.
    let candidates = [];
    let sampledFrom = 'homepage links';
    try {
        const robots = await ctx.memo('robots', () => fetchPage(`${homeUrl.origin}/robots.txt`, { maxBytes: 200_000, timeoutMs: 7000 }));
        const sitemapUrl = (robots.ok && robots.status === 200 ? analyzeRobots(robots.html).sitemaps[0] : null) || `${homeUrl.origin}/sitemap.xml`;
        const sm = await ctx.memo(`sitemap:${sitemapUrl}`, () => fetchPage(sitemapUrl, { maxBytes: 800_000, timeoutMs: 8000 }));
        if (sm.ok && sm.status === 200 && /<urlset\b/i.test(sm.html.slice(0, 2000))) {
            const parsed = analyzeSitemap(sm.html);
            parsed.entries.forEach(e => { if (e.lastmod) lastmodByUrl.set(e.loc.replace(/\/$/, ''), e.lastmod); });
            candidates = parsed.entries.map(e => e.loc).filter(u => sameSite(u) && !NON_PAGE.test(u));
            if (candidates.length) sampledFrom = 'sitemap';
        }
    } catch (_) { /* fall back to homepage links */ }
    if (!candidates.length) candidates = home.links.filter(l => l.internal && !NON_PAGE.test(l.url)).map(l => l.url);

    const homeKey = snap.finalUrl.replace(/\/$/, '');
    const unique = [...new Set(candidates.map(u => u.replace(/#.*$/, '')))].filter(u => u.replace(/\/$/, '') !== homeKey).slice(0, 5);

    const pages = [{
        url: snap.finalUrl, path: '/', status: snap.status, isHome: true, loadMs: snap.totalMs,
        title: home.title, description: home.description, h1: home.h1[0] || null, words: home.wordCount,
        missingAlt: home.images.missingAltAttribute, lastmod: lastmodByUrl.get(homeKey) || null
    }];
    const fetched = await mapLimit(unique, 3, async url => {
        const r = await fetchPage(url, { maxBytes: 700_000, timeoutMs: 9000 });
        if (!r.ok) return { url, path: new URL(url).pathname, status: null, error: r.error, loadMs: r.totalMs };
        const a = r.status === 200 && r.html ? analyzeHtml(r.html, r.finalUrl) : null;
        return {
            url, path: new URL(url).pathname || '/', status: r.status, loadMs: r.totalMs,
            title: a?.title || '', description: a?.description || '', h1: a?.h1[0] || null,
            words: a?.wordCount ?? null, missingAlt: a?.images.missingAltAttribute ?? null,
            lastmod: lastmodByUrl.get(url.replace(/\/$/, '')) || null
        };
    });
    pages.push(...fetched);

    const broken = pages.filter(p => p.status === null || p.status >= 400);
    const missingTitle = pages.filter(p => p.status === 200 && !p.title).length;
    const missingDesc = pages.filter(p => p.status === 200 && !p.description).length;
    const evidence = { pages, sampledFrom, brokenCount: broken.length, missingTitle, missingDescription: missingDesc };

    if (broken.length) return { status: 'fail', details: `${broken.length} of the pages we looked at did not open correctly`, evidence };
    if (missingTitle || missingDesc) return { status: 'warn', details: `${missingTitle + missingDesc} page detail(s) are missing across ${pages.length} pages`, evidence };
    return { status: 'pass', details: `${pages.length} pages looked at, all with titles and descriptions`, evidence };
}

module.exports = {
    createCheckContext,
    uptimeCheck,
    performanceCheck,
    httpsRedirectCheck,
    seoBasicsCheck,
    mobileReadyCheck,
    securityHeadersCheck,
    mixedContentCheck,
    imagesAltCheck,
    analyticsTagCheck,
    brokenLinksCheck,
    sitemapRobotsCheck,
    cmsDetectCheck,
    pluginUpdatesCheck,
    contentPagesCheck,
    pageProfileCheck,
    // exported for tests
    isMeaningfullyBehind,
    isBehindCloudflare,
    mapLimit
};
