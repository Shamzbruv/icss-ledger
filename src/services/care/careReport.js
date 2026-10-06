/**
 * Builds the data behind a Client Care report: scoring, plain-language findings, the visitor
 * section, a description of the client's page, recommendations and what changed since last time.
 * Rendering (HTML / plain text) lives in careReportEmail.js.
 *
 * Nothing here invents results. Every sentence is derived from stored check evidence, and
 * sections only appear when the client's plan includes them.
 */
const { explainItem, GROUPS, GLOSSARY, fmt, friendlyName, normHost, fixAction } = require('./careExplainers');
const { buildAnalyticsSection } = require('./careAnalytics');
const { greetingFor } = require('./carePlans');

// -----------------------------------------------------------------------------
// Scoring
// -----------------------------------------------------------------------------
const WEIGHTS = {
    UPTIME: 30, SSL: 15, PERF_LIGHT: 10, PAGESPEED: 5, HTTPS_REDIRECT: 5, REDIRECT: 5, MOBILE_READY: 5,
    DOMAIN_EXPIRY: 10, DNS: 5, EMAIL_DNS: 4, SECURITY_HEADERS: 3, MIXED_CONTENT: 4, CMS_DETECT: 4,
    PLUGIN_UPDATES: 5, BROKEN_LINKS: 5, SEO_BASICS: 6, IMAGES_ALT: 3, SITEMAP_ROBOTS: 3, CONTENT_PAGES: 5,
    API_HEALTH: 15, WEBHOOK: 10, GA_TRAFFIC: 0, ANALYTICS_TAG: 0, PAGE_PROFILE: 0
};
const POINTS = { pass: 1, warn: 0.5, fail: 0 };

// A failure here limits how good the overall score can look: a site that is down is never "90".
const FAIL_CAPS = { UPTIME: 40, SSL: 60, DOMAIN_EXPIRY: 60, DNS: 50, SITEMAP_ROBOTS: 70, SEO_BASICS: 75, API_HEALTH: 70, WEBHOOK: 70 };

/**
 * Weighted score. `info` and `skip` results are left out entirely, so ideas, tips and checks that
 * could not run never lower a client's score.
 */
function scoreResults(results) {
    let earned = 0;
    let possible = 0;
    let cap = 100;
    const failedCodes = [];
    for (const r of results || []) {
        if (!(r.status in POINTS)) continue;
        const weight = WEIGHTS[r.item_code] ?? 5;
        if (!weight) continue;
        possible += weight;
        earned += weight * POINTS[r.status];
        if (r.status === 'fail') {
            failedCodes.push(r.item_code);
            if (FAIL_CAPS[r.item_code] !== undefined) cap = Math.min(cap, FAIL_CAPS[r.item_code]);
        }
    }
    const raw = possible > 0 ? Math.round((earned / possible) * 100) : 100;
    return { score: Math.min(raw, cap), rawScore: raw, capped: raw > cap, failedCodes };
}

function healthLabel(score, hasCritical) {
    if (hasCritical || score < 50) return { label: 'Critical', tone: 'critical' };
    if (score < 75) return { label: 'Needs attention', tone: 'attention' };
    if (score < 90) return { label: 'Good', tone: 'good' };
    return { label: 'Excellent', tone: 'great' };
}

// -----------------------------------------------------------------------------
// Page description ("a closer look at your website")
// -----------------------------------------------------------------------------
function plural(n, one, many) { return fmt.plural(n, one, many); }

