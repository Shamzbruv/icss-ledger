/**
 * Pure HTML analysis helpers (no network). Everything in here takes the homepage HTML that
 * pageFetch.js already downloaded and extracts the facts the Client Care checks and the
 * plain-language report need.
 *
 * Client websites are untrusted input, so nothing here uses a regular expression that can
 * backtrack over the whole document (the classic "<a href=" repeated 50,000 times attack). The
 * document is scanned once with indexOf and a small tokenizer, so work grows in proportion to
 * the size of the page. Dependency-free on purpose.
 */

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•' };

const MAX_TAGS = 25000;          // enough for any real page; bounds memory on garbage input
const MAX_TAG_LENGTH = 20000;    // a single tag longer than this is not a real tag
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']); // content is text, not markup
const SKIP_FOR_TEXT = new Set(['script', 'style', 'noscript', 'svg', 'template']);

function decodeEntities(value) {
    return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
        if (body[0] === '#') {
            const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
            try { return String.fromCodePoint(code); } catch (_) { return match; }
        }
        const replacement = NAMED_ENTITIES[body.toLowerCase()];
        return replacement === undefined ? match : replacement;
    });
}

/** Lower-cases ASCII letters only, so the result has exactly the same length (indexes line up). */
function lowerAscii(value) {
    return String(value).replace(/[A-Z]+/g, match => match.toLowerCase());
}

/** Removes <...> tags in a single pass. A stray "<" with no ">" after it is kept as text. */
function stripTags(value) {
    const s = String(value ?? '');
    let out = '';
    let i = 0;
    while (i < s.length) {
        const lt = s.indexOf('<', i);
        if (lt === -1) { out += s.slice(i); break; }
        out += s.slice(i, lt);
        const gt = s.indexOf('>', lt + 1);
        if (gt === -1) { out += s.slice(lt); break; }
        out += ' ';
        i = gt + 1;
    }
    return out;
}

