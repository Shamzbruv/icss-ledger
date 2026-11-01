/* Admin pages have flat URLs, so the worker has root scope. Only the explicit
   admin navigation list below is handled. API calls, authentication, payments,
   documents, public pages and customer signing links always go to the network. */
const CACHE_NAME = 'icss-command-center-offline-v1';
const OFFLINE_URL = '/command-center-offline.html';
const ADMIN_PATHS = new Set([
    '/login', '/dashboard', '/invoices', '/contracts', '/partner-contracts',
    '/halomanage-partnerships', '/referral-contracts', '/leads', '/reviews-admin',
    '/link-hub-admin', '/website-manager', '/client-care', '/client-care-pulse', '/accounting'
]);
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
        .filter(key => key.startsWith('icss-command-center-offline-') && key !== CACHE_NAME)
        .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\.html$/, '').replace(/\/$/, '');
    if (request.method !== 'GET' || request.mode !== 'navigate' ||
        url.origin !== self.location.origin || !ADMIN_PATHS.has(path)) return;
    // Never cache admin HTML or records: an offline launch shows a generic screen.
    event.respondWith(fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(OFFLINE_URL) || new Response('You are offline. Connect to use ICSS Command Center.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }));
});
