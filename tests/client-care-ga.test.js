const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const https = require('https');
const { EventEmitter } = require('events');

// A throwaway service-account key, so the real JWT-signing code path runs end to end.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'reader@test-project.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' });

const analytics = require('../src/services/checks/analyticsChecks');
const { googleAnalyticsTrafficCheck, diagnoseGaConnection, discoverProperties, getServiceAccountEmail, _internals } = analytics;

// -----------------------------------------------------------------------------
// A tiny fake of Google's APIs, installed in place of https.request
// -----------------------------------------------------------------------------
const originalRequest = https.request;
let scenario;
let calls;

function reply(res, status, body) {
    res.statusCode = status;
    res.emit('data', JSON.stringify(body));
    res.emit('end');
}

function fakeGoogle(url, options, callback) {
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => setImmediate(() => {
        const res = new EventEmitter();
        const u = String(url);
        calls.push(u.replace(/^https:\/\/[^/]+/, ''));
        callback(res);
        if (u.includes('oauth2.googleapis.com/token')) return reply(res, 200, { access_token: 'test-token', expires_in: 3600 });

        if (u.includes('analyticsadmin.googleapis.com')) {
            if (scenario.adminDisabled) {
                return reply(res, 403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Google Analytics Admin API has not been used in project 123 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'analyticsadmin.googleapis.com', activationUrl: 'https://console.developers.google.com/apis/api/analyticsadmin.googleapis.com/overview?project=123' } }] } });
            }
            if (u.includes('/accountSummaries')) {
                return reply(res, 200, { accountSummaries: [{ displayName: 'Accounts', propertySummaries: scenario.properties.map(p => ({ property: `properties/${p.id}`, displayName: p.name })) }] });
            }
            const m = u.match(/properties\/(\d+)\/dataStreams/);
            const property = scenario.properties.find(p => p.id === m?.[1]);
            return reply(res, 200, { dataStreams: (property?.streams || []).map(s => ({ name: `properties/${property.id}/dataStreams/${s.streamId}`, type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: `https://${s.host}`, measurementId: s.measurementId } })) });
        }

        if (u.includes('analyticsdata.googleapis.com')) {
            const id = u.match(/properties\/(\d+):/)?.[1];
            if (!scenario.readable.includes(id)) {
                return reply(res, 403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'User does not have sufficient permissions for this property. To learn more about Property ID, see https://developers.google.com/analytics/devguides/reporting/data/v1/property-id.' } });
            }
            if (u.includes(':batchRunReports')) {
                const dim = value => ({ dimensionValues: [{ value }] });
                return reply(res, 200, { reports: [
                    { rows: [{ ...dim('date_range_0'), metricValues: ['12', '7', '15', '40', '0.6', '75'].map(value => ({ value })) }, { ...dim('date_range_1'), metricValues: ['10', '5', '12', '30', '0.5', '60'].map(value => ({ value })) }] },
                    { rows: [{ dimensionValues: [{ value: 'Home' }, { value: '/' }], metricValues: [{ value: '25' }, { value: '10' }] }] },
                    { rows: [{ dimensionValues: [{ value: 'Direct' }], metricValues: [{ value: '9' }] }, { dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '6' }] }] },
                    { rows: [{ dimensionValues: [{ value: 'mobile' }], metricValues: [{ value: '11' }] }] },
                    { rows: [{ dimensionValues: [{ value: 'Jamaica' }], metricValues: [{ value: '12' }] }] }
                ] });
            }
            return reply(res, 200, { rows: [{ dimensionValues: [{ value: '20261001' }], metricValues: [{ value: '5' }, { value: '4' }] }, { dimensionValues: [{ value: '20261002' }], metricValues: [{ value: '10' }, { value: '8' }] }] });
        }
        return reply(res, 404, { error: { message: 'unexpected url in test' } });
    });
    return req;
}

test.before(() => { https.request = fakeGoogle; });
test.after(() => { https.request = originalRequest; });
test.beforeEach(() => { calls = []; _internals.resetDiscoveryCache(); });

const SKY = { id: '411111111', name: 'Sky Beach', streams: [{ streamId: '15838977471', host: 'skybeachja.com', measurementId: 'G-6SQ86DFT9N' }] };
const OTHER = { id: '422222222', name: 'Someone Else', streams: [{ streamId: '99999999999', host: 'other-business.com', measurementId: 'G-OTHER00001' }] };

const ctxFor = (extra = {}) => ({
    websiteUrl: 'https://www.skybeachja.com/', domain: 'skybeachja.com',
    getMeasurementIds: async () => ['G-6SQ86DFT9N'],
    onHealed: async (id, info) => { extra.healed = { id, info }; },
    ...extra
});

// -----------------------------------------------------------------------------
test('reads the service account email without exposing the key', () => {
    assert.equal(getServiceAccountEmail(), 'reader@test-project.iam.gserviceaccount.com');
});

test('a correct, shared property returns rich, plain data', async () => {
    scenario = { adminDisabled: true, properties: [], readable: ['411111111'] };
    const result = await googleAnalyticsTrafficCheck('411111111', ctxFor());
    assert.equal(result.status, 'pass');
    const a = result.evidence.analytics;
    assert.equal(a.current.users, 12);
    assert.equal(a.previous.sessions, 12);
    assert.equal(a.current.pageViews, 40);
    assert.equal(a.topPages[0].path, '/');
    assert.deepEqual(a.channels.map(c => c.name), ['Direct', 'Organic Search']);
    assert.equal(a.daily.length, 2);
    assert.equal(a.daily[0].date, '2026-10-01');
    // legacy keys stay so older consumers (and the monthly review of old runs) keep working
    assert.equal(result.evidence.currentPeriod.activeUsers, 12);
});