function buildPageSection({ profile, byCode, tier, env, analytics }) {
    if (!profile) return null;
    const show = new Set(tier?.pageSections || ['google', 'glance']);
    const out = { show: [...show], ideas: [] };
    const rank = tier?.rank || 1;

    // How the site appears in Google
    if (show.has('google')) {
        const notes = [];
        if (!profile.title) notes.push('No title was found, so Google will make one up from your page.');
        else if (profile.titleLength > 60) notes.push(`Your title is ${profile.titleLength} characters long. Google usually cuts titles off after about 60.`);
        else if (profile.titleLength < 15) notes.push('Your title is very short. Saying what you do and where can help the right people click.');
        if (!profile.description) notes.push('No description was found, so Google will pick a random piece of text from your page instead.');
        else if (profile.descriptionLength < 70) notes.push(`Your description is short (${profile.descriptionLength} characters). There is room to tell people more about you.`);
        else if (profile.descriptionLength > 165) notes.push(`Your description is long (${profile.descriptionLength} characters), so Google will probably cut it off.`);
        out.google = {
            title: profile.title || '(no title found)',
            displayUrl: normHost(profile.host || profile.url),
            description: profile.description || '',
            notes
        };
    }

    // At a glance
    if (show.has('glance')) {
        const rows = [];
        rows.push({ label: 'Main headline', value: profile.h1 ? `"${profile.h1}"` : 'None found', state: profile.h1 ? 'good' : 'warn' });
        const w = profile.wordCount || 0;
        rows.push({ label: 'Amount of writing', value: `About ${fmt.number(w)} words`, note: w < 150 ? 'On the light side — Google has little to read.' : w > 800 ? 'Plenty of detail.' : 'A comfortable amount.', state: w < 150 ? 'warn' : 'good' });
        rows.push({
            label: 'Pictures',
            value: profile.imagesTotal ? plural(profile.imagesTotal, 'picture') : 'No pictures',
            note: profile.imagesTotal ? (profile.imagesMissingAlt ? `${profile.imagesMissingAlt} without a written description` : 'All have written descriptions') : null,
            state: profile.imagesMissingAlt ? 'warn' : 'good'
        });
        rows.push({ label: 'Links', value: plural(profile.linkCount, 'link'), note: profile.linkCount ? `${profile.internalLinkCount} lead to other pages on your site` : null, state: 'good' });
        const perf = byCode.PERF_LIGHT?.evidence;
        if (perf?.totalDuration != null) rows.push({ label: 'Opens in', value: fmt.seconds(perf.totalDuration), state: byCode.PERF_LIGHT.status === 'pass' ? 'good' : 'warn' });
        rows.push({ label: 'Works on phones', value: profile.mobileReady ? 'Yes' : 'No', state: profile.mobileReady ? 'good' : 'bad' });
        rows.push({ label: 'Security padlock', value: profile.https ? 'Yes' : 'No', state: profile.https ? 'good' : 'bad' });
        if (profile.platform) rows.push({ label: 'Built with', value: `${profile.platform}${profile.platformVersion ? ` ${profile.platformVersion}` : ''}`, state: 'info' });
        out.glance = rows;
    }

    // Can visitors reach you?
    if (show.has('contact')) {
        const c = profile.contact || {};
        const rows = [
            { label: 'Tap-to-call phone number', ok: !!c.phone, note: c.phone ? null : 'Phone visitors cannot ring you with one tap.' },
            { label: 'Email link', ok: !!c.email },
            { label: 'Contact form', ok: !!c.form },
            { label: 'WhatsApp link', ok: !!c.whatsapp },
            { label: 'Map / directions link', ok: !!profile.hasMapsLink },
            { label: 'Social media links', ok: (profile.social || []).length > 0, note: (profile.social || []).length ? fmt.list(profile.social) : null }
        ];
        const methods = [c.phone, c.email, c.form, c.whatsapp].filter(Boolean).length;
        out.contact = {
            rows,
            summary: methods === 0
                ? "We couldn't find a tap-to-call link, email link, contact form or WhatsApp link on your homepage, so it may not be easy for a visitor to get in touch."
                : `Visitors have ${methods === 1 ? 'one easy way' : `${methods} easy ways`} to get in touch from your homepage.`
        };
    }

    // Behind the scenes
    if (show.has('technical')) {
        const rows = [];
        if (profile.behindCloudflare) rows.push({ label: 'Cloudflare protection', value: 'Active — your site is served through Cloudflare', state: 'good', glossary: 'cloudflare' });
        const cms = byCode.CMS_DETECT?.evidence;
        if (cms?.platform) {
            let value = `${cms.platform}${cms.version ? ` ${cms.version}` : ''}`;
            if (cms.latestVersion && cms.version) value += cms.version === cms.latestVersion ? ' (latest version)' : ` (latest is ${cms.latestVersion})`;
            rows.push({ label: 'Website software', value, state: byCode.CMS_DETECT.status === 'warn' ? 'warn' : 'info' });
        }
        const sec = byCode.SECURITY_HEADERS?.evidence;
        if (sec) rows.push({ label: 'Extra protective settings', value: `${sec.count} of ${sec.total} switched on`, state: sec.count >= 4 ? 'good' : 'info', glossary: 'headers' });
        const links = byCode.BROKEN_LINKS?.evidence;
        if (links?.checked) rows.push({ label: 'Links tested', value: `${links.checked} tested, ${links.broken?.length || 0} broken`, state: links.broken?.length ? 'warn' : 'good' });
        const plugins = byCode.PLUGIN_UPDATES?.evidence;
        if (plugins?.checked) rows.push({ label: 'Plugins checked', value: `${plugins.checked} checked, ${plugins.outdated?.length || 0} out of date`, state: plugins.outdated?.length ? 'warn' : 'good' });
        if (rows.length) out.technical = rows;
    }

    // Page by page (Content Refresh)
    if (show.has('pages') && byCode.CONTENT_PAGES?.evidence?.pages?.length) {
        const ev = byCode.CONTENT_PAGES.evidence;
        out.pages = ev.pages.map(p => {
            const notes = [];
            if (p.status === null || p.status >= 400) notes.push('Did not open properly');
            else {
                if (!p.title) notes.push('No title');
                if (!p.description) notes.push('No description');
                if (p.words !== null && p.words !== undefined && p.words < 150) notes.push('Very little text');
                if (p.missingAlt) notes.push(`${plural(p.missingAlt, 'picture')} without descriptions`);
                if (p.loadMs > 3000) notes.push('Slow to open');
            }
            return { path: p.path, name: p.path === '/' ? 'Home page' : (p.title ? p.title.split(/\s+[|\-–—·•:]\s+/)[0] : p.path), status: p.status, loadMs: p.loadMs, notes, ok: notes.length === 0 };
        });
        out.pagesSampledFrom = ev.sampledFrom;
    }

    // Freshness (needs dates in the sitemap)
    const latest = byCode.SITEMAP_ROBOTS?.evidence?.latestModified;
    if (show.has('content') && latest) {
        const ageDays = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
        if (ageDays >= 0) out.freshness = { latest, ageDays, text: ageDays < 31 ? 'within the last month' : `about ${Math.round(ageDays / 30)} months ago` };
    }

    // Ideas that follow directly from what we saw on the page
    const ideas = [];
    const cap = { 1: 2, 2: 3, 3: 4, 4: 6 }[rank] || 3;
    const how = (what, kind = 'content') => fixAction(env, what, kind);
    const mobile = analytics?.state === 'ok' ? (analytics.devices || []).find(d => d.key === 'mobile') : null;
    if (!profile.contact?.phone && profile.mobileReady) {
        ideas.push({
            id: 'tap-to-call', priority: 2, title: 'Add a tap-to-call button',
            why: mobile && analytics.totals.current.sessions >= 10
                ? `${mobile.share}% of your visitors last week were on a phone. A button that dials your number with one tap makes it easy for them to reach you.`
                : 'These days most people browse on a phone. A button that dials your number with one tap makes it easy for them to reach you.',
            how: how('this'), who: 'us'
        });
    }
    if (rank >= 4 && analytics?.state === 'ok' && (analytics.topPages || []).length >= 2 && analytics.totals.current.pageViews >= 10) {
        const names = analytics.topPages.slice(0, 3).map(p => `"${p.name}"`);
        ideas.push({
            id: 'top-pages', priority: 3, title: 'Make your most popular pages work harder',
            why: `Your most-viewed pages last week were ${fmt.list(names)}. These are the best places to feature your latest offer, news or a clear "contact us" button.`,
            how: 'Your plan includes unlimited edits — just reply and tell us what you would like to say.', who: 'you'
        });
    }
    if (!profile.hasOpenGraphImage) ideas.push({ id: 'share-picture', priority: 3, title: 'Add a preview picture for sharing', why: 'When someone shares your link on WhatsApp or Facebook, it currently shows without a picture. A good preview picture gets many more taps.', how: how('this'), who: 'us' });
    if (!profile.description || (profile.descriptionLength > 0 && profile.descriptionLength < 70)) ideas.push({ id: 'description', priority: 2, title: profile.description ? 'Write a fuller search description' : 'Write a search description', why: 'This is the short blurb Google shows under your name. A clear one, mentioning what you offer and where, helps the right people click.', how: how('this'), who: 'us' });
    if ((profile.wordCount || 0) < 150) ideas.push({ id: 'more-words', priority: 3, title: 'Say a little more on your homepage', why: `Your homepage has only about ${fmt.number(profile.wordCount || 0)} words. A few more sentences about what you offer give Google, and visitors, more to go on.`, how: how('this'), who: 'us' });
    if (!profile.hasFavicon) ideas.push({ id: 'favicon', priority: 4, title: 'Add a small icon for the browser tab', why: 'The tiny logo in the browser tab makes your site look finished and easier to spot among many open tabs.', how: how('this'), who: 'us' });
    if (rank >= 4 && !profile.structuredData) ideas.push({ id: 'business-details', priority: 3, title: 'Add "business details" for Google', why: 'A small hidden section lets Google show your opening hours, phone number and address right in search results.', how: how('this', 'technical'), who: 'us' });
    if (rank >= 4 && out.freshness && out.freshness.ageDays > 120) ideas.push({ id: 'freshen', priority: 2, title: 'Freshen up your content', why: `The newest update we can see on your site was ${out.freshness.text}. Google favours sites that are kept current, and your plan includes unlimited edits — send us anything you would like changed.`, how: 'Just reply to this email with what you would like updated.', who: 'you' });
    ideas.sort((a, b) => a.priority - b.priority);
    out.ideas = ideas.slice(0, cap);
    return out;
}

