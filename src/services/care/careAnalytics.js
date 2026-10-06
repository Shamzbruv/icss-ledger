/**
 * Turns Google Analytics numbers into the "Your visitors this week" section of the report.
 * All wording is plain English and everything shown is computed from real figures.
 */
const { fmt, GLOSSARY } = require('./careExplainers');

// Written as noun phrases so they read naturally in "X% of visits came from ___".
const CHANNEL_NAMES = {
    'Direct': 'People typing your address or using a bookmark',
    'Organic Search': 'Searches on Google, Bing or similar',
    'Organic Social': 'Facebook, Instagram and other social media',
    'Referral': 'Links on other websites',
    'Paid Search': 'Paid search ads',
    'Paid Social': 'Paid social media ads',
    'Email': 'Links in emails',
    'Display': 'Banner ads',
    'Organic Video': 'YouTube and other video sites',
    'Organic Shopping': 'Shopping listings',
    'Paid Shopping': 'Paid shopping ads',
    'Cross-network': 'Google ad campaigns',
    'AI Assistant': 'AI chat tools such as ChatGPT',
    'Affiliates': 'Partner websites',
    'SMS': 'Text messages',
    'Audio': 'Podcasts and audio',
    'Unassigned': 'Sources that were not recorded'
};

const DEVICE_NAMES = { mobile: 'On a phone', desktop: 'On a computer', tablet: 'On a tablet', 'smart tv': 'On a TV' };

function emptyMetrics() { return { users: 0, newUsers: 0, sessions: 0, pageViews: 0, engagementRate: 0, avgSessionSeconds: 0 }; }

/** Accepts both the new rich evidence and the older three-number format. */
function normalizeAnalytics(evidence) {
    if (!evidence) return null;
    if (evidence.analytics?.current) return evidence.analytics;
    if (evidence.currentPeriod) {
        const c = evidence.currentPeriod;
        const p = evidence.previousPeriod || {};
        return {
            propertyId: evidence.propertyId || null,
            period: { current: { startDate: c.start, endDate: c.end }, previous: { startDate: p.start, endDate: p.end } },
            current: { ...emptyMetrics(), users: c.activeUsers || 0, sessions: c.sessions || 0, pageViews: c.pageViews || 0 },
            previous: { ...emptyMetrics(), users: p.activeUsers || 0, sessions: p.sessions || 0, pageViews: p.pageViews || 0 },
            topPages: [], channels: [], devices: [], countries: [], daily: [], legacy: true
        };
    }
    return null;
}

/** Describes a change in plain words. Small numbers are compared directly, not as percentages. */
function describeChange(current, previous) {
    const cur = Number(current) || 0;
    const prev = Number(previous) || 0;
    if (cur === 0 && prev === 0) return { dir: 'same', short: 'no change', long: 'no change from last week' };
    if (prev < 10) {
        if (cur > prev) return { dir: 'up', short: `up from ${prev}`, long: `up from ${prev} last week` };
        if (cur < prev) return { dir: 'down', short: `down from ${prev}`, long: `down from ${prev} last week` };
        return { dir: 'same', short: 'same as last week', long: 'the same as last week' };
    }
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (Math.abs(pct) <= 5) return { dir: 'same', short: 'about the same', long: 'about the same as last week' };
    return pct > 0
        ? { dir: 'up', short: `up ${pct}%`, long: `${pct}% more than last week`, pct }
        : { dir: 'down', short: `down ${Math.abs(pct)}%`, long: `${Math.abs(pct)}% fewer than last week`, pct };
}

/** Friendly name for a page: its title without the site-name suffix, else its path. */
function friendlyPageName(title, pagePath, siteTitle) {
    if (!pagePath || pagePath === '/') return 'Home page';
    const raw = String(title || '').trim();
    if (!raw || raw === '(not set)') return pagePath;
    const split = value => value.split(/\s+[|\-–—·•:]\s+/).map(s => s.trim()).filter(Boolean);
    const brand = new Set(split(String(siteTitle || '')).map(s => s.toLowerCase()));
    let parts = split(raw);
    const kept = parts.filter(p => !brand.has(p.toLowerCase()));
    if (kept.length) parts = kept;
    let name = parts[0] || raw;
    if (name.length > 60) name = `${name.slice(0, 57)}…`;
    return name;
}

