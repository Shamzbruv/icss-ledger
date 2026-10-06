/**
 * Plain-language explanations for Client Care results.
 *
 * Checks store raw measurements (`status`, `details`, `evidence`). This module turns them into
 * sentences a non-technical reader can follow, generated at render time from the stored evidence
 * so that improving the wording also improves reports built from older runs.
 *
 * Rules of thumb used throughout:
 *  - say what we looked at, what we found (with the real number) and what it means;
 *  - never use a technical word without a one-line explanation (see GLOSSARY);
 *  - never claim a result the check did not measure.
 *
 * Text may contain **bold** markers; the renderer escapes everything else.
 */

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toDate(value) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = {
    number(n) { return Number(n || 0).toLocaleString('en-US'); },
    seconds(ms) {
        if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return null;
        const s = Number(ms) / 1000;
        if (s >= 10) return `${Math.round(s)} seconds`;
        const rounded = Math.round(s * 10) / 10;
        return `${String(rounded).replace(/\.0$/, '')} ${rounded === 1 ? 'second' : 'seconds'}`;
    },
    bytes(n) {
        const v = Number(n);
        if (!Number.isFinite(v) || v <= 0) return null;
        if (v < 1024) return `${v} bytes`;
        if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
        return `${(Math.round((v / (1024 * 1024)) * 10) / 10).toString().replace(/\.0$/, '')} MB`;
    },
    date(value) {
        const d = toDate(value);
        return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '';
    },
    dayMonth(value) {
        const d = toDate(value);
        return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}` : '';
    },
    weekday(value) {
        const d = toDate(value);
        return d ? DAYS[d.getUTCDay()] : '';
    },
    duration(seconds) {
        const s = Math.round(Number(seconds) || 0);
        if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
        const m = Math.floor(s / 60);
        const r = s % 60;
        return r ? `${m} min ${r} sec` : `${m} min`;
    },
    plural(n, one, many) { return `${fmt.number(n)} ${Number(n) === 1 ? one : (many || `${one}s`)}`; },
    list(items) {
        const arr = items.filter(Boolean);
        if (arr.length <= 1) return arr.join('');
        return `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
    },
    percent(n) { return `${Math.round(Number(n) || 0)}%`; }
};

function normHost(value) {
    try {
        const text = String(value || '').trim();
        return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) { return String(value || '').toLowerCase().replace(/^www\./, ''); }
}

function sameSite(a, b) { return !!a && !!b && normHost(a) === normHost(b); }

// -----------------------------------------------------------------------------
// Glossary (only the words used by the items actually shown get printed)
// -----------------------------------------------------------------------------
const GLOSSARY = {
    domain: ['Domain', "Your website's address, like yourbusiness.com. It is rented, so it has to be renewed or it expires."],
    ssl: ['SSL certificate (the padlock)', 'The little lock beside your address in a web browser. It shows your site is genuine and scrambles anything visitors send you, like a form.'],
    dns: ['DNS', "The internet's phone book. It tells browsers which computer your website lives on."],
    redirect: ['Redirect', 'An automatic forward from one web address to another.'],
    analytics: ['Google Analytics', "A free Google tool that counts visitors and shows which pages they look at. It doesn't record names or personal details."],
    visit: ['Visit', 'One trip to your website. If the same person comes back tomorrow, that is a new visit, but they are still counted only once as a person for the week.'],
    engaged: ['Engaged visit', 'A visit where the person stayed at least 10 seconds, looked at two or more pages, or did something like tapping a button.'],
    seo: ['SEO', 'Making it easier for Google to find your website and understand what it is about.'],
    description: ['Search description', "The short blurb Google shows under your website's name in search results."],
    sitemap: ['Sitemap', 'A list of your pages that you hand to Google, like a table of contents.'],
    wordpress: ['WordPress', 'The software many websites are built with. Like the apps on your phone, it needs regular updates.'],
    plugin: ['Plugin', 'An add-on that gives a WordPress site extra features, such as a contact form or a photo gallery.'],
    spf: ['SPF and DMARC', 'Settings on your domain that prove emails from you are really from you, so they are less likely to land in spam or be faked by someone else.'],
    alt: ['Picture descriptions', 'A short written description attached to a picture. Visitors who use screen readers hear it read aloud, and Google uses it to understand the picture.'],
    mixed: ['Insecure items', 'Parts of a page (like a picture) that load without protection even though the rest of the page is secure.'],
    headers: ['Security settings', 'Behind-the-scenes instructions your website gives to browsers to keep visitors safer.'],
    cloudflare: ['Cloudflare', 'A protective shield that sits in front of your website, blocking harmful traffic and helping pages load faster.'],
    brokenLink: ['Broken link', 'A link that leads to a "page not found" error.'],
    api: ['API', 'A connection point that lets two pieces of software talk to each other, such as your app and a payment service.'],
    webhook: ['Webhook', 'An automatic message one system sends to another when something happens, such as a new order.']
};

const GROUPS = [
    { id: 'online', title: 'Is your website up and running?' },
    { id: 'speed', title: 'How fast does it load?' },
    { id: 'security', title: 'Is it safe for your visitors?' },
    { id: 'domain', title: 'Your web address and email' },
    { id: 'search', title: 'Can people find you?' },
    { id: 'upkeep', title: 'Keeping things up to date' },
    { id: 'services', title: 'Your connected services' }
];