function squeeze(text, max = 0) {
    const out = decodeEntities(text).replace(/\s+/g, ' ').trim();
    return max && out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function collapse(value, max = 0) {
    return squeeze(stripTags(value), max);
}

function parseAttrs(tag) {
    const attrs = {};
    const text = String(tag);
    if (text.length > MAX_TAG_LENGTH) return attrs;
    const inner = text.replace(/^<\s*[a-z0-9:-]+/i, '').replace(/\/?>$/, '');
    const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;
    while ((match = pattern.exec(inner)) !== null) {
        const name = match[1].toLowerCase();
        if (!(name in attrs)) attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return attrs;
}

function normalizeHost(host) {
    return String(host || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function safeUrl(href, base) {
    try { return new URL(href, base); } catch (_) { return null; }
}

const isNameChar = code => (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45 || code === 58;

/**
 * One pass over the document. Returns every opening tag (name + position + raw text) and the
 * positions of closing tags, skipping comments and the contents of script/style/etc.
 */
function tokenize(html, lower) {
    const tags = [];
    const closers = Object.create(null);
    const n = html.length;
    let i = 0;
    while (i < n && tags.length < MAX_TAGS) {
        const lt = html.indexOf('<', i);
        if (lt === -1) break;
        if (html.startsWith('<!--', lt)) {
            const end = html.indexOf('-->', lt + 4);
            if (end === -1) break;
            i = end + 3;
            continue;
        }
        const isClose = html.charCodeAt(lt + 1) === 47; // "/"
        const nameStart = lt + (isClose ? 2 : 1);
        let nameEnd = nameStart;
        while (nameEnd < n && isNameChar(lower.charCodeAt(nameEnd))) nameEnd++;
        if (nameEnd === nameStart) { i = lt + 1; continue; } // "<" that does not start a tag
        const name = lower.slice(nameStart, nameEnd);
        const gt = html.indexOf('>', nameEnd);
        if (gt === -1) break; // unterminated: nothing after this can be terminated either
        if (isClose) {
            (closers[name] || (closers[name] = [])).push(lt);
            i = gt + 1;
            continue;
        }
        if (gt - lt <= MAX_TAG_LENGTH) tags.push({ name, start: lt, end: gt + 1, raw: html.slice(lt, gt + 1) });
        i = gt + 1;
        if (RAW_TEXT.has(name)) {
            const close = lower.indexOf(`</${name}`, i);
            if (close === -1) break;
            i = close; // the closing tag is picked up on the next loop
        }
    }
    return { tags, closers };
}

/** Visible words on the page: markup, scripts, styles and comments removed, in one pass. */
function visibleText(html, lower) {
    const n = html.length;
    const parts = [];
    let i = 0;
    while (i < n) {
        const lt = html.indexOf('<', i);
        if (lt === -1) { parts.push(html.slice(i)); break; }
        parts.push(html.slice(i, lt), ' ');
        if (html.startsWith('<!--', lt)) {
            const end = html.indexOf('-->', lt + 4);
            if (end === -1) break;
            i = end + 3;
            continue;
        }
        const isClose = html.charCodeAt(lt + 1) === 47;
        const nameStart = lt + (isClose ? 2 : 1);
        let nameEnd = nameStart;
        while (nameEnd < n && isNameChar(lower.charCodeAt(nameEnd))) nameEnd++;
        if (nameEnd === nameStart) { parts.push('<'); i = lt + 1; continue; }
        const name = lower.slice(nameStart, nameEnd);
        const gt = html.indexOf('>', nameEnd);
        if (gt === -1) break;
        i = gt + 1;
        if (!isClose && SKIP_FOR_TEXT.has(name)) {
            const close = lower.indexOf(`</${name}`, i);
            if (close === -1) break;
            const closeEnd = html.indexOf('>', close);
            i = closeEnd === -1 ? n : closeEnd + 1;
        }
    }
    return squeeze(parts.join(''));
}

/** Text between an opening tag and the next closing tag of that name (bounded). */
function makeTextReader(html, closers) {
    const cursors = Object.create(null);
    return (tag, name, maxChars) => {
        const list = closers[name] || [];
        let c = cursors[name] || 0;
        while (c < list.length && list[c] < tag.end) c++; // closers are in ascending order; so are tags
        cursors[name] = c;
        const limit = tag.end + maxChars;
        const stop = c < list.length ? Math.min(list[c], limit) : limit;
        return html.slice(tag.end, stop);
    };
}

function detectCms(lower, generator, plugins) {
    const gen = String(generator || '');

    const wpVersion = gen.match(/wordpress\s+([0-9][0-9.]*)/i)?.[1] || null;
    if (/wordpress/i.test(gen) || lower.includes('/wp-content/') || lower.includes('/wp-includes/') || lower.includes('rel="https://api.w.org/"')) {
        return { name: 'WordPress', version: wpVersion, versionHidden: !wpVersion, plugins };
    }
    if (/wix\.com/i.test(gen) || lower.includes('static.wixstatic.com') || lower.includes('wixsite.com')) return { name: 'Wix' };
    if (lower.includes('cdn.shopify.com') || lower.includes('shopify.theme')) return { name: 'Shopify' };
    if (/squarespace/i.test(gen) || lower.includes('static1.squarespace.com') || lower.includes('squarespace.com')) return { name: 'Squarespace' };
    if (/webflow/i.test(gen) || lower.includes('data-wf-site') || lower.includes('webflow.com')) return { name: 'Webflow' };
    if (/joomla/i.test(gen)) return { name: 'Joomla' };
    if (/drupal/i.test(gen) || lower.includes('/sites/default/files')) return { name: 'Drupal' };
    if (lower.includes('/_next/') || lower.includes('__next_data__')) return { name: 'Next.js' };
    if (lower.includes('___gatsby')) return { name: 'Gatsby' };
    if (lower.includes('__nuxt')) return { name: 'Nuxt' };
    if (/godaddy/i.test(gen) || lower.includes('img1.wsimg.com') || lower.includes('godaddy website builder')) return { name: 'GoDaddy Website Builder' };
    if (/weebly/i.test(gen) || lower.includes('weebly.com')) return { name: 'Weebly' };
    if (/elementor/i.test(gen)) return { name: 'WordPress' };
    return { name: null };
}

/** WordPress plugin slugs (and versions) from the URLs of scripts, styles and images. */
function extractPlugins(urls) {
    const found = new Map();
    const marker = '/wp-content/plugins/';
    for (const raw of urls.slice(0, 3000)) {
        const url = String(raw || '').slice(0, 2000);
        const at = url.toLowerCase().indexOf(marker);
        if (at === -1) continue;
        let p = at + marker.length;
        let slug = '';
        while (p < url.length && /[a-zA-Z0-9_-]/.test(url[p])) slug += url[p++];
        if (!slug || url[p] !== '/') continue;
        slug = slug.toLowerCase();
        let version = null;
        const ver = url.indexOf('ver=', p);
        if (ver !== -1 && url.indexOf('?') !== -1 && url.indexOf('?') < ver) {
            let q = ver + 4;
            let v = '';
            while (q < url.length && /[0-9a-zA-Z._-]/.test(url[q])) v += url[q++];
            if (/^[0-9]/.test(v)) version = v;
        }
        if (!found.has(slug) || (!found.get(slug).version && version)) found.set(slug, { slug, version });
        if (found.size >= 25) break;
    }
    return [...found.values()];
}

/**
 * @param {string} html   decoded homepage HTML
 * @param {string} baseUrl final URL of the page (used to resolve relative links)
 */
function analyzeHtml(html, baseUrl) {
    const source = String(html || '');
    const lower = lowerAscii(source);
    const base = safeUrl(baseUrl) || safeUrl('https://example.invalid');
    const isHttps = base.protocol === 'https:';
    const baseHost = normalizeHost(base.hostname);

    const { tags, closers } = tokenize(source, lower);
    const readText = makeTextReader(source, closers);
    const byName = name => tags.filter(t => t.name === name);

    const titleTag = tags.find(t => t.name === 'title');
    const title = titleTag ? collapse(readText(titleTag, 'title', 600), 300) : '';
    const htmlTag = tags.find(t => t.name === 'html');
    const lang = htmlTag ? (parseAttrs(htmlTag.raw).lang || null) : null;

    const metas = byName('meta').map(t => parseAttrs(t.raw));
    const metaByName = name => metas.find(m => (m.name || '').toLowerCase() === name)?.content;
    const metaByProp = prop => metas.find(m => (m.property || '').toLowerCase() === prop)?.content;

    const description = collapse(metaByName('description') || '', 400);
    const viewport = metaByName('viewport') || null;
    const robotsMeta = (metaByName('robots') || '').toLowerCase();
    const generator = metaByName('generator') || null;

    const links = byName('link').map(t => parseAttrs(t.raw));
    const canonical = links.find(l => (l.rel || '').toLowerCase().split(/\s+/).includes('canonical'))?.href || null;
    const hasFavicon = links.some(l => /\bicon\b/i.test(l.rel || ''));
    const stylesheets = links.filter(l => /\bstylesheet\b/i.test(l.rel || '')).length;

    const h1Tags = byName('h1').slice(0, 20); // a real page has one or two
    const h1Texts = h1Tags.map(t => collapse(readText(t, 'h1', 3000), 200)).filter(Boolean);
    const h2Count = byName('h2').length;

    const imgTags = byName('img').map(t => parseAttrs(t.raw));
    const imagesMissingAlt = imgTags.filter(i => !('alt' in i) || (i.alt || '').trim() === '');
    // Decorative images are allowed to have an explicit empty alt (alt=""), so only count
    // images with NO alt attribute at all as a real accessibility/SEO gap.
    const imagesNoAltAttr = imgTags.filter(i => !('alt' in i));

    const scriptTags = byName('script').map(t => parseAttrs(t.raw));
    const externalScripts = scriptTags.filter(s => s.src).length;
    const jsonLd = scriptTags.filter(s => (s.type || '').toLowerCase() === 'application/ld+json').length;

    // Links (anchors)
    const anchors = [];
    const seenLinks = new Set();
    for (const tag of byName('a')) {
        const attrs = parseAttrs(tag.raw);
        const href = (attrs.href || '').trim();
        if (!href || /^(#|mailto:|tel:|sms:|javascript:|data:)/i.test(href)) continue;
        const resolved = safeUrl(href, base.toString());
        if (!resolved || !/^https?:$/.test(resolved.protocol)) continue;
        resolved.hash = '';
        const key = resolved.toString();
        if (seenLinks.has(key)) continue;
        seenLinks.add(key);
        anchors.push({
            url: key,
            text: collapse(readText(tag, 'a', 600), 80),
            internal: normalizeHost(resolved.hostname) === baseHost
        });
        if (anchors.length >= 300) break;
    }

    const hasPhoneLink = byName('a').some(t => /\bhref\s*=\s*["']?\s*tel:/i.test(t.raw));
    const hasEmailLink = byName('a').some(t => /\bhref\s*=\s*["']?\s*mailto:/i.test(t.raw));
    const formCount = byName('form').length;

    // Mixed content: insecure sub-resources on an https page (anchors don't count).
    const mixedContent = [];
    if (isHttps) {
        const embedded = tags.filter(t => ['iframe', 'source', 'video', 'audio', 'embed'].includes(t.name)).map(t => parseAttrs(t.raw).src);
        const resourceTags = [
            ...imgTags.map(i => i.src),
            ...scriptTags.map(s => s.src),
            ...links.filter(l => /\b(stylesheet|preload|icon)\b/i.test(l.rel || '')).map(l => l.href),
            ...embedded
        ];
        for (const url of resourceTags) {
            if (url && /^http:\/\//i.test(url.trim())) mixedContent.push(url.trim());
            if (mixedContent.length >= 20) break;
        }
    }

    // Visitor-counting tags
    const gaIds = [...new Set([...source.matchAll(/\b(G-[A-Z0-9]{6,12})\b/g)].slice(0, 200).map(m => m[1]))];
    const gtmIds = [...new Set([...source.matchAll(/\b(GTM-[A-Z0-9]{4,10})\b/g)].slice(0, 200).map(m => m[1]))];
    const hasLegacyUA = /\bUA-\d{4,10}-\d{1,3}\b/.test(source);
    const hasMetaPixel = lower.includes('connect.facebook.net') && lower.includes('fbevents.js') || /fbq\s*\(\s*['"]init['"]/i.test(source);

    // Visible text size (a rough "how much content is on this page" figure)
    const textOnly = visibleText(source, lower);
    const wordCount = textOnly ? textOnly.split(' ').length : 0;

    const pluginUrls = [
        ...scriptTags.map(s => s.src), ...links.map(l => l.href), ...imgTags.map(i => i.src)
    ].filter(Boolean);
    const plugins = extractPlugins(pluginUrls);
    const cms = detectCms(lower, generator, plugins);

    return {
        title,
        titleLength: title.length,
        description,
        descriptionLength: description.length,
        lang,
        viewport,
        hasResponsiveViewport: !!viewport && /width\s*=\s*device-width/i.test(viewport),
        robotsMeta,
        noindex: /\bnoindex\b/.test(robotsMeta),
        canonical,
        hasFavicon,
        stylesheets,
        h1: h1Texts,
        h2Count,
        openGraph: {
            title: metaByProp('og:title') || null,
            description: metaByProp('og:description') || null,
            image: metaByProp('og:image') || null
        },
        images: {
            total: imgTags.length,
            missingAltAttribute: imagesNoAltAttr.length,
            emptyAlt: imagesMissingAlt.length - imagesNoAltAttr.length,
            examplesMissingAlt: imagesNoAltAttr.slice(0, 5).map(i => i.src || '(inline image)')
        },
        scripts: { total: scriptTags.length, external: externalScripts },
        structuredData: jsonLd,
        links: anchors,
        hasPhoneLink,
        hasEmailLink,
        formCount,
        mixedContent,
        tracking: { gaIds, gtmIds, hasLegacyUA, hasMetaPixel },
        wordCount,
        generator,
        cms
    };
}

/** Parses robots.txt into the few facts we care about. */
function analyzeRobots(text) {
    const lines = String(text || '').split(/\r?\n/).slice(0, 5000).map(l => l.slice(0, 2000).replace(/#.*/, '').trim()).filter(Boolean);
    const sitemaps = [];
    let agent = null;
    const groups = {};
    for (const line of lines) {
        const [rawKey, ...rest] = line.split(':');
        const key = rawKey.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (key === 'sitemap') { if (value) sitemaps.push(value); continue; }
        if (key === 'user-agent') { agent = value.toLowerCase(); groups[agent] = groups[agent] || []; continue; }
        if (!agent) continue;
        if (key === 'disallow' || key === 'allow') groups[agent].push({ type: key, path: value });
    }
    const star = groups['*'] || [];
    const blocksEverything = star.some(rule => rule.type === 'disallow' && rule.path === '/')
        && !star.some(rule => rule.type === 'allow' && rule.path && rule.path !== '/');
    return { sitemaps, blocksEverything, hasRules: lines.length > 0 };
}

/** Pulls <loc> URLs (and optional lastmod) out of a sitemap or sitemap index, in one pass. */
function analyzeSitemap(xml) {
    const text = String(xml || '');
    const lower = lowerAscii(text);
    const isIndex = lower.includes('<sitemapindex');
    const entries = [];
    let pos = 0;
    const nextOpen = (name, from) => {
        let at = lower.indexOf(`<${name}`, from);
        while (at !== -1) {
            const c = lower.charCodeAt(at + name.length + 1);
            if (c === 62 || c === 32 || c === 9 || c === 10 || c === 13 || c === 47) return at; // ">" whitespace "/"
            at = lower.indexOf(`<${name}`, at + 1);
        }
        return -1;
    };
    const field = (body, bodyLower, name) => {
        const open = bodyLower.indexOf(`<${name}>`);
        if (open === -1) return null;
        const close = bodyLower.indexOf(`</${name}>`, open);
        if (close === -1) return null;
        return body.slice(open + name.length + 2, close).trim();
    };
    // Remember where the next <url> / <sitemap> is, so a document that has none of one kind is
    // not searched to the end again for every entry.
    const cache = { url: undefined, sitemap: undefined };
    const upcoming = name => {
        if (cache[name] === -1) return -1;
        if (cache[name] === undefined || cache[name] < pos) cache[name] = nextOpen(name, pos);
        return cache[name];
    };
    while (entries.length < 5000) {
        const urlAt = upcoming('url');
        const mapAt = upcoming('sitemap');
        if (urlAt === -1 && mapAt === -1) break;
        const useUrl = mapAt === -1 || (urlAt !== -1 && urlAt < mapAt);
        const name = useUrl ? 'url' : 'sitemap';
        const at = useUrl ? urlAt : mapAt;
        const openEnd = lower.indexOf('>', at);
        if (openEnd === -1) break;
        const close = lower.indexOf(`</${name}>`, openEnd);
        if (close === -1) break;
        const body = text.slice(openEnd + 1, close);
        const bodyLower = lower.slice(openEnd + 1, close);
        const loc = decodeEntities(field(body, bodyLower, 'loc') || '').trim();
        if (loc) entries.push({ loc, lastmod: field(body, bodyLower, 'lastmod') || null });
        pos = close + name.length + 3;
    }
    return { isIndex, entries, urlCount: entries.length };
}

module.exports = { decodeEntities, parseAttrs, normalizeHost, analyzeHtml, analyzeRobots, analyzeSitemap, collapse, stripTags };