// -----------------------------------------------------------------------------
// Recommendations, changes and admin notes
// -----------------------------------------------------------------------------
const SEVERITY = { fail: 0, warn: 1, info: 2, skip: 3, pass: 4 };

function buildRecommendations(attention, tips, pageIdeas, analytics, tier) {
    const recs = [];
    attention.forEach(item => {
        if (!item.action) return;
        recs.push({ id: item.code, kind: 'issue', priority: item.status === 'fail' ? 1 : 2, title: item.headline, why: item.meaning || item.detail, how: item.action, who: item.who || 'us' });
    });
    tips.forEach(t => recs.push({ id: `tip-${t.title}`, kind: 'idea', priority: t.priority || 3, title: t.title, why: t.why, how: t.how, who: 'us' }));
    pageIdeas.forEach(i => recs.push({ ...i, kind: 'idea' }));
    if (analytics?.state === 'not-installed' && analytics.action) {
        recs.push({ id: 'ga-install', kind: 'idea', priority: 2, title: 'Switch on visitor counting', why: analytics.body, how: analytics.action, who: 'us' });
    }
    // De-duplicate, most important first. Issues are never cut (they are the things to fix);
    // optional ideas are capped by plan so a report with many problems is not buried in extras.
    const seen = new Set();
    const unique = recs.filter(r => (seen.has(r.title) ? false : (seen.add(r.title), true)));
    const byPriority = (a, b) => a.priority - b.priority;
    const issues = unique.filter(r => r.kind === 'issue').sort(byPriority);
    const ideaLimit = { 0: 3, 1: 3, 2: 4, 3: 5, 4: 7 }[tier?.rank || 0] ?? 3;
    const ideas = unique.filter(r => r.kind === 'idea').sort(byPriority).slice(0, ideaLimit);
    return [...issues, ...ideas];
}