// Order inside the report (also used to sort items within a group).
const ORDER = ['UPTIME', 'PERF_LIGHT', 'PAGESPEED', 'SSL', 'HTTPS_REDIRECT', 'REDIRECT', 'MIXED_CONTENT', 'SECURITY_HEADERS', 'DOMAIN_EXPIRY', 'DNS', 'EMAIL_DNS', 'SEO_BASICS', 'MOBILE_READY', 'SITEMAP_ROBOTS', 'IMAGES_ALT', 'CMS_DETECT', 'PLUGIN_UPDATES', 'BROKEN_LINKS', 'CONTENT_PAGES', 'ANALYTICS_TAG', 'API_HEALTH', 'WEBHOOK'];

/** Friendly one-line names, used where only a label is needed (monthly summary, admin lists). */
const FRIENDLY_NAMES = {
    UPTIME: 'Website online', PERF_LIGHT: 'Page speed', PAGESPEED: 'Google speed test', SSL: 'Security padlock (SSL)',
    HTTPS_REDIRECT: 'Secure forwarding', REDIRECT: 'Secure forwarding', MIXED_CONTENT: 'Insecure page items', SECURITY_HEADERS: 'Extra security settings',
    DOMAIN_EXPIRY: 'Domain renewal date', DNS: 'Web address connection', EMAIL_DNS: 'Business email protection', SEO_BASICS: 'Google search basics',
    MOBILE_READY: 'Works on phones', SITEMAP_ROBOTS: 'Google site map', IMAGES_ALT: 'Picture descriptions', CMS_DETECT: 'Website software',
    PLUGIN_UPDATES: 'Plugin updates', BROKEN_LINKS: 'Broken links', CONTENT_PAGES: 'Page review', ANALYTICS_TAG: 'Visitor counting',
    GA_TRAFFIC: 'Visitor statistics', API_HEALTH: 'Connected service', WEBHOOK: 'Automation hook', PAGE_PROFILE: 'Homepage snapshot'
};

function friendlyName(code) { return FRIENDLY_NAMES[code] || String(code || 'Check').replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()); }

// -----------------------------------------------------------------------------
// "What happens next" wording
// -----------------------------------------------------------------------------
/**
 * Who does the fixing, and what it costs the client, depends on the plan:
 *  - Web Maintenance includes up to five website updates a month (any kind of change counts).
 *  - Content Refresh adds unlimited edits to the website's content (text, titles, descriptions,
 *    pictures, links), but technical work (updates, security, speed) still uses the monthly updates.
 *  - Smaller plans are simply invited to reply.
 * @param {'content'|'technical'} kind
 */
function fixAction(env, what = 'this', kind = 'technical') {
    const tier = env.tier;
    const reply = 'Just reply to this email and we will take care of it.';
    if (tier && tier.rank >= 4 && kind === 'content') return `This kind of edit is covered by the unlimited content edits in your plan. ${reply}`;
    if (tier && tier.rank >= 3) return `Fixing ${what} counts as one of the up to five website updates included in your plan each month. ${reply}`;
    return `Reply to this email and we will tell you how we can help with ${what}.`;
}

function alertedLine(env) {
    return env.alerted
        ? 'Our team has already been alerted and is looking into it.'
        : 'Please reply to this email so we can look into it straight away.';
}

// -----------------------------------------------------------------------------
// Per-check explanations
// -----------------------------------------------------------------------------
const FETCH_FAIL = [
    [/ENOTFOUND|EAI_AGAIN/i, 'Your web address is not pointing at a website right now.'],
    [/ETIMEDOUT|timed out|timeout/i, 'Your website took too long to answer (more than 12 seconds).'],
    [/ECONNREFUSED/i, 'The computer that hosts your website refused the connection.'],
    [/ECONNRESET|socket hang up/i, 'The connection to your website was cut off before it answered.'],
    [/CERT|SSL|TLS|self.signed|altname/i, 'The security padlock has a problem, so browsers will show a warning.'],
    [/REDIRECT_LOOP|Too many redirects/i, 'Your website kept forwarding us from page to page without ever showing a page.']
];