test('the Stream-ID mix-up is repaired automatically once Google\'s Admin API is on', async () => {
    scenario = { adminDisabled: false, properties: [SKY, OTHER], readable: ['411111111', '422222222'] };
    const holder = {};
    const result = await googleAnalyticsTrafficCheck('15838977471', ctxFor(holder));
    assert.equal(result.status, 'pass', 'the stored 11-digit Stream ID is replaced by the real Property ID');
    assert.equal(result.evidence.propertyId, '411111111');
    assert.deepEqual(result.evidence.autoCorrected, { from: '15838977471', to: '411111111', reason: 'stream-id' });
    assert.deepEqual(holder.healed.id, '411111111');
    assert.equal(holder.healed.info.from, '15838977471');
});

test('a missing property is found from the website\'s own counting code', async () => {
    scenario = { adminDisabled: false, properties: [SKY, OTHER], readable: ['411111111', '422222222'] };
    const holder = {};
    const result = await googleAnalyticsTrafficCheck('', ctxFor(holder));
    assert.equal(result.status, 'pass');
    assert.equal(result.evidence.autoCorrected.reason, 'measurement-id');
    assert.equal(result.evidence.autoCorrected.from, null);
    assert.equal(holder.healed.id, '411111111');
});

test('without the Admin API the failure is classified, kept off the client\'s score, and explained to the team', async () => {
    scenario = { adminDisabled: true, properties: [], readable: [] };
    const result = await googleAnalyticsTrafficCheck('15838977471', ctxFor());
    assert.equal(result.status, 'skip');
    assert.equal(result.evidence.configIssue, true);
    const d = result.evidence.diagnosis;
    assert.equal(d.code, 'NO_ACCESS');
    assert.equal(d.looksLikeStreamId, true);
    assert.equal(d.adminApiDisabled, true);
    assert.match(d.activationUrl, /analyticsadmin\.googleapis\.com/);
    assert.match(d.plain, /Stream ID/);
    assert.equal(d.serviceAccountEmail, 'reader@test-project.iam.gserviceaccount.com');
    assert.ok(d.steps.some(s => /Admin API/.test(s)));
    assert.doesNotMatch(result.details, /sufficient permissions/, 'the stored summary never carries Google\'s raw error text');
});

test('an ambiguous match is never guessed', async () => {
    const twin = { ...SKY, id: '433333333', name: 'Sky Beach (copy)' };
    scenario = { adminDisabled: false, properties: [SKY, twin], readable: ['411111111', '433333333'] };
    const result = await googleAnalyticsTrafficCheck('', { ...ctxFor(), getMeasurementIds: async () => [] });
    assert.equal(result.status, 'skip');
    assert.equal(result.evidence.diagnosis.code, 'NOT_CONFIGURED');
    assert.equal(result.evidence.diagnosis.candidates.length, 2);
    assert.equal(result.evidence.diagnosis.suggestedPropertyId, null);
});

test('another business\'s analytics is never shown, even if our account can read it', async () => {
    scenario = { adminDisabled: false, properties: [SKY, OTHER], readable: ['411111111', '422222222'] };
    // Someone saved the other business's real Property ID on this client by mistake.
    const result = await googleAnalyticsTrafficCheck('422222222', ctxFor());
    assert.equal(result.status, 'skip');
    assert.equal(result.evidence.diagnosis.code, 'OWNERSHIP_MISMATCH');
    assert.doesNotMatch(JSON.stringify(result), /"users":12/, 'no traffic figures leak into the result');
});

test('the admin "Test Google Analytics" button explains what is wrong and offers the fix', async () => {
    scenario = { adminDisabled: false, properties: [SKY], readable: ['411111111'] };
    const bad = await diagnoseGaConnection({ propertyId: '15838977471', websiteUrl: 'https://www.skybeachja.com/', measurementIds: ['G-6SQ86DFT9N'] });
    assert.equal(bad.ok, false);
    assert.equal(bad.diagnosis.code, 'NO_ACCESS');
    assert.equal(bad.match.matched, true);
    assert.equal(bad.match.propertyId, '411111111');
    assert.equal(bad.discovery.available, true);

    const good = await diagnoseGaConnection({ propertyId: '411111111', websiteUrl: 'https://www.skybeachja.com/', measurementIds: ['G-6SQ86DFT9N'] });
    assert.equal(good.ok, true);
    assert.deepEqual(good.sample, { visitors: 12, visits: 15, pageViews: 40 });
    assert.equal(good.ownership, 'verified');

    const none = await diagnoseGaConnection({ propertyId: '', websiteUrl: 'https://nobody.example/', measurementIds: [] });
    assert.equal(none.ok, false);
    assert.equal(none.diagnosis.code, 'NOT_CONFIGURED');
});

test('with the Admin API off, the test says exactly how to switch it on', async () => {
    scenario = { adminDisabled: true, properties: [], readable: [] };
    const result = await diagnoseGaConnection({ propertyId: '15838977471', websiteUrl: 'https://www.skybeachja.com/' });
    assert.equal(result.discovery.available, false);
    assert.equal(result.discovery.reason, 'ADMIN_API_DISABLED');
    assert.match(result.discovery.activationUrl, /console\.developers\.google\.com/);
});

test('property discovery is cached so reports do not hammer Google', async () => {
    scenario = { adminDisabled: false, properties: [SKY, OTHER], readable: [] };
    await discoverProperties();
    const first = calls.length;
    await discoverProperties();
    assert.equal(calls.length, first, 'a second lookup within the cache window makes no new requests');
    await discoverProperties({ force: true });
    assert.ok(calls.length > first, 'force bypasses the cache');
});
