const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'command-center.webmanifest'), 'utf8'));
function worker(network = async () => ({ online: true })) {
    const handlers = {}, calls = [];
    const offline = { offline: true };
    const context = {
        self: { location: { origin: 'https://icss.example' }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
        caches: { open: async name => ({ add: async url => calls.push(['add', url]), match: async url => { calls.push(['match', url]); return offline; } }), keys: async () => [] },
        fetch: network, URL, Response
    };
    vm.runInNewContext(fs.readFileSync(path.join(root,'command-center-sw.js'),'utf8'), context);
    const request = (pathname, options = {}) => {
        let response;
        handlers.fetch({ request: { url: 'https://icss.example'+pathname, mode:'navigate', method:'GET', ...options }, respondWith: p => { response = p; } });
        return response;
    };
    return { handlers, request, calls, offline };
}
test('app manifest launches the authenticated dashboard and has real install icons', () => {
    assert.equal(manifest.start_url, '/dashboard'); assert.equal(manifest.display,'standalone');
    assert.ok(manifest.shortcuts.some(s=>s.url==='/invoices'));
    for(const size of [192,512]) {
        const icon = manifest.icons.find(i=>i.sizes===`${size}x${size}`&&i.purpose==='any'); assert.ok(icon);
        const png = fs.readFileSync(path.join(root,icon.src));
        assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20),size);
    }
    assert.ok(manifest.icons.some(i=>i.purpose==='maskable'));
    for(const name of fs.readdirSync(root).filter(name=>name.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(root,name),'utf8');
        if(html.includes('layout.js')||name==='login.html') assert.ok(html.includes('rel="manifest"'),name);
        else assert.ok(!html.includes('rel="manifest"'),`${name} stays outside the app setup`);
    }
});
test('service worker never intercepts APIs, sign-in requests, signing links, or public pages', () => {
    const sw=worker();
    for(const url of ['/api/invoices','/api/website/admin','/auth/login','/auth/config','/sign-contract?token=example','/sign-partner-contract/example','/','/portfolio']) assert.equal(sw.request(url),undefined,url);
    assert.equal(sw.request('/invoices',{method:'POST'}),undefined);
    assert.equal(sw.request('/invoices',{mode:'cors'}),undefined);
    assert.equal(sw.request('/dashboard',{url:'https://other.example/dashboard'}),undefined);
    assert.deepEqual(sw.calls,[]);
});
test('admin navigation uses the network online and only a generic fallback offline', async () => {
    const online=worker(); assert.deepEqual(await online.request('/invoices'),{online:true}); assert.deepEqual(online.calls,[]);
    const sw=worker(async()=>{throw new Error('offline');});
    for(const url of ['/login','/dashboard','/invoices.html','/website-manager?section=careers','/accounting/']) assert.equal(await sw.request(url),sw.offline);
    assert.ok(sw.calls.every(c=>c[0]==='match'&&c[1]==='/command-center-offline.html'));
    let install;sw.handlers.install({waitUntil:p=>{install=p;}});await install;
    assert.equal(sw.calls.filter(c=>c[0]==='add').length,1);
    assert.deepEqual(sw.calls.find(c=>c[0]==='add'),['add','/command-center-offline.html']);
});
function installControls({ installed=false }={}) {
    const windowEvents={},documentEvents={},registrations=[];
    const button={hidden:false,disabled:false};
    const context={
        window:{isSecureContext:true,matchMedia:()=>({matches:installed,addEventListener(){}}),addEventListener:(name,fn)=>{windowEvents[name]=fn;}},
        navigator:{serviceWorker:{register:async(...args)=>{registrations.push(args);}}},
        document:{readyState:'complete',documentElement:{classList:{toggle(){}}},querySelectorAll:()=>[button],addEventListener:(name,fn)=>{documentEvents[name]=fn;}},
        console:{warn(){}}
    };
    vm.runInNewContext(fs.readFileSync(path.join(root,'js/pwa.js'),'utf8'),context);
    return {windowEvents,documentEvents,registrations,button};
}
test('install flow waits for a click and hides controls after installation',async()=>{
    const page=installControls();let prompted=0,prevented=false;
    page.windowEvents.beforeinstallprompt({preventDefault(){prevented=true;},prompt:async()=>{prompted++;},userChoice:Promise.resolve({outcome:'accepted'})});
    assert.equal(prevented,true);assert.equal(prompted,0);
    await page.documentEvents.click({target:{closest:()=>page.button}});
    assert.equal(prompted,1);assert.equal(page.button.disabled,false);
    page.windowEvents.appinstalled();page.documentEvents['icss:layout-ready']();
    assert.equal(page.button.hidden,true);
    assert.equal(page.registrations[0][0],'/command-center-sw.js');
    assert.equal(page.registrations[0][1].updateViaCache,'none');
});
test('installed standalone windows do not offer installation again',()=>{
    const page=installControls({installed:true});assert.equal(page.button.hidden,true);
});