const RULES = {
    UPTIME(item, env) {
        const e = item.evidence || {};
        const base = { group: 'online', title: 'Is your website open for business?', glossary: [] };
        if (item.status === 'pass') {
            const via = e.finalUrl && !sameSite(e.finalUrl, env.siteUrl) ? ` It forwards visitors to ${normHost(e.finalUrl)}.` : '';
            const retry = e.attempts > 1 ? ' Our first try hit a brief hiccup, but the second try worked straight away. If you ever notice this yourself, please tell us.' : '';
            const answer = e.ttfbMs ? `, and it began answering in ${fmt.seconds(e.ttfbMs)}` : '';
            return { ...base, headline: 'Yes — your website is online.', detail: `We visited ${env.host} and it opened normally${answer}.${via}${retry}`, meaning: 'That means customers can reach you right now.' };
        }
        if (item.status === 'warn') {
            const loop = e.tooManyRedirects || (e.statusCode >= 300 && e.statusCode < 400);
            if (loop) return { ...base, headline: 'Your website is sending visitors around in circles.', detail: 'When we visited, it kept forwarding us from one address to another instead of showing a page. This is called a redirect loop.', meaning: 'Visitors could see an error instead of your website.', action: `${fixAction(env, 'the forwarding settings')} ${alertedLine(env)}`, who: 'us', glossary: ['redirect'] };
            return { ...base, headline: 'Your website answered, but it turned our visit away.', detail: `It replied with code ${e.statusCode}, which usually means a security setting blocked our automatic visit.`, meaning: 'Real visitors are usually not affected by this, but we cannot be certain from here.', action: 'We will double-check this for you.', who: 'us' };
        }
        // fail
        let why = FETCH_FAIL.find(([pattern]) => pattern.test(`${e.errorCode || ''} ${e.error || ''}`))?.[1];
        if (!why && e.statusCode >= 500) why = `Your website's server reported an error (code ${e.statusCode}).`;
        if (!why && (e.statusCode === 404 || e.statusCode === 410)) why = `Your website says the page cannot be found (code ${e.statusCode}).`;
        if (!why && e.statusCode) why = `Your website replied with an error (code ${e.statusCode}).`;
        return {
            ...base, headline: "We couldn't open your website.",
            detail: `${why || 'Something stopped us from opening it.'}${e.attempts > 1 ? ' We tried twice, a few seconds apart, to be sure.' : ''}`,
            meaning: 'If visitors see this too, they cannot reach you, which can cost you customers.',
            action: alertedLine(env), who: 'us', critical: true
        };
    },

    PERF_LIGHT(item, env) {
        const e = item.evidence || {};
        const total = e.totalDuration ?? e.durationMs ?? null;
        const secs = fmt.seconds(total);
        const base = { group: 'speed', title: 'How quickly does your homepage open?', glossary: [] };
        const size = fmt.bytes(e.sizeBytes);
        const factors = [];
        if (e.sizeBytes > 2.5 * 1024 * 1024) factors.push(`the page is large (${size})`);
        if (e.compression === null && e.sizeBytes > 100 * 1024) factors.push('its files are not compressed');
        if (e.imageCount > 25) factors.push(`it holds ${e.imageCount} pictures`);
        if (e.scriptCount > 25) factors.push(`it loads ${e.scriptCount} bits of add-on code`);
        const because = factors.length ? ` Likely reasons: ${fmt.list(factors)}.` : '';
        const note = ' (Measured from our monitoring computer, so visitors near you may see slightly different speeds.)';
        if (item.status === 'pass') return { ...base, headline: `Fast — it opened in ${secs}.`, detail: `A page that opens in a second or two feels quick to visitors.${size ? ` The page weighs about ${size}.` : ''}${note}`, meaning: 'Quick pages keep visitors around and are favoured by Google.' };
        if (item.status === 'warn') return { ...base, headline: `A little slow — it took ${secs} to open.`, detail: `Most visitors expect a page to open within a couple of seconds, and many lose patience after three.${because}${note}`, meaning: 'A slow page can send visitors away before they see anything.', action: `Compressing pictures and trimming extras usually helps. ${fixAction(env, 'this')}`, who: 'us' };
        if (item.status === 'fail') return { ...base, headline: `Slow — it took ${secs || 'a long time'} to open.`, detail: `Anything over about three seconds frustrates visitors.${because}${note}`, meaning: 'Slow pages lose visitors and can drag down your place in Google.', action: `${fixAction(env, 'this')} ${alertedLine(env)}`, who: 'us' };
        return null;
    },

    PAGESPEED(item) {
        const e = item.evidence || {};
        if (item.status === 'skip' || typeof e.score !== 'number') return null;
        const word = e.score >= 90 ? 'excellent' : e.score >= 70 ? 'good' : e.score >= 50 ? 'only fair' : 'on the low side';
        const plainOpp = {
            'uses-optimized-images': 'Pictures could be squeezed smaller without looking worse',
            'modern-image-formats': 'Pictures could use newer, lighter file types',
            'offscreen-images': 'Pictures far down the page are loading too early',
            'unused-javascript': "Some add-on code isn't actually needed",
            'unused-css-rules': "Some styling code isn't actually needed",
            'render-blocking-resources': 'Some files hold up the page from appearing',
            'uses-text-compression': 'Text files are not compressed',
            'unminified-javascript': 'Add-on code could be trimmed',
            'unminified-css': 'Styling code could be trimmed',
            'server-response-time': 'The server is slow to start answering',
            'uses-responsive-images': 'Pictures are bigger than they need to be on phones',
            'efficiently-encode-images': 'Pictures could be saved more efficiently'
        };
        const opps = (e.opportunities || []).map(o => `${plainOpp[o.id] || o.title} (could save about ${fmt.seconds(o.savingsMs)})`);
        const lcp = e.lcpMs ? ` On a phone, the main part of your page appears after about ${fmt.seconds(e.lcpMs)}.` : '';
        return {
            group: 'speed', title: "What does Google's own speed test say?",
            headline: `Google's speed test scores your page ${e.score} out of 100 on a phone — ${word}.`,
            detail: `This is the same test Google uses to judge websites.${lcp}${opps.length ? ` The biggest ways to improve: ${fmt.list(opps)}.` : ''}`,
            meaning: item.status === 'pass' ? 'Your page is in good shape for phone visitors.' : 'Phone visitors may wait longer than they would like.',
            action: item.status === 'pass' ? null : 'We can work through these improvements for you — just reply to this email.', who: item.status === 'pass' ? null : 'us', glossary: []
        };
    },

    SSL(item, env) {
        const e = item.evidence || {};
        const base = { group: 'security', title: 'Is your security padlock valid?', glossary: ['ssl'] };
        const until = e.validTo ? fmt.date(e.validTo) : null;
        if (item.status === 'pass') return { ...base, headline: `Yes — your padlock is valid until ${until} (${fmt.plural(e.daysRemaining, 'day')} from now).`, detail: `That is the little lock beside your address in the browser.${e.issuer ? ` It was issued by ${e.issuer}.` : ''}`, meaning: 'Visitors see that your site is genuine and their information is protected.' };
        if (item.status === 'warn') {
            if (e.authorizationError && e.daysRemaining >= 21) return { ...base, headline: 'Your padlock works, but it has a small technical flaw.', detail: 'Part of the certificate setup is incomplete, so some older phones or browsers may show a warning.', meaning: 'Most visitors will not notice, but it is worth tidying up.', action: 'We will look at this for you.', who: 'us' };
            return { ...base, headline: `Your padlock runs out in ${fmt.plural(e.daysRemaining, 'day')} (${until}).`, detail: 'These normally renew by themselves a few weeks before the end date.', meaning: 'If it were to lapse, visitors would see a "Not secure" warning.', action: 'We are keeping a close eye on it to make sure it renews.', who: 'us' };
        }
        if (item.status === 'fail') {
            if (e.daysRemaining < 0) return { ...base, headline: `Your security padlock expired on ${until}.`, detail: 'Browsers show a big warning page to anyone visiting a site whose padlock has expired.', meaning: 'Many visitors will turn back rather than continue.', action: `${alertedLine(env)} Renewing it is usually quick.`, who: 'us', critical: true };
            if (e.authorizationError && /ALTNAME|SELF_SIGNED|REVOKED/.test(e.authorizationError)) return { ...base, headline: `The padlock on ${env.host} is not valid for this address.`, detail: 'The certificate was issued for a different address or is not from a trusted provider, so browsers will show a warning.', meaning: 'Many visitors will turn back rather than continue.', action: alertedLine(env), who: 'us', critical: true };
            return { ...base, headline: `Your padlock expires in just ${fmt.plural(e.daysRemaining, 'day')}.`, detail: 'It should have renewed by now, so something may be wrong with the automatic renewal.', meaning: 'If it lapses, visitors will see a "Not secure" warning.', action: alertedLine(env), who: 'us', critical: true };
        }
        return null;
    },

    HTTPS_REDIRECT(item, env) {
        const e = item.evidence || {};
        const base = { group: 'security', title: 'Do visitors always land on the safe version?', glossary: ['redirect'] };
        if (item.status === 'pass') return { ...base, headline: 'Yes — visitors who type the non-secure address are sent to the secure one.', detail: 'If someone types http:// instead of https://, your website forwards them automatically.', meaning: 'Everyone ends up on the protected version of your site.' };
        if (item.status === 'warn') return { ...base, headline: 'Not quite — the non-secure address does not forward to the secure one.', detail: 'Someone who types http:// could end up on an unprotected copy of your site.', meaning: 'Their visit would not have the padlock.', action: `It is a quick settings change. ${fixAction(env, 'this')}`, who: 'us' };
        return { ...base, headline: 'Only the secure version of your website responds.', detail: 'That is fine — browsers will use the secure version.', meaning: null };
    },

    MIXED_CONTENT(item, env) {
        const e = item.evidence || {};
        const base = { group: 'security', title: 'Does everything on your page load securely?', glossary: ['mixed'] };
        if (item.status === 'pass') return { ...base, headline: 'Yes — everything on your homepage loads securely.', detail: 'No pictures, scripts or other parts of the page are loading without protection.' };
        if (item.status === 'warn') return { ...base, headline: `${fmt.plural(e.count, 'item')} on your homepage load without protection.`, detail: 'Even though the page itself is secure, these parts are not, which can make a browser show a "not fully secure" warning.', meaning: 'It can quietly erode visitors’ trust.', action: `${fixAction(env, 'this')}`, who: 'us' };
        return null;
    },

    SECURITY_HEADERS(item, env) {
        const e = item.evidence || {};
        const plain = {
            'Strict-Transport-Security': 'always using the secure version',
            'X-Content-Type-Options': 'stopping browsers guessing file types (a hacker trick)',
            'Clickjacking protection': "stopping other sites from showing yours in a hidden frame",
            'Referrer-Policy': 'limiting what is shared when visitors click away',
            'Content-Security-Policy': 'controlling which sources may run on your page'
        };
        const base = { group: 'security', title: 'Does your site use extra protective settings?', glossary: ['headers'] };
        const missing = (e.missing || []).map(m => plain[m]).filter(Boolean);
        if (item.status === 'pass') return { ...base, headline: `Yes — ${e.count} of ${e.total} recommended protective settings are switched on.`, detail: 'That is a strong setup that makes it harder for attackers to misuse your site.' };
        return {
            ...base, headline: e.count === 0 ? 'None of the optional extra protective settings are switched on yet.' : `${e.count} of ${e.total} optional extra protective settings are switched on.`,
            detail: `This is not an error — think of them as extra locks on a door that already has a good lock.${missing.length ? ` Not switched on yet: ${fmt.list(missing)}.` : ''}`,
            meaning: null, fyi: true
        };
    },

    DOMAIN_EXPIRY(item, env) {
        const e = item.evidence || {};
        const base = { group: 'domain', title: 'Is your domain (web address) paid up?', glossary: ['domain'] };
        const managed = env.tier && env.tier.rank >= 2;
        const dom = e.domain || env.domain || env.host;
        if (item.status === 'pass') return { ...base, headline: `Yes — ${dom} is registered until ${fmt.date(e.expiresAt)}.`, detail: `That is ${fmt.plural(e.daysRemaining, 'day')} away.${e.registrar ? ` It is registered through ${String(e.registrar).replace(/\.+$/, '')}.` : ''}${managed ? ' We look after renewals for you, so there is nothing for you to do.' : ''}`, meaning: 'Your website and email addresses will keep working.' };
        if (item.status === 'warn') return { ...base, headline: `Your domain comes up for renewal in ${fmt.plural(e.daysRemaining, 'day')} (${fmt.date(e.expiresAt)}).`, detail: managed ? 'Renewals are part of your plan, so we will take care of it.' : 'Please make sure it is renewed before then, or ask us to help.', meaning: 'If a domain lapses, the website and any email addresses that use it stop working.', action: managed ? 'No action needed from you.' : 'Reply to this email if you would like us to handle it.', who: managed ? 'us' : 'you' };
        if (item.status === 'fail') return { ...base, headline: e.daysRemaining < 0 ? `Your domain ${dom} has expired.` : `Your domain ${dom} expires in just ${fmt.plural(e.daysRemaining, 'day')}.`, detail: 'This is urgent. Once a domain expires, the website and any email addresses that use it can stop working.', meaning: 'It can take days to recover a domain that has fully lapsed.', action: managed ? `${alertedLine(env)} We will renew it right away.` : 'Please reply to this email today.', who: 'us', critical: true };
        // info: some countries do not publish expiry dates
        const tld = String(dom).split('.').slice(-1)[0];
        return { ...base, headline: `We can't read the renewal date for ${dom} automatically.`, detail: `Addresses ending in .${tld} do not publish this publicly.${managed ? ' We keep track of your renewal date for you.' : ' It is worth keeping a note of your renewal date so it never lapses.'}`, meaning: null };
    },

    DNS(item, env) {
        const e = item.evidence || {};
        const base = { group: 'domain', title: 'Is your web address connected properly?', glossary: ['dns'] };
        if (item.status === 'pass') {
            const alt = e.alternateHost;
            const extra = alt ? (e.alternateResolves
                ? ` The version with${/^www\./.test(alt) ? '' : 'out'} "www" works too, so both ways of typing it arrive safely.`
                : ` Heads up: ${alt} does not work, so someone who types your address that way may see an error.`) : '';
            return { ...base, headline: 'Yes — your web address points to the right place.', detail: `${e.host || env.host} is connected to a computer on the internet${e.ip ? ` (${e.ip})` : ''}.${extra}`, tip: alt && e.alternateResolves === false ? { title: `Make ${alt} work too`, why: 'Some visitors type your address with or without "www". Right now one of those ways shows an error.', how: fixAction(env, 'this'), priority: 2 } : null };
        }
        return { ...base, headline: "Your web address isn't connected to a website right now.", detail: 'We could not find where your address points to.', meaning: 'Visitors typing your address will not reach your website.', action: alertedLine(env), who: 'us', critical: true };
    },

    EMAIL_DNS(item, env) {
        const e = item.evidence || {};
        const base = { group: 'domain', title: 'Is your business email set up to be trusted?', glossary: ['spf'] };
        if (e.hasMail === false) return null; // no email on this domain: nothing to report
        if (item.status === 'pass') return { ...base, headline: 'Yes — emails from your domain are set up to prove they are genuine.', detail: 'Your domain has the settings (SPF and DMARC) that help your emails reach inboxes and stop others from faking them.' };
        if (item.status === 'warn') return { ...base, headline: 'Emails sent from your domain are more likely to land in spam.', detail: 'Your domain does not yet say which servers are allowed to send email for you (an SPF record).', meaning: 'Customers may miss messages because they end up in the spam folder.', action: `It is a small setting. ${fixAction(env, 'this')}`, who: 'us' };
        return { ...base, headline: 'Good — and one optional extra is available for your business email.', detail: 'Your email is set up to be trusted. Adding a DMARC record would also stop other people faking emails that look like they came from you.', meaning: null };
    },

    SEO_BASICS(item, env) {
        const e = item.evidence || {};
        const base = { group: 'search', title: 'Can Google understand your homepage?', glossary: ['seo', 'description'] };
        if (item.status === 'pass') return { ...base, headline: 'Yes — your homepage has a title, a description and a main headline.', detail: 'These are the three things Google reads first to decide what your page is about.' };
        if (item.status === 'warn') {
            const gaps = [];
            if (!e.description) gaps.push('a short description (the blurb Google shows under your name)');
            if (!e.h1Count) gaps.push('a main headline');
            return { ...base, headline: `Your homepage is missing ${fmt.list(gaps)}.`, detail: 'Without these, Google has to guess what to show people, and it often guesses badly.', meaning: 'A better description and headline can bring more people to click on your result.', action: `This is a quick fix. ${fixAction(env, 'this', 'content')}`, who: 'us' };
        }
        if (e.noindex) return { ...base, headline: 'Your homepage is telling Google NOT to list it.', detail: 'There is a hidden instruction on the page that asks search engines to leave it out of their results.', meaning: 'Unless that is on purpose, nobody can find you on Google.', action: `${alertedLine(env)} If this was on purpose, just let us know.`, who: 'us', critical: true };
        return { ...base, headline: 'Your homepage has no title.', detail: 'The title is the clickable headline Google shows in search results.', meaning: 'Without one, Google makes something up from the page.', action: fixAction(env, 'this', 'content'), who: 'us' };
    },

    MOBILE_READY(item, env) {
        const base = { group: 'search', title: 'Does your page work on phones?', glossary: [] };
        if (item.status === 'pass') return { ...base, headline: 'Yes — your page is set up to fit phone screens.', detail: 'Most people browse on their phones, so this matters.' };
        return { ...base, headline: "Your page isn't set up for phone screens.", detail: 'It is missing the setting that tells phones to fit the page to their screen.', meaning: 'Visitors on phones may have to pinch and zoom just to read it.', action: fixAction(env, 'this'), who: 'us' };
    },

    SITEMAP_ROBOTS(item, env) {
        const e = item.evidence || {};
        const base = { group: 'search', title: 'Does Google have a map of your website?', glossary: ['sitemap'] };
        if (item.status === 'pass') return { ...base, headline: `Yes — your sitemap lists ${fmt.plural(e.urlCount, e.sitemapIsIndex ? 'section' : 'page')}.`, detail: 'A sitemap helps Google find all your pages.' };
        if (item.status === 'fail') return { ...base, headline: 'Your website is telling Google to stay away.', detail: 'A file called robots.txt asks every search engine to skip your whole website.', meaning: 'Unless that is on purpose, nobody can find you on Google.', action: `${alertedLine(env)} If this was on purpose, just let us know.`, who: 'us', critical: true };
        return { ...base, headline: "We couldn't find a sitemap for your website.", detail: 'A sitemap is like a table of contents that you hand to Google so it can find all your pages.', meaning: null, tip: { title: 'Add a sitemap', why: 'Without a sitemap, Google can miss some of your pages.', how: `It is a quick job. ${fixAction(env, 'this')}`, priority: 3 } };
    },

    IMAGES_ALT(item, env) {
        const e = item.evidence || {};
        const base = { group: 'search', title: 'Do your pictures have descriptions?', glossary: ['alt'] };
        if (item.status === 'pass') return { ...base, headline: 'Yes — your homepage pictures all have written descriptions.', detail: 'That helps visitors who cannot see the pictures and helps Google understand them.' };
        if (item.status === 'warn') return { ...base, headline: `${e.missingAlt} of your ${e.total} homepage pictures have no written description.`, detail: 'Visitors using screen readers hear nothing for those pictures, and Google cannot tell what they show.', meaning: 'Adding descriptions helps people and helps you show up in image searches.', action: `It is a quick fix. ${fixAction(env, 'this', 'content')}`, who: 'us' };
        return null;
    },

    CMS_DETECT(item, env) {
        const e = item.evidence || {};
        const base = { group: 'upkeep', title: 'Is your website software up to date?', glossary: [] };
        if (item.status === 'warn') return { ...base, glossary: ['wordpress'], headline: `Your WordPress (version ${e.version}) is behind the latest version (${e.latestVersion}).`, detail: 'Updates fix security holes that attackers look for and keep everything running smoothly.', meaning: 'An out-of-date WordPress is the most common way websites get hacked.', action: `${fixAction(env, 'the update')}`, who: 'us' };
        const managedPlatforms = ['Wix', 'Shopify', 'Squarespace', 'Webflow', 'GoDaddy Website Builder', 'Weebly'];
        if (e.platform === 'WordPress') {
            return { ...base, glossary: ['wordpress'], headline: e.version ? `Your website runs on WordPress ${e.version}, which is up to date.` : 'Your website runs on WordPress.', detail: e.version ? '' : 'The exact version is hidden from the public, which is good for security, so we cannot compare it with the latest release from the outside.', meaning: null, fyi: true };
        }
        if (managedPlatforms.includes(e.platform)) return { ...base, headline: `Your website is built with ${e.platform}.`, detail: `${e.platform} looks after its own software updates, so there is nothing to patch on your side.`, meaning: null, fyi: true };
        if (e.platform) return { ...base, headline: `Your website is built with ${e.platform}.`, detail: '', meaning: null, fyi: true };
        return null;
    },

    PLUGIN_UPDATES(item, env) {
        const e = item.evidence || {};
        const base = { group: 'upkeep', title: 'Are your plugins up to date?', glossary: ['plugin'] };
        if (item.status === 'skip') return null;
        if (item.status === 'pass') return { ...base, headline: `Yes — the ${fmt.plural(e.checked, 'plugin')} we can see ${e.checked === 1 ? 'is' : 'are'} on the latest version.`, detail: 'Plugins are the most common way attackers get into WordPress sites, so staying current matters.' };
        if (item.status === 'warn') {
            const names = (e.outdated || []).slice(0, 4).map(p => `${p.name} (${p.installed} → ${p.latest})`);
            return { ...base, headline: `${fmt.plural(e.outdated.length, 'plugin')} ${e.outdated.length === 1 ? 'has' : 'have'} a newer version available.`, detail: `Out of date: ${fmt.list(names)}${e.outdated.length > 4 ? ' and more' : ''}.`, meaning: 'Old plugins can have known security holes.', action: fixAction(env, 'the updates'), who: 'us' };
        }
        return { ...base, headline: "We can't see plugin versions from the outside.", detail: 'That is common and not a problem in itself.', meaning: null, fyi: true };
    },

    BROKEN_LINKS(item, env) {
        const e = item.evidence || {};
        const base = { group: 'upkeep', title: 'Do the links on your homepage work?', glossary: ['brokenLink'] };
        const unverified = e.unverifiable ? ` (${fmt.plural(e.unverifiable, 'link')} could not be tested because those websites block automatic visitors.)` : '';
        if (item.status === 'pass') return { ...base, headline: `Yes — we tested ${fmt.plural(e.checked, 'link')} and none are broken.`, detail: `Every link we tried opened properly.${unverified}` };
        const list = (e.broken || []).slice(0, 5).map(b => {
            let where = b.url;
            try { const u = new URL(b.url); where = `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`; } catch (_) { /* keep raw */ }
            return `${b.text ? `"${b.text}" → ` : ''}${where}`;
        });
        return { ...base, headline: `${fmt.plural(e.broken.length, 'link')} on your homepage lead nowhere.`, detail: `Broken: ${list.join('; ')}${e.broken.length > 5 ? '; and more' : ''}.${unverified}`, meaning: 'Visitors who click these see an error page, which looks unprofessional and can hurt your place in Google.', action: `We can repair or remove them. ${fixAction(env, 'this', 'content')}`, who: 'us' };
    },

    CONTENT_PAGES(item, env) {
        const e = item.evidence || {};
        const base = { group: 'search', title: 'A closer look at your pages', glossary: ['description'] };
        const pages = e.pages || [];
        if (!pages.length) return null;
        const gaps = [];
        const noTitle = pages.filter(p => p.status === 200 && !p.title).map(p => p.path);
        const noDesc = pages.filter(p => p.status === 200 && !p.description).map(p => p.path);
        if (noTitle.length) gaps.push(`${fmt.plural(noTitle.length, 'page')} without a title (${fmt.list(noTitle.slice(0, 3))})`);
        if (noDesc.length) gaps.push(`${fmt.plural(noDesc.length, 'page')} without a description (${fmt.list(noDesc.slice(0, 3))})`);
        const bad = pages.filter(p => p.status === null || p.status >= 400).map(p => p.path);
        if (item.status === 'pass') return { ...base, headline: `We opened ${fmt.plural(pages.length, 'page')} and all of them look complete.`, detail: 'Every one opened properly and has a title and a description for Google.' };
        if (item.status === 'fail') return { ...base, headline: `${fmt.plural(bad.length, 'page')} would not open properly.`, detail: `Problem pages: ${fmt.list(bad.slice(0, 5))}.`, meaning: 'Visitors who land on them see an error.', action: fixAction(env, 'this', 'content'), who: 'us' };
        return { ...base, headline: 'Some of your pages are missing details Google likes to see.', detail: `We found ${fmt.list(gaps)}.`, meaning: 'Pages with a clear title and description tend to get clicked more in search results.', action: fixAction(env, 'this', 'content'), who: 'us' };
    },

    ANALYTICS_TAG(item) {
        const e = item.evidence || {};
        const base = { group: 'search', title: 'Is visitor counting installed?', glossary: ['analytics'] };
        if (item.status === 'pass') return { ...base, headline: 'Yes — your website has visitor counting installed.', detail: `We found Google's counting code (${[...(e.gaIds || []), ...(e.gtmIds || [])].slice(0, 2).join(', ')}) on your homepage.`, fyi: true, hide: true };
        return { ...base, headline: "Your website isn't counting visitors yet.", detail: "We couldn't find Google's visitor-counting code on your homepage.", meaning: 'Without it, nobody can tell how many people visit or which pages they like.', hide: true };
    },

    API_HEALTH(item, env) {
        const e = item.evidence || {};
        const host = normHost(String(item.label || '').replace(/^API \(|\)$/g, '')) || 'your service';
        const base = { group: 'services', title: `Is ${host} responding?`, glossary: ['api'] };
        if (item.status === 'skip') return { ...base, headline: `We did not test ${host}.`, detail: e.reason === 'placeholder' ? 'The address saved for it is a template that is not a real, testable address.' : 'The address could not be tested.', meaning: null, fyi: true };
        if (item.status === 'pass') return { ...base, headline: `Yes — ${host} is responding normally.`, detail: `It answered in ${fmt.seconds(e.durationMs) || 'a moment'}.` };
        if (item.status === 'warn') return { ...base, headline: `${host} responded, but not in the expected format.`, detail: 'It answered, but not with the structured data we expected.', meaning: 'The service may be working, but something about its reply has changed.', action: 'We will take a closer look.', who: 'us' };
        return { ...base, headline: `${host} is not responding properly.`, detail: e.statusCode ? `It replied with error code ${e.statusCode}.` : (e.timeout ? 'It took too long to answer.' : 'We could not connect to it.'), meaning: 'Anything in your business that depends on it may not be working.', action: alertedLine(env), who: 'us', critical: true };
    },

    WEBHOOK(item, env) {
        const base = { group: 'services', title: 'Is your automation connection reachable?', glossary: ['webhook'] };
        if (item.status === 'pass') return { ...base, headline: 'Yes — your automation connection is reachable.', detail: 'It accepted our test message.' };
        return { ...base, headline: 'Your automation connection did not respond.', detail: 'We could not reach it with our test message.', meaning: 'Automatic steps that depend on it may not be running.', action: alertedLine(env), who: 'us', critical: true };
    }
};