const ENGINE = 2;

// Runs made before ENGINE 2 used a much smaller set of checks (and one flawed one, the "secure
// redirect" test). Only checks whose meaning did not change can be compared with them.
const LEGACY_COMPARABLE = new Set(['UPTIME', 'SSL', 'DNS']);
function isComparable(result) {
    return !!result && (result.engine === ENGINE || LEGACY_COMPARABLE.has(result.item_code));
}

/** Compares with the previous report. Only like-for-like: runs made by the current engine. */
function diffAgainstPrevious(current, previous) {
    if (!previous?.results?.length) return null;
    if (!previous.results.some(r => r.engine === ENGINE)) return null;
    const prevBy = new Map(previous.results.map(r => [r.item_code + (r.label && r.item_code === 'API_HEALTH' ? `:${r.label}` : ''), r]));
    const rank = s => ({ pass: 0, info: 0, skip: 0, warn: 1, fail: 2 })[s] ?? 0;
    const fixed = [];
    const worse = [];
    for (const r of current) {
        const key = r.item_code + (r.label && r.item_code === 'API_HEALTH' ? `:${r.label}` : '');
        const prev = prevBy.get(key);
        if (!prev || r.status === 'skip' || prev.status === 'skip') continue;
        if (!(r.status in POINTS) || !(prev.status in POINTS)) continue;
        if (rank(r.status) < rank(prev.status)) fixed.push(friendlyName(r.item_code));
        else if (rank(r.status) > rank(prev.status)) worse.push(friendlyName(r.item_code));
    }
    return { fixed: [...new Set(fixed)], worse: [...new Set(worse)], previousScore: previous.score ?? null, previousDate: previous.created_at || null };
}

function buildAdminNotes({ results, config, tier, profile, service, client }) {
    const notes = [];
    const ga = results.find(r => r.item_code === 'GA_TRAFFIC');
    const diagnosis = ga?.evidence?.diagnosis;
    if (diagnosis) {
        notes.push({ level: 'action', title: `Google Analytics: ${diagnosis.title}`, body: diagnosis.plain, steps: diagnosis.steps || [], serviceAccountEmail: diagnosis.serviceAccountEmail || null });
    }
    if (ga?.evidence?.autoCorrected) {
        const a = ga.evidence.autoCorrected;
        notes.push({ level: 'info', title: 'Google Analytics Property ID was corrected automatically', body: `${a.from ? `The saved ID ${a.from}` : 'No ID was saved, so we'} ${a.from ? 'was replaced with' : 'found'} ${a.to} (matched by ${String(a.reason).replace('-', ' ')}).` });
    }
    if (!config.website_url) notes.push({ level: 'action', title: 'No website address is saved', body: 'Website checks could not run. Add the website URL on the client service.' });
    if (!config.report_email && !client?.email) notes.push({ level: 'action', title: 'No report email address', body: 'There is no email address to send this report to.' });
    if (tier && tier.rank >= 3 && profile && profile.behindCloudflare === false) {
        notes.push({ level: 'info', title: 'Cloudflare was not detected', body: `${tier.name} includes Cloudflare monitoring, but this website does not appear to be served through Cloudflare. The client email does not mention this.` });
    }
    const failed = results.filter(r => r.status === 'fail' && !['GA_TRAFFIC'].includes(r.item_code));
    if (failed.length) notes.push({ level: 'action', title: `${failed.length} check${failed.length === 1 ? '' : 's'} failed`, body: failed.map(f => `${friendlyName(f.item_code)}: ${f.details}`).join(' • ') });
    return notes;
}

