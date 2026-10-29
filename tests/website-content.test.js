const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createWebsiteContentService, validateContent, publicContent, safeUrl } = require('../src/services/websiteContentService');
const defaults = require('../src/data/website-defaults.json');
const clone = x => JSON.parse(JSON.stringify(x));
function memoryDb(initial) {
    const state = { row: initial ? clone(initial) : null, leads: [], fail: false, reads: 0 };
    return { state, from(table) {
        let action='read',value,filters=[];
        const q = { select(){return q;}, eq(k,v){filters.push([k,v]);return q;}, order(){return q;},limit(){return q;},abortSignal(){return q;},
            maybeSingle(){return q;},single(){return q;},insert(v){action='insert';value=v;return q;},update(v){action='update';value=v;return q;},
            then(resolve,reject) { return Promise.resolve().then(()=>{
                if(state.fail)return {data:null,error:{message:'offline'}};
                if(table==='link_hub_settings') {
                    if(action==='read'){state.reads++;return {data:clone(state.row),error:null};}
                    if(action==='insert'&&state.row)return {data:null,error:{message:'duplicate'}};
                    if(action==='update'&&filters.some(([k,v])=>state.row?.[k]!==v))return {data:null,error:null};
                    state.row={id:1,...clone(value)};return {data:{updated_at:state.row.updated_at},error:null};
                }
                if(table==='leads') {
                    if(action==='insert'){state.leads.push({id:'application-1',...value});return {data:null,error:null};}
                    const rows=state.leads.filter(r=>filters.every(([k,v])=>r[k]===v));
                    if(action==='update'){rows.forEach(r=>Object.assign(r,value));return {data:rows.length?{id:rows[0].id}:null,error:null};}
                    return {data:rows,error:null};
                }
                throw Error(`Unexpected table ${table}`);
            }).then(resolve,reject); }
        }; return q;
    }};
}
const row = () => ({id:1,updated_at:'2026-10-01T00:00:00.000Z',content:{profile:{name:'QR profile'},links:[{id:'one'}],offer:{enabled:false},website:clone(defaults)}});
test('all seeded portfolio records validate and recent projects are present',()=>{
    const d=validateContent(clone(defaults));
    for(const id of ['skybeach','myhalomanage','icss-bookings','grace-connect','grace-connect-website'])assert.ok(d.projects.some(p=>p.id===id));
    assert.match(d.projects.find(p=>p.id==='grace-connect').appUrl,/id=love.graceconnect/);
    assert.equal(d.jobs.length,0);
});
test('unsafe URLs, duplicate IDs, invalid categories and malformed dates are rejected',()=>{
    assert.throws(()=>safeUrl('javascript:alert(1)'));
    assert.throws(()=>safeUrl('//attacker.example'));
    assert.throws(()=>safeUrl('data:text/html,x'));
    let d=clone(defaults);d.projects[0].image='javascript:alert(1)';assert.throws(()=>validateContent(d));
    d=clone(defaults);d.projects[1].id=d.projects[0].id;assert.throws(()=>validateContent(d));
    d=clone(defaults);d.projects[0].category='';assert.throws(()=>validateContent(d));
    d=clone(defaults);d.jobs=[{id:'developer',title:'Developer',location:'Remote',type:'Contract',description:'Build',published:true,closesOn:'2026-02-30'}];assert.throws(()=>validateContent(d));
});
test('published API excludes drafts and closed vacancies',()=>{
    const d=clone(defaults);d.projects[0].published=false;
    d.jobs=[{id:'old',published:true,closesOn:'2020-01-01'},{id:'draft',published:false},{id:'open',published:true,closesOn:'2099-12-31'}];
    const result=publicContent(d);assert.ok(!result.projects.some(p=>p.id===d.projects[0].id));assert.deepEqual(result.jobs.map(j=>j.id),['open']);
});
test('website publication preserves QR Link Hub and rejects stale editor revisions',async()=>{
    const db=memoryDb(row()),service=createWebsiteContentService(db),d=clone(defaults);d.projects[0].title='Updated';
    const rev=await service.writeSection('website',d,'2026-10-01T00:00:00.000Z');
    assert.equal(db.state.row.content.profile.name,'QR profile');assert.equal(db.state.row.content.links[0].id,'one');
    assert.equal(db.state.row.content.website.projects[0].title,'Updated');
    await assert.rejects(service.writeSection('website',d,'2026-10-01T00:00:00.000Z'),/another window/);
    assert.ok(rev);
});
test('Link Hub saves preserve the website and public reads share a bounded cache',async()=>{
    const db=memoryDb(row()),service=createWebsiteContentService(db);
    await service.writeSection('linkHub',{profile:{name:'New QR'},links:[],offer:{enabled:true}});
    assert.equal(db.state.row.content.website.projects[0].title,'Skybeach');
    await Promise.all([service.read(),service.read(),service.read()]);const reads=db.state.reads;
    const result=await service.read();result.content.projects=[];
    assert.equal(db.state.reads,reads);assert.ok((await service.read()).content.projects.length>0);
});
test('outage fallback is public only; failed storage never returns a successful save',async()=>{
    const db=memoryDb(row());db.state.fail=true;const service=createWebsiteContentService(db);
    assert.equal((await service.read()).storageAvailable,false);
    await assert.rejects(service.read({strict:true}));
    await assert.rejects(service.writeSection('website',defaults,null));
});
test('first website save can initialise the existing settings row',async()=>{
    const db=memoryDb(null),service=createWebsiteContentService(db);
    await service.writeSection('website',defaults,null);
    assert.equal(db.state.row.id,1);assert.ok(db.state.row.content.website.projects.length);
});
test('career and referral submissions are durable, scoped and never falsely acknowledged',async t=>{
    const db=memoryDb(row()),service=createWebsiteContentService(db);
    const app=express();app.use(express.json());
    app.use('/api/website',(req,res,next)=>{
        const isPublic=req.method==='GET'&&req.path==='/public'||req.method==='POST'&&req.path==='/applications';
        if(!isPublic&&req.headers.authorization!=='Bearer test-admin')return res.status(401).json({error:'Unauthorized'});next();
    },require('../src/routes/website')(db,service));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
    const base=`http://127.0.0.1:${server.address().port}/api/website`;
    const send=(path,body,method='POST',admin=false)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(admin?{Authorization:'Bearer test-admin'}:{})},body:JSON.stringify(body)});
    assert.equal((await fetch(base+'/admin')).status,401);
    assert.equal((await send('/admin',{content:defaults},'PUT')).status,401);
    const payload={type:'referral',name:'Test Applicant',email:'test@example.invalid',message:'Interested in the program.',consent:true};
    assert.equal((await send('/applications',{...payload,consent:false})).status,400);
    assert.equal((await send('/applications',{...payload,type:'career',jobId:'closed'})).status,400);
    assert.equal((await send('/applications',payload)).status,201);
    assert.equal(db.state.leads.length,1);assert.equal(db.state.leads[0].source,'Work with ICSS');assert.equal(db.state.leads[0].lead_type,'Referral Program');
    assert.equal((await send('/applications/application-1',{status:'Approved',notes:'Terms to discuss.'},'PATCH',true)).status,200);
    assert.equal(db.state.leads[0].status,'Approved');
    db.state.fail=true;
    assert.equal((await send('/applications',payload)).status,503);
    assert.equal((await send('/admin',{content:defaults,revision:db.state.row.updated_at},'PUT',true)).status,503);
});