// Old runs stored the secure-redirect check under the code REDIRECT.
RULES.REDIRECT = (item, env) => {
    const e = item.evidence || {};
    if (e.redirectsToHttps !== undefined) return RULES.HTTPS_REDIRECT(item, env);
    // Stored by the old check suite. Its "warn" only meant the address answered directly instead of
    // forwarding, which is normal and healthy, so it is shown as information, never as a problem.
    const base = { group: 'security', title: 'Does your site forward visitors correctly?', glossary: ['redirect'] };
    if (item.status === 'pass') return { ...base, headline: 'Yes — your site forwards visitors to the right address.', detail: '' };
    return { ...base, status: 'info', headline: 'Your address opens directly, without forwarding.', detail: 'That is normal and fine.', meaning: null, fyi: true };
};

// Group + question for each check, used when a check could not run this week.
const META = {
    UPTIME: ['online', 'Is your website open for business?'],
    PERF_LIGHT: ['speed', 'How quickly does your homepage open?'],
    PAGESPEED: ['speed', "What does Google's own speed test say?"],
    SSL: ['security', 'Is your security padlock valid?'],
    HTTPS_REDIRECT: ['security', 'Do visitors always land on the safe version?'],
    REDIRECT: ['security', 'Does your site forward visitors correctly?'],
    MIXED_CONTENT: ['security', 'Does everything on your page load securely?'],
    SECURITY_HEADERS: ['security', 'Does your site use extra protective settings?'],
    DOMAIN_EXPIRY: ['domain', 'Is your domain (web address) paid up?'],
    DNS: ['domain', 'Is your web address connected properly?'],
    EMAIL_DNS: ['domain', 'Is your business email set up to be trusted?'],
    SEO_BASICS: ['search', 'Can Google understand your homepage?'],
    MOBILE_READY: ['search', 'Does your page work on phones?'],
    SITEMAP_ROBOTS: ['search', 'Does Google have a map of your website?'],
    IMAGES_ALT: ['search', 'Do your pictures have descriptions?'],
    CONTENT_PAGES: ['search', 'A closer look at your pages'],
    CMS_DETECT: ['upkeep', 'Is your website software up to date?'],
    PLUGIN_UPDATES: ['upkeep', 'Are your plugins up to date?'],
    BROKEN_LINKS: ['upkeep', 'Do the links on your homepage work?'],
    WEBHOOK: ['services', 'Is your automation connection reachable?']
};