// -----------------------------------------------------------------------------
// Weekly report
// -----------------------------------------------------------------------------
function genericTier(plan) {
    return {
        code: 'GENERIC', rank: 0, name: plan?.name || 'Client Care', shortName: plan?.name || 'Client Care',
        promise: 'We keep an eye on the services that matter to your business and tell you straight away when something needs attention.',
        checks: [], analytics: { sections: [] }, pageSections: [], handledByUs: [], stepUp: null
    };
}

/**
 * @returns {object} report model consumed by careReportEmail.js
 */
function buildWeeklyReport({ service = {}, client = {}, tier: tierIn, results = [], previous = null, history = [], alerted = true, now = new Date(), audience = 'client', periodStart, periodEnd }) {
    const config = service.service_meta_json || {};
    const plan = service.service_plans || {};
    const tier = tierIn || genericTier(plan);
    const siteUrl = config.website_url || '';
    const host = siteUrl ? normHost(siteUrl) : (config.domain || '');
    const env = { tier: tierIn || null, host, siteUrl, domain: config.domain || host, now, alerted };

    const byCode = {};
    results.forEach(r => { if (!byCode[r.item_code]) byCode[r.item_code] = r; });

    // Explain every result.
    const explained = [];
    for (const r of results) {
        if (['GA_TRAFFIC', 'PAGE_PROFILE'].includes(r.item_code)) continue;
        const ex = explainItem(r, env);
        if (ex) explained.push({ ...ex, status: ex.status || r.status, raw: r });
    }
    const visible = explained.filter(e => !e.hide);

    const attention = visible.filter(e => e.status === 'fail' || e.status === 'warn')
        .sort((a, b) => (SEVERITY[a.status] - SEVERITY[b.status]) || ((b.critical ? 1 : 0) - (a.critical ? 1 : 0)) || (a.order - b.order));
    const good = visible.filter(e => e.status === 'pass').sort((a, b) => a.order - b.order);
    const fyi = visible.filter(e => e.status === 'info' || e.status === 'skip').sort((a, b) => a.order - b.order);
    const tips = visible.map(e => e.tip).filter(Boolean);

    // Visitors
    const tagItem = byCode.ANALYTICS_TAG;
    const profile = byCode.PAGE_PROFILE?.evidence || null;
    const tagInstalled = tagItem ? tagItem.status === 'pass' : !!profile?.hasTracking;
    const analytics = tier.checks.includes('GA_TRAFFIC') || byCode.GA_TRAFFIC
        ? buildAnalyticsSection({ gaItem: byCode.GA_TRAFFIC, tagInstalled, tier, siteTitle: profile?.title || '', env })
        : { state: 'hidden', glossary: [] };

    // Page description
    const page = buildPageSection({ profile, byCode, tier, env, analytics });

    // Score & overall tone
    const scored = scoreResults(results);
    const hasCritical = explained.some(e => e.critical && e.status === 'fail');
    const { label, tone } = healthLabel(scored.score, hasCritical);
    const uptimeDown = byCode.UPTIME?.status === 'fail';
    const attentionCount = attention.length;

    let headline;
    let subline = null;
    if (uptimeDown) headline = 'Your website appears to be down right now.';
    else if (tone === 'critical') headline = 'We found a serious problem that needs attention right away.';
    else if (tone === 'attention') headline = `Your website is working, but ${attentionCount === 1 ? 'one thing needs' : `${attentionCount} things need`} a look.`;
    else if (tone === 'good') headline = attentionCount ? `Your website is healthy, with ${attentionCount === 1 ? 'one small thing' : `${attentionCount} small things`} worth a look.` : 'Your website is healthy.';
    else headline = attentionCount ? `Your website is in great shape, with ${attentionCount === 1 ? 'one small thing' : `${attentionCount} small things`} worth a look.` : 'Everything looks great this week.';
    if (hasCritical || tone === 'critical') subline = attention.filter(a => a.critical).slice(0, 2).map(a => a.headline).join(' ');
    if (!tierIsWebsite(tierIn)) headline = headline.replace(/^Your website/, 'Your services');

    // Scoreboard
    const scoreboard = [];
    const up = byCode.UPTIME;
    if (up) scoreboard.push({ label: 'Website', value: up.status === 'fail' ? 'Down' : (up.status === 'warn' ? 'Odd' : 'Online'), sub: 'right now', state: up.status === 'fail' ? 'bad' : up.status === 'warn' ? 'warn' : 'good' });
    const perf = byCode.PERF_LIGHT;
    if (perf && perf.status !== 'skip') {
        const ms = perf.evidence?.totalDuration;
        scoreboard.push({ label: 'Speed', value: Number.isFinite(ms) ? `${Math.round(ms / 100) / 10}s` : '—', sub: 'homepage opens', state: perf.status === 'pass' ? 'good' : perf.status === 'warn' ? 'warn' : 'bad' });
    }
    const ssl = byCode.SSL;
    if (ssl && ssl.status !== 'skip') scoreboard.push({ label: 'Padlock', value: ssl.status === 'fail' ? 'Problem' : (ssl.evidence?.daysRemaining != null ? `${ssl.evidence.daysRemaining} days` : 'Valid'), sub: 'until it renews', state: ssl.status === 'pass' ? 'good' : ssl.status === 'warn' ? 'warn' : 'bad' });
    if (analytics.state === 'ok') {
        const t = analytics.tiles[0];
        scoreboard.push({ label: 'Visitors', value: t.value, sub: t.change.short, state: t.change.dir === 'down' ? 'warn' : 'good' });
    } else if (byCode.DOMAIN_EXPIRY && byCode.DOMAIN_EXPIRY.evidence?.supported) {
        const d = byCode.DOMAIN_EXPIRY;
        scoreboard.push({ label: 'Domain', value: `${d.evidence.daysRemaining} days`, sub: 'until renewal', state: d.status === 'pass' ? 'good' : d.status === 'warn' ? 'warn' : 'bad' });
    }

    const changes = diffAgainstPrevious(results, previous);

    // Track record: how often the site was reachable at our recent weekly checks (any engine).
    let trackRecord = null;
    const pastUptime = (history || []).map(h => (h.results || []).find(r => r.item_code === 'UPTIME')).filter(Boolean);
    const sampled = [byCode.UPTIME, ...pastUptime].filter(Boolean);
    if (sampled.length >= 3 && byCode.UPTIME?.status !== 'fail') {
        const okCount = sampled.filter(r => r.status !== 'fail').length;
        trackRecord = {
            checks: sampled.length, ok: okCount,
            text: okCount === sampled.length
                ? `Your website was online at every one of our last ${sampled.length} weekly checks.`
                : `Your website was online at ${okCount} of our last ${sampled.length} weekly checks.`
        };
    }
    const recommendations = buildRecommendations(attention, tips, page?.ideas || [], analytics, tierIn);
    // In the weekly email, fixes sit inside each "thing to look at"; only optional ideas are listed as suggestions.
    const ideas = recommendations.filter(r => r.kind === 'idea');

    // A one-glance answer to "do I need to do anything?"
    let todo;
    if (hasCritical || uptimeDown) {
        todo = {
            tone: 'critical', title: 'What you need to do',
            body: alerted
                ? 'Nothing for now — our team has been alerted and is already looking into this. If you recently changed something on your website, app or domain, please reply and let us know.'
                : 'Please reply to this email right away so we can look into this. If you recently changed something on your website, app or domain, tell us what.'
        };
    } else if (!ideas.length && !attention.length) {
        todo = { tone: 'good', title: 'Do you need to do anything?', body: 'No — there is nothing you need to do this week. We are taking care of everything.' };
    } else {
        const needsYou = ideas.filter(r => r.who === 'you').length;
        const total = attention.length + ideas.length;
        let body = 'Nothing is urgent.';
        if (attention.length) body += ` ${attention.length === 1 ? 'One thing is' : `${attention.length} things are`} flagged below, with what happens next.`;
        if (ideas.length) body += ` We ${attention.length ? 'also ' : ''}have ${ideas.length === 1 ? 'one optional suggestion' : `${ideas.length} optional suggestions`} below.`;
        body += total === 1
            ? ' If you would like us to go ahead with it, just reply and say so.'
            : ' If you would like us to go ahead with any of them, just reply and tell us which.';
        if (needsYou) body += needsYou === 1 ? ' One suggestion needs something from you.' : ` ${needsYou} suggestions need something from you.`;
        todo = { tone: 'info', title: 'Do you need to do anything?', body };
    }

    // Glossary: only words that appear in what we show.
    const used = new Set();
    [...attention, ...good, ...fyi].forEach(e => (e.glossary || []).forEach(g => used.add(g)));
    (analytics.glossary || []).forEach(g => used.add(g));
    (page?.technical || []).forEach(t => t.glossary && used.add(t.glossary));
    const glossary = [...used].filter(k => GLOSSARY[k]).slice(0, 10).map(k => ({ term: GLOSSARY[k][0], meaning: GLOSSARY[k][1] }));

    // Subject
    let subject;
    if (uptimeDown) subject = `Action needed: we couldn't open ${host || 'your website'}`;
    else if (tone === 'critical') subject = 'Action needed: we found a problem with your website';
    else if (attentionCount) subject = `Your website this week: ${attentionCount === 1 ? '1 thing' : `${attentionCount} things`} worth a look`;
    else subject = 'Your website this week: all good';
    if (analytics.state === 'ok' && !uptimeDown && tone !== 'critical') {
        const t = analytics.tiles[0];
        subject += ` — ${t.value} ${analytics.totals.current.users === 1 ? 'visitor' : 'visitors'}${t.change.dir === 'same' ? '' : ` (${t.change.short})`}`;
    }
    if (!tierIsWebsite(tierIn)) subject = subject.replace(/^Your website/, `Your ${plan.name || 'service'} report`).replace(/^Action needed: we found a problem with your website/, `Action needed: we found a problem with your ${plan.name || 'service'} service`);

    const checkedNames = [...new Set([...good, ...attention, ...fyi.filter(f => f.status !== 'skip')].map(e => friendlyName(e.code)))];

    return {
        kind: 'weekly',
        audience,
        subject,
        preheader: `${headline} ${analytics.state === 'ok' ? analytics.headline : ''}`.trim(),
        meta: {
            clientName: client.name || '',
            greeting: greetingFor(client, service),
            planName: plan.name || tier.name,
            tierCode: tier.code, tierRank: tier.rank,
            host, siteUrl,
            periodStart: periodStart || null, periodEnd: periodEnd || null,
            generatedAt: now.toISOString(),
            alerted
        },
        health: { score: scored.score, label, tone, headline, subline, capped: scored.capped, checks: results.filter(r => r.status in POINTS && (WEIGHTS[r.item_code] ?? 5) > 0).length },
        scoreboard,
        trackRecord,
        todo,
        attention, good, fyi,
        groups: GROUPS,
        analytics,
        page,
        recommendations,
        ideas,
        changes,
        plan: { name: plan.name || tier.name, promise: tier.promise, handledByUs: tier.handledByUs, stepUp: tier.stepUp, checkedNames, rank: tier.rank },
        glossary,
        adminNotes: audience === 'admin' ? buildAdminNotes({ results, config, tier: tierIn, profile, service, client }) : []
    };
}