test('homepage previews exactly the three newest published additions, independent of featured flags and display order', () => {
    const d = clone(defaults);
    const sample = d.projects[0];
    d.projects = [
        {...sample, id:'legacy', sortOrder:-100, featured:true},
        {...sample, id:'older', createdAt:'2026-10-01T00:00:00Z', sortOrder:0, featured:true},
        {...sample, id:'newest', createdAt:'2026-10-29T00:00:00Z', sortOrder:100, featured:false},
        {...sample, id:'middle', createdAt:'2026-10-20T00:00:00Z', sortOrder:20, featured:false},
        {...sample, id:'draft', createdAt:'2026-10-30T00:00:00Z', published:false}
    ];
    const result = publicContent(d);
    assert.deepEqual(result.recentProjects.map(p=>p.id), ['newest','middle','older']);
    assert.equal(result.projects.length,4,'the full portfolio keeps every published project');
    assert.equal(publicContent({...d,projects:[]}).recentProjects.length,0);
    assert.equal(publicContent({...d,projects:d.projects.slice(0,1)}).recentProjects.length,1);
});
test('adding projects records server dates while edits preserve recency and legacy projects keep their order', async () => {
    const db=memoryDb(row()), service=createWebsiteContentService(db), d=clone(defaults);
    assert.deepEqual(publicContent(d).recentProjects.map(p=>p.id),d.projects.filter(p=>p.published).slice(0,3).map(p=>p.id));
    d.projects.push({...d.projects[0],id:'new-addition',featured:false,sortOrder:999,createdAt:'2099-01-01T00:00:00Z'});
    let rev=await service.writeSection('website',validateContent(d),'2026-10-01T00:00:00.000Z');
    const saved=clone(db.state.row.content.website);
    const added=saved.projects.find(p=>p.id==='new-addition').createdAt;
    assert.ok(Date.parse(added)<=Date.now(),'the server assigns the addition date');
    assert.equal(publicContent(saved).recentProjects[0].id,'new-addition');
    saved.projects[0].title='Edited legacy project';saved.projects[0].sortOrder=-999;
    saved.projects.find(p=>p.id==='new-addition').title='Edited new project';
    await service.writeSection('website',validateContent(saved),rev);
    const edited=db.state.row.content.website;
    assert.equal(edited.projects[0].createdAt,null);
    assert.equal(edited.projects.find(p=>p.id==='new-addition').createdAt,added);
    assert.equal(publicContent(edited).recentProjects[0].id,'new-addition');
});
