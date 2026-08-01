const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const blockedAddresses = new net.BlockList();
[
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([network, prefix]) => blockedAddresses.addSubnet(network, prefix, 'ipv4'));
[
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
    ['ff00::', 8], ['2001:db8::', 32]
].forEach(([network, prefix]) => blockedAddresses.addSubnet(network, prefix, 'ipv6'));

function isBlockedAddress(address) {
    const normalized = String(address || '').toLowerCase();
    const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedV4) return blockedAddresses.check(mappedV4, 'ipv4');
    const version = net.isIP(normalized);
    if (!version) return true;
    return blockedAddresses.check(normalized, version === 4 ? 'ipv4' : 'ipv6');
}

function parsePublicHttpUrl(value) {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only public HTTP or HTTPS URLs are allowed');
    if (parsed.username || parsed.password) throw new Error('URLs containing credentials are not allowed');
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
        throw new Error('Local or internal hostnames are not allowed');
    }
    if (net.isIP(hostname) && isBlockedAddress(hostname)) throw new Error('Private or reserved IP addresses are not allowed');
    return parsed;
}

function normalizePublicDomain(value) {
    const raw = String(value || '').trim();
    const hostname = raw.includes('://') ? parsePublicHttpUrl(raw).hostname : raw.split('/')[0].split(':')[0];
    const normalized = hostname.toLowerCase().replace(/\.$/, '');
    if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local') || normalized.endsWith('.internal')) {
        throw new Error('A public domain name is required');
    }
    if (net.isIP(normalized)) {
        if (isBlockedAddress(normalized)) throw new Error('Private or reserved IP addresses are not allowed');
        return normalized;
    }
    if (normalized.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(normalized)) {
        throw new Error('A valid public domain name is required');
    }
    return normalized;
}

async function resolvePublicHost(hostname) {
    const directFamily = net.isIP(hostname);
    const records = directFamily
        ? [{ address: hostname, family: directFamily }]
        : await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) throw new Error('The hostname did not resolve');
    if (records.some(record => isBlockedAddress(record.address))) {
        throw new Error('The hostname resolves to a private or reserved network');
    }
    return records[0];
}

async function getPinnedRequest(value, { method = 'GET', headers = {} } = {}) {
    const url = parsePublicHttpUrl(value);
    const record = await resolvePublicHost(url.hostname);
    return {
        url,
        options: {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || undefined,
            path: `${url.pathname}${url.search}`,
            method,
            headers,
            servername: url.hostname,
            lookup: (_hostname, options, callback) => options?.all
                ? callback(null, [record])
                : callback(null, record.address, record.family)
        }
    };
}

module.exports = {
    getPinnedRequest,
    isBlockedAddress,
    normalizePublicDomain,
    parsePublicHttpUrl,
    resolvePublicHost
};