function tierIsWebsite(tier) { return !!tier && tier.code !== 'GENERIC'; }

// -----------------------------------------------------------------------------
// Monthly review
// -----------------------------------------------------------------------------
function monthName(monthStr) {
    const [y, m] = String(monthStr).split('-').map(Number);
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${names[(m || 1) - 1]} ${y}`;
}

/**
 * Builds the monthly review from the weekly runs stored for that month.
 * @param {object} args
 * @param {string} args.monthStr       'YYYY-MM'
 * @param {Array}  args.runs           checklist_runs rows (results_json, score, created_at)
 * @param {object} args.summary        monthly_pulse_summaries row (counts / overall status)
 */
function buildMonthlyReport({ monthStr, runs = [], summary = {}, client = {}, service = {}, tier: tierIn }) {
    const tier = tierIn || genericTier(service.service_plans);
    const ordered = [...runs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const resultsOf = run => (Array.isArray(run.results_json) ? run.results_json : []);
    const findAll = code => ordered.map(run => ({ run, item: resultsOf(run).find(r => r.item_code === code) })).filter(x => x.item);

    // Availability
    const uptime = findAll('UPTIME');
    const upCount = uptime.filter(x => x.item.status !== 'fail').length;
    const availability = uptime.length ? {
        checked: uptime.length, ok: upCount, down: uptime.length - upCount,
        text: upCount === uptime.length
            ? `We visited your website ${fmt.plural(uptime.length, 'time')} this month and it was online every time.`
            : `We visited your website ${fmt.plural(uptime.length, 'time')} this month. It was online ${upCount} of those times and we could not open it ${fmt.plural(uptime.length - upCount, 'time')}.`
    } : null;

    // Speed (older runs timed a redirect response, not the page, so only current measurements count)
    const speeds = findAll('PERF_LIGHT').filter(x => x.item.engine === ENGINE).map(x => x.item.evidence?.totalDuration).filter(v => Number.isFinite(v));
    const speed = speeds.length ? { averageMs: Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length), fastestMs: Math.min(...speeds), slowestMs: Math.max(...speeds), samples: speeds.length } : null;

    // Score trend (older runs were scored differently, so they are not mixed in)
    const scores = ordered.filter(r => Number.isFinite(r.score) && resultsOf(r).some(x => x.engine === ENGINE)).map(r => ({ date: r.created_at, score: r.score }));

    // Visitors across the month's weekly snapshots
    const weekly = findAll('GA_TRAFFIC').map(x => {
        const a = normalizeForMonthly(x.item.evidence);
        return a ? { date: x.run.created_at, a } : null;
    }).filter(Boolean);
    let traffic = null;
    if (weekly.length) {
        const sum = key => weekly.reduce((s, w) => s + (w.a.current[key] || 0), 0);
        const best = [...weekly].sort((a, b) => b.a.current.sessions - a.a.current.sessions)[0];
        const pages = new Map();
        weekly.forEach(w => (w.a.topPages || []).forEach(p => {
            const cur = pages.get(p.path) || { path: p.path, title: p.title, views: 0 };
            cur.views += p.views;
            if (!cur.title && p.title) cur.title = p.title;
            pages.set(p.path, cur);
        }));
        const channels = new Map();
        weekly.forEach(w => (w.a.channels || []).forEach(ch => channels.set(ch.name, (channels.get(ch.name) || 0) + ch.sessions)));
        const first = weekly[0].a.current.sessions;
        const last = weekly[weekly.length - 1].a.current.sessions;
        const totalSessions = sum('sessions');
        const { CHANNEL_NAMES } = require('./careAnalytics');
        traffic = {
            weeks: weekly.length,
            visits: totalSessions,
            pageViews: sum('pageViews'),
            averagePeoplePerWeek: Math.round(sum('users') / weekly.length),
            bestWeek: { date: best.date, visits: best.a.current.sessions },
            firstWeek: first, lastWeek: last,
            topPages: [...pages.values()].sort((a, b) => b.views - a.views).slice(0, 5),
            channels: [...channels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, sessions]) => ({ name: CHANNEL_NAMES[name] || name, sessions, share: totalSessions ? Math.round((sessions / totalSessions) * 100) : 0 })),
            weeklyBars: weekly.map(w => ({ date: w.date, visits: w.a.current.sessions }))
        };
    }

    // Recurring problems & improvements
    const problemCount = new Map();
    ordered.forEach(run => resultsOf(run).filter(isComparable).forEach(r => {
        if (['warn', 'fail'].includes(r.status) && !['GA_TRAFFIC'].includes(r.item_code)) problemCount.set(r.item_code, (problemCount.get(r.item_code) || 0) + 1);
    }));
    const lastResults = ordered.length ? resultsOf(ordered[ordered.length - 1]).filter(isComparable) : [];
    const stillOpen = lastResults.filter(r => ['warn', 'fail'].includes(r.status) && r.item_code !== 'GA_TRAFFIC').map(r => r.item_code);
    const recurring = [...problemCount.entries()].filter(([code]) => stillOpen.includes(code)).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, name: friendlyName(code), weeks: count }));
    const resolved = [...problemCount.keys()].filter(code => !stillOpen.includes(code)).map(code => ({ code, name: friendlyName(code), weeks: problemCount.get(code) }));

    // Recommendations and the "what we check" list come from the most recent weekly run made by
    // the current check suite (older runs did not look at enough to advise on).
    let recommendations = [];
    let checkedNames = [];
    const current = [...ordered].reverse().find(run => resultsOf(run).some(x => x.engine === ENGINE));
    if (current) {
        const weeklyModel = buildWeeklyReport({ service, client, tier: tierIn, results: resultsOf(current), alerted: true, audience: 'client' });
        recommendations = weeklyModel.recommendations.slice(0, 8);
        checkedNames = weeklyModel.plan.checkedNames;
    }

    const tone = summary.overall_status === 'Critical Issues' ? 'critical' : summary.overall_status === 'Needs Attention' ? 'attention' : 'great';
    const avgScore = scores.length ? Math.round(scores.reduce((s, x) => s + x.score, 0) / scores.length) : null;
    const headline = tone === 'critical'
        ? `${monthName(monthStr)} was a difficult month for your website, and we worked on it.`
        : tone === 'attention'
            ? `${monthName(monthStr)} was mostly healthy, with a few things we kept an eye on.`
            : `${monthName(monthStr)} was a healthy month for your website.`;

    const subject = tone === 'critical'
        ? `Your ${monthName(monthStr)} website review: some problems to talk about`
        : `Your ${monthName(monthStr)} website review: ${tone === 'great' ? 'a healthy month' : 'mostly healthy'}`
        + (traffic ? ` — ${fmt.number(traffic.visits)} visits` : '');

    return {
        kind: 'monthly',
        subject,
        preheader: headline,
        meta: { clientName: client.name || '', greeting: greetingFor(client, service), planName: service.service_plans?.name || tier.name, tierCode: tier.code, tierRank: tier.rank, month: monthStr, monthName: monthName(monthStr), reports: ordered.length },
        health: { tone, headline, averageScore: avgScore },
        availability, speed, scores, traffic,
        recurring, resolved, recommendations,
        counts: { reports: summary.total_reports_sent ?? ordered.length, pass: summary.pass_count ?? 0, warn: summary.warn_count ?? 0, fail: summary.fail_count ?? 0 },
        plan: { name: service.service_plans?.name || tier.name, promise: tier.promise, handledByUs: tier.handledByUs, stepUp: tier.stepUp, rank: tier.rank, checkedNames }
    };
}

function normalizeForMonthly(evidence) {
    const { normalizeAnalytics } = require('./careAnalytics');
    return normalizeAnalytics(evidence);
}

module.exports = {
    scoreResults, healthLabel, buildWeeklyReport, buildMonthlyReport, buildPageSection, diffAgainstPrevious,
    buildAdminNotes, buildRecommendations, WEIGHTS, FAIL_CAPS, monthName, genericTier, isComparable, ENGINE
};