// Reasons a check was skipped that are not worth mentioning to the reader.
const QUIET_SKIPS = new Set(['not-wordpress', 'no-key', 'no-html', 'not-https', 'bad-target', 'no-config']);

/**
 * Explains one stored check result.
 * @returns {object|null} null = nothing worth telling the reader about this item
 */
function explainItem(item, env = {}) {
    const code = item.item_code || item.code;
    const rule = RULES[code];
    const safeEnv = { host: '', siteUrl: '', ...env };
    if (item.status === 'skip' && code !== 'API_HEALTH') {
        const reason = item.evidence?.reason;
        const meta = META[code];
        if (!meta || QUIET_SKIPS.has(reason)) return null;
        return {
            code, status: 'skip', group: meta[0], title: meta[1], glossary: [],
            order: ORDER.indexOf(code) === -1 ? 999 : ORDER.indexOf(code),
            headline: 'Not checked this week.',
            detail: reason === 'unreachable' ? "We couldn't open your website, so we couldn't check this." : 'This check could not be completed this time. We will try again next week.',
            meaning: null
        };
    }
    if (!rule) {
        // A check we have no wording for: stay honest and use its own summary.
        return { code, group: 'services', status: item.status, title: item.label || friendlyName(code), headline: item.details || 'Checked', detail: '', meaning: null, glossary: [], order: 999 };
    }
    const out = rule(item, safeEnv);
    if (!out) return null;
    const status = item.status === 'skip' && out.status ? out.status : item.status;
    return { code, status, order: ORDER.indexOf(code) === -1 ? 999 : ORDER.indexOf(code), glossary: [], ...out };
}

module.exports = { explainItem, GROUPS, GLOSSARY, ORDER, fmt, friendlyName, normHost, sameSite, fixAction, alertedLine };
