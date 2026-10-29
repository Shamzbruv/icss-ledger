const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('public/js/auth.js', 'utf8');
function loginPage({ fetch, sdk, expireTimers = false }) {
    let submit;
    const elements = {
        loginForm: { addEventListener: (_, handler) => { submit = handler; } },
        loginError: { textContent: '', style: {} },
        submitBtn: { disabled: false, innerHTML: 'Sign In' },
        email: { value: 'qa@example.invalid' }, password: { value: 'test-password' }
    };
    const window = { CONFIG: { API_BASE_URL: '' }, location: { pathname: '/login', href: '/login' }, ensureSupabaseClient: sdk };
    const context = vm.createContext({ window, document: { getElementById: id => elements[id] }, fetch, AbortSignal,
        console: { log() {}, warn() {}, error() {} },
        setTimeout: expireTimers ? callback => setTimeout(callback, 5) : setTimeout, clearTimeout });
    vm.runInContext(source, context);
    return { window, elements, submit: () => submit({ preventDefault() {} }) };
}
test('provider failure returns the form to a usable state even when saved-session recovery is stuck', async () => {
    let calls = 0;
    const page = loginPage({
        fetch: async url => { assert.equal(url, '/auth/login'); calls++; return { status: 503, ok: false, json: async () => ({ error: 'Authentication service unavailable.' }) }; },
        sdk: () => new Promise(() => {}), expireTimers: true
    });
    await page.submit();
    assert.equal(page.elements.submitBtn.disabled, false);
    assert.equal(page.elements.submitBtn.innerHTML, 'Sign In');
    assert.equal(page.elements.loginError.textContent, 'Authentication service unavailable.');
    assert.equal(page.window.location.href, '/login');
    await page.submit(); assert.equal(calls, 2, 'the user can retry');
});
test('successful login persists the returned session before navigating', async () => {
    let saved;
    const sdk = { auth: {
        getSession: async () => ({ data: { session: null } }),
        setSession: async value => { saved = value; return { data: { session: { access_token: value.access_token } } }; }
    } };
    const page = loginPage({ sdk: async () => sdk, fetch: async () => ({ status: 200, ok: true,
        json: async () => ({ session: { access_token: 'test-access', refresh_token: 'test-refresh' } }) }) });
    await page.submit();
    assert.equal(saved.access_token, 'test-access'); assert.equal(saved.refresh_token, 'test-refresh');
    assert.equal(page.window.location.href, '/dashboard');
});
test('stalled session persistence times out, unlocks the form and does not redirect', async () => {
    const sdk = { auth: { getSession: async () => ({ data: { session: null } }), setSession: () => new Promise(() => {}) } };
    const page = loginPage({ sdk: async () => sdk, expireTimers: true, fetch: async () => ({ status: 200, ok: true,
        json: async () => ({ session: { access_token: 'test-access', refresh_token: 'test-refresh' } }) }) });
    await page.submit();
    assert.equal(page.elements.submitBtn.disabled, false);
    assert.match(page.elements.loginError.textContent, /did not respond/);
    assert.equal(page.window.location.href, '/login');
});