function shareOf(value, total) { return total > 0 ? Math.round((value / total) * 100) : 0; }

// "People typing…" reads as "people typing…" mid-sentence, but proper nouns keep their capital.
function lowerFirst(text) {
    return /^(Facebook|Instagram|Google|YouTube|AI|WhatsApp|TikTok|Bing)\b/.test(text) ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * @param {object} args
 * @param {object} args.gaItem        stored GA_TRAFFIC result (or undefined)
 * @param {boolean} args.tagInstalled does the homepage load Google's counting code?
 * @param {object} args.tier          tier profile (controls how much detail is shown)
 * @param {string} args.siteTitle     homepage title (to strip the brand from page names)
 */
function buildAnalyticsSection({ gaItem, tagInstalled, tier, siteTitle, env = {} }) {
    const sections = tier?.analytics?.sections || ['summary', 'topPages'];
    const glossary = ['analytics'];

    if (!gaItem) return { state: 'hidden', glossary: [] };
    const e = gaItem.evidence || {};

    if (e.configIssue) {
        const code = e.diagnosis?.code;
        if (code === 'NOT_CONFIGURED' && !tagInstalled) return notInstalled(glossary);
        if (['QUOTA', 'NETWORK', 'UNKNOWN'].includes(code)) {
            return {
                state: 'unavailable', glossary,
                headline: 'Visitor numbers were not available this week.',
                body: 'Google could not give us your figures this time. This normally sorts itself out, and your numbers will be back in the next report.'
            };
        }
        return {
            state: 'connecting', glossary,
            headline: "We're still connecting your visitor statistics.",
            body: tagInstalled
                ? 'Your website is already counting its visitors with Google Analytics. We are finishing the link between that and your weekly report, so your numbers will show up here in an upcoming report. You do not need to do anything.'
                : 'We are finishing the link between Google Analytics and your weekly report, so your numbers will show up here in an upcoming report. You do not need to do anything.'
        };
    }

    const data = normalizeAnalytics(e);
    if (!data) return { state: 'hidden', glossary: [] };

    const c = data.current;
    const p = data.previous || emptyMetrics();
    if (c.sessions === 0 && c.users === 0 && !tagInstalled) return notInstalled(glossary, true);

    const people = describeChange(c.users, p.users);
    const visits = describeChange(c.sessions, p.sessions);
    const views = describeChange(c.pageViews, p.pageViews);

    const out = {
        state: 'ok', glossary: [...glossary, 'visit'],
        period: data.period,
        legacy: !!data.legacy,
        tiles: [
            { key: 'users', label: c.users === 1 ? 'Person who visited' : 'People who visited', value: fmt.number(c.users), change: people },
            { key: 'sessions', label: c.sessions === 1 ? 'Visit' : 'Visits', value: fmt.number(c.sessions), change: visits },
            { key: 'pageViews', label: c.pageViews === 1 ? 'Page viewed' : 'Pages viewed', value: fmt.number(c.pageViews), change: views }
        ],
        totals: { current: c, previous: p }
    };

    // The headline sentence.
    if (c.users === 0) {
        out.headline = 'Google Analytics recorded no visitors this week.';
        out.summary = 'If you were expecting visitors, let us know and we will check that the counting is working.';
    } else {
        const who = c.users === 1 ? 'person' : 'people';
        const trend = people.dir === 'up' ? `That is ${people.long}.` : people.dir === 'down' ? `That is ${people.long}.` : 'That is about the same as last week.';
        out.headline = `About ${fmt.number(c.users)} ${who} visited your website this week.`;
        out.summary = `${trend} Between them they made ${fmt.plural(c.sessions, 'visit')} and looked at ${fmt.plural(c.pageViews, 'page')}.`;
        if (c.sessions < 10) out.summary += ' Small numbers like these can be normal for a smaller or newer site; the ideas further down can help bring more people in.';
    }

    const insights = [];

    if (sections.includes('engagement') && c.sessions >= 5 && c.engagementRate > 0) {
        const pct = Math.round(c.engagementRate * 100);
        insights.push(`About **${pct}%** of visits were "engaged" — people stayed a while or looked around — and visitors stayed about **${fmt.duration(c.avgSessionSeconds)}** on average.`);
        out.glossary.push('engaged');
    }

    // Most-viewed pages
    if (sections.includes('topPages') && (data.topPages || []).length) {
        const limit = tier?.analytics?.topPages || 3;
        out.topPages = data.topPages.slice(0, limit).map(page => ({
            name: friendlyPageName(page.title, page.path, siteTitle),
            path: page.path,
            views: page.views,
            share: shareOf(page.views, c.pageViews)
        }));
        const first = out.topPages[0];
        if (first && c.pageViews >= 5) insights.push(`Your most-viewed page was **${first.name}**, with ${fmt.plural(first.views, 'view')} (${first.share}% of all page views).`);
    }

    // Where visitors came from
    if (sections.includes('channels') && (data.channels || []).length && c.sessions > 0) {
        out.channels = data.channels.slice(0, 5).map(ch => ({
            name: CHANNEL_NAMES[ch.name] || ch.name,
            sessions: ch.sessions,
            share: shareOf(ch.sessions, c.sessions)
        }));
        const first = out.channels[0];
        if (first && c.sessions >= 5) insights.push(`**${first.share}%** of visits came from **${lowerFirst(first.name)}**.`);
        const direct = out.channels.find(ch => ch.name === CHANNEL_NAMES.Direct);
        if (direct && direct.share >= 50 && c.sessions >= 10) insights.push('People who tap a link you sent them on WhatsApp or in a text message are usually counted under "typing your address or using a bookmark", so that figure often includes your own shares.');
    }

    // Phones vs computers
    if (sections.includes('devices') && (data.devices || []).length && c.sessions > 0) {
        out.devices = data.devices.map(d => ({
            name: DEVICE_NAMES[String(d.name).toLowerCase()] || d.name,
            key: String(d.name).toLowerCase(),
            sessions: d.sessions,
            share: shareOf(d.sessions, c.sessions)
        }));
        const mobile = out.devices.find(d => d.key === 'mobile');
        if (mobile && c.sessions >= 5) {
            insights.push(mobile.share >= 50
                ? `**${mobile.share}%** of visits were on a phone, so how your site looks and works on a phone matters most.`
                : `**${mobile.share}%** of visits were on a phone; most people used a computer or tablet.`);
        }
    }

    // Countries
    if (sections.includes('countries') && (data.countries || []).length) {
        const listed = data.countries.reduce((sum, x) => sum + x.users, 0);
        out.countries = data.countries.slice(0, 4).map(x => ({ name: x.name, users: x.users, share: shareOf(x.users, listed) }));
        const first = out.countries[0];
        if (first && listed >= 5) insights.push(`Most visitors (**${first.share}%**) were in **${first.name}**.`);
    }

    // Day by day
    if (sections.includes('daily') && (data.daily || []).length >= 3) {
        const max = Math.max(...data.daily.map(d => d.sessions), 1);
        out.daily = data.daily.map(d => ({ date: d.date, label: `${fmt.weekday(d.date).slice(0, 3)} ${fmt.dayMonth(d.date)}`, sessions: d.sessions, bar: Math.round((d.sessions / max) * 100) }));
        const busiest = [...data.daily].sort((a, b) => b.sessions - a.sessions)[0];
        if (busiest && busiest.sessions >= 3 && c.sessions >= 7) insights.push(`Your busiest day was **${fmt.weekday(busiest.date)}** with ${fmt.plural(busiest.sessions, 'visit')}.`);
    }

    out.insights = insights;
    return out;

    function notInstalled(gloss, connected = false) {
        return {
            state: 'not-installed', glossary: gloss,
            headline: connected ? "Your website isn't sending any visitor numbers yet." : "Your website isn't counting its visitors yet.",
            body: connected
                ? "Google Analytics is connected to your reports, but your website isn't sending it any information — the small counting code is missing from your pages. That is like having a door counter that was never switched on."
                : "We couldn't find Google's visitor-counting code on your homepage. It's like a shop without a door counter: you can't tell how many people come in, or what they look at.",
            action: "Your plan includes visitor statistics, so just reply to this email and we'll set the counting up."
        };
    }
}

module.exports = { buildAnalyticsSection, normalizeAnalytics, describeChange, friendlyPageName, CHANNEL_NAMES, DEVICE_NAMES, GLOSSARY };
