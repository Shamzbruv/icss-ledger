/**
 * Domain-level checks: when the web address expires, whether DNS is healthy, and whether the
 * domain's email is set up so messages are trusted. All read-only public lookups.
 */
const dns = require('dns').promises;
const { fetchPage } = require('./pageFetch');
const { normalizePublicDomain, resolvePublicHost } = require('./targetSafety');

// Common two-part public suffixes, so "shop.example.co.uk" is looked up as "example.co.uk".
const TWO_LEVEL_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
    'com.au', 'net.au', 'org.au', 'edu.au', 'co.nz', 'org.nz', 'net.nz',
    'com.jm', 'org.jm', 'net.jm', 'edu.jm', 'gov.jm',
    'co.za', 'org.za', 'com.br', 'com.mx', 'co.in', 'co.jp', 'com.sg', 'com.hk',
    'com.tt', 'co.tt', 'com.bb', 'com.bs', 'com.ky', 'com.ag', 'com.dm', 'com.gd', 'com.lc', 'com.vc', 'com.pr', 'com.do',
    'com.cn', 'com.tw', 'com.tr', 'co.ke', 'co.ug', 'co.tz', 'com.ng', 'com.gh', 'com.pk', 'com.my', 'com.ph', 'com.vn',
    'co.id', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo'
]);

function registrableDomain(host) {
    const labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.');
    if (labels.length <= 2) return labels.join('.');
    const lastTwo = labels.slice(-2).join('.');
    return TWO_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

async function safe(promise, fallback = []) {
    try { return await promise; } catch (_) { return fallback; }
}

function parseRdap(json) {
    const events = Array.isArray(json?.events) ? json.events : [];
    const when = action => events.find(e => String(e.eventAction).toLowerCase() === action)?.eventDate || null;
    const registrarEntity = (json?.entities || []).find(e => (e.roles || []).includes('registrar'));
    const fn = registrarEntity?.vcardArray?.[1]?.find(item => item[0] === 'fn');
    return {
        expiresAt: when('expiration'),
        registeredAt: when('registration'),
        registrar: fn ? fn[3] : null,
        statuses: Array.isArray(json?.status) ? json.status : []
    };
}

async function domainExpiryCheck(domainOrUrl) {
    let host;
    try { host = normalizePublicDomain(domainOrUrl); } catch (error) { return { status: 'skip', details: `Not checked: ${error.message}`, evidence: { reason: 'bad-target' } }; }
    const domain = registrableDomain(host);

    const r = await fetchPage(`https://rdap.org/domain/${domain}`, { timeoutMs: 10000, headers: { Accept: 'application/rdap+json, application/json' }, maxBytes: 600_000 });
    if (!r.ok) return { status: 'info', details: `Domain expiry lookup unavailable (${r.error})`, evidence: { domain, supported: false, reason: 'lookup-failed' } };
    if (r.status === 404 || r.status === 400) {
        return { status: 'info', details: 'Expiry dates are not published for this type of domain', evidence: { domain, supported: false, reason: 'unsupported-tld' } };
    }
    let parsed;
    try { parsed = parseRdap(JSON.parse(r.html)); } catch (_) {
        return { status: 'info', details: 'Domain expiry lookup returned an unreadable answer', evidence: { domain, supported: false, reason: 'unreadable' } };
    }
    if (!parsed.expiresAt) return { status: 'info', details: 'No expiry date was published for this domain', evidence: { domain, supported: false, reason: 'no-expiry', registrar: parsed.registrar } };

    const expires = new Date(parsed.expiresAt);
    const daysRemaining = Math.ceil((expires - Date.now()) / 86400000);
    const evidence = { domain, supported: true, expiresAt: expires.toISOString(), daysRemaining, registrar: parsed.registrar, statuses: parsed.statuses };
    const grace = parsed.statuses.some(s => /redemption|pending delete|grace/i.test(s));
    if (daysRemaining < 0 || grace) return { status: 'fail', details: `Domain ${daysRemaining < 0 ? 'expired' : 'is in a grace/redemption period'} (${expires.toISOString().slice(0, 10)})`, evidence };
    if (daysRemaining < 15) return { status: 'fail', details: `Domain expires in ${daysRemaining} days`, evidence };
    if (daysRemaining < 45) return { status: 'warn', details: `Domain expires in ${daysRemaining} days`, evidence };
    return { status: 'pass', details: `Domain is registered until ${expires.toISOString().slice(0, 10)} (${daysRemaining} days)`, evidence };
}

async function dnsHealthCheck(domainOrUrl) {
    const startedAt = Date.now();
    let host;
    try { host = normalizePublicDomain(domainOrUrl); } catch (error) {
        return { status: 'fail', details: `Domain rejected: ${error.message}`, evidence: { error: error.message } };
    }
    try {
        const record = await resolvePublicHost(host);
        const apexLike = host.replace(/^www\./, '');
        const alternate = host.startsWith('www.') ? apexLike : `www.${host}`;
        const [ips4, nameservers, alternateIps] = await Promise.all([
            safe(dns.resolve4(host)),
            safe(dns.resolveNs(registrableDomain(host))),
            safe(dns.resolve4(alternate))
        ]);
        const alternateCname = alternateIps.length ? [] : await safe(dns.resolveCname(alternate));
        const alternateResolves = alternateIps.length > 0 || alternateCname.length > 0;
        return {
            status: 'pass',
            details: 'DNS resolves to a public address',
            evidence: {
                host, ip: record.address, ips: ips4.length ? ips4 : [record.address],
                nameservers: nameservers.slice(0, 6), alternateHost: alternate, alternateResolves,
                durationMs: Date.now() - startedAt
            }
        };
    } catch (error) {
        return { status: 'fail', details: `DNS resolution failed: ${error.message}`, evidence: { host, error: error.message, durationMs: Date.now() - startedAt } };
    }
}

async function emailDnsCheck(domainOrUrl) {
    let host;
    try { host = normalizePublicDomain(domainOrUrl); } catch (error) { return { status: 'skip', details: `Not checked: ${error.message}`, evidence: { reason: 'bad-target' } }; }
    const domain = registrableDomain(host);
    const [mx, txt, dmarcTxt] = await Promise.all([
        safe(dns.resolveMx(domain)),
        safe(dns.resolveTxt(domain)),
        safe(dns.resolveTxt(`_dmarc.${domain}`))
    ]);
    const flat = records => records.map(parts => parts.join(''));
    const spf = flat(txt).find(r => /^v=spf1\b/i.test(r)) || null;
    const dmarc = flat(dmarcTxt).find(r => /^v=DMARC1\b/i.test(r)) || null;
    const hasMail = mx.length > 0;
    const evidence = {
        domain, hasMail,
        mxHosts: mx.sort((a, b) => a.priority - b.priority).slice(0, 4).map(m => m.exchange),
        hasSpf: !!spf, hasDmarc: !!dmarc,
        dmarcPolicy: dmarc ? (dmarc.match(/\bp=([a-z]+)/i)?.[1] || null) : null
    };
    if (!hasMail) return { status: 'info', details: 'No email service is set up on this domain', evidence };
    if (!spf) return { status: 'warn', details: 'Email is set up but has no SPF record, so messages may be treated as spam', evidence };
    if (!dmarc) return { status: 'info', details: 'SPF is in place; a DMARC record would add extra protection', evidence };
    return { status: 'pass', details: 'Email sender protection (SPF and DMARC) is in place', evidence };
}

module.exports = { domainExpiryCheck, dnsHealthCheck, emailDnsCheck, registrableDomain, parseRdap };
