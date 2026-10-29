const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let content, revision = null, dirty = false, applications = [];
const statuses=['New','Reviewing','Contacted','Approved','Declined','Closed'];
function status(message,type='') { $('manager-status').textContent=message;$('manager-status').className=type; }
function markDirty() {dirty=true;status('Draft changed. Publish changes to update the website.');}
async function json(url,options) { const r=await apiFetch(url,options);const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed.');return d; }
function switchPanel(panel) {
    if (!['portfolio','careers','story'].includes(panel)) panel='portfolio';
    document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===panel)));
    document.querySelectorAll('.manager-panel').forEach(p=>p.hidden=p.id!==`panel-${panel}`);
    history.replaceState(null,'',`?section=${panel}`);
    if(panel==='careers')loadApplications();
}
function renderProjects() {
    $('project-categories').innerHTML=[...new Set(content.projects.map(p=>p.category))].sort().map(c=>`<option value="${esc(c)}">`).join('');
    $('project-list').innerHTML=[...content.projects].sort((a,b)=>a.sortOrder-b.sortOrder).map(p=>`<article class="manager-project"><span class="badge ${p.published?'badge-success':'badge-secondary'}">${p.published?'Published':'Hidden'}${p.featured?' · Featured':''}</span><h3>${esc(p.title)}</h3><p>${esc(p.category)} · ${p.complexity==='advanced'?'Advanced backend':p.complexity==='mobile'?'Mobile application':'Simple website'}</p><p>${esc(p.summary)}</p><div class="manager-actions"><button class="btn btn-secondary" data-edit-project="${esc(p.id)}">Edit</button><button class="btn btn-secondary" data-toggle-project="${esc(p.id)}">${p.published?'Hide':'Publish'}</button><button class="btn btn-danger" data-remove-project="${esc(p.id)}">Remove</button></div></article>`).join('')||'<p>No projects yet. Add your first project.</p>';
}
function fill(form,record) { for(const [key,value] of Object.entries(record)){const f=form.elements.namedItem(key);if(!f)continue;if(f.type==='checkbox')f.checked=value===true;else f.value=Array.isArray(value)?value.join(', '):value??'';} }
function openProject(id) {
    const p=content.projects.find(p=>p.id===id),form=$('project-editor');form.reset();fill(form,p||{published:true,featured:false,sortOrder:content.projects.length+1,kind:'Client project'});
    form.elements.originalId.value=id||'';form.elements.id.readOnly=Boolean(p);form.querySelector('.editor-error').textContent='';$('project-form-title').textContent=p?'Edit project':'Add project';$('project-dialog').showModal();
}
function renderJobs() {
    $('job-admin-list').innerHTML=content.jobs.map(j=>`<article class="manager-project"><span class="badge">${j.published?'Published':'Draft'}</span><h3>${esc(j.title)}</h3><p>${esc(j.type)} · ${esc(j.location)}${j.closesOn?` · Closes ${esc(j.closesOn)}`:''}</p><div class="manager-actions"><button class="btn btn-secondary" data-edit-job="${esc(j.id)}">Edit</button><button class="btn btn-danger" data-remove-job="${esc(j.id)}">Remove</button></div></article>`).join('')||'<p class="text-muted">No advertised vacancies. Add a role when you are ready to hire.</p>';
}
function openJob(id) {const form=$('job-editor'),j=content.jobs.find(j=>j.id===id);form.reset();fill(form,j||{published:true});form.elements.originalId.value=id||'';form.elements.id.readOnly=Boolean(j);form.querySelector('.editor-error').textContent='';$('job-dialog').showModal();}
async function loadApplications() {
    $('applications-list').textContent='Loading applications…';
    try {applications=await json('/api/website/applications');renderApplications();}
    catch(error){$('applications-list').textContent=error.message;}
}
function renderApplications() {
    const filter=$('application-filter').value;
    $('applications-list').innerHTML=applications.filter(a=>!filter||a.lead_type===filter).map(a=>`<article class="application" data-application="${esc(a.id)}"><div class="manager-heading"><h3>${esc(a.name)}</h3><span class="badge">${esc(a.lead_type)}</span></div><p class="meta">${esc(new Date(a.created_at).toLocaleString())}${a.form_data?.jobTitle?` · ${esc(a.form_data.jobTitle)}`:''}</p><p>${esc(a.email)}${a.phone?` · ${esc(a.phone)}`:''}</p><p>${esc(a.message)}</p>${a.form_data?.portfolioUrl&&/^https:\/\//.test(a.form_data.portfolioUrl)?`<p><a href="${esc(a.form_data.portfolioUrl)}" target="_blank" rel="noopener noreferrer">Open professional profile ↗</a></p>`:''}<div class="application-controls"><label>Status<select name="status">${statuses.map(s=>`<option${a.status===s?' selected':''}>${s}</option>`).join('')}</select></label><label>Internal notes<textarea name="notes" maxlength="10000">${esc(a.internal_notes||'')}</textarea></label><button class="btn btn-primary" data-save-application="${esc(a.id)}">Save review</button></div><p class="application-status" role="status"></p></article>`).join('')||'<p class="text-muted">No requests in this view.</p>';
}
document.addEventListener('DOMContentLoaded',async()=>{
    const client=await ensureSupabaseClient();const {data:{session}}=await client.auth.getSession();if(!session)return;
    try{const result=await json('/api/website/admin');content=result.content;revision=result.revision;status('Website content loaded. Changes stay in draft until published.');}
    catch(error){status(error.message,'error');return;}
    $('publish-content').disabled=false;renderProjects();renderJobs();fill($('referral-editor'),content.referral);fill($('story-editor'),{...content.about,story:content.about.story.join('\n\n')});
    document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>switchPanel(b.dataset.panel)));
    document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
    $('new-project').addEventListener('click',()=>openProject());$('new-job').addEventListener('click',()=>openJob());
    $('project-editor').elements.title.addEventListener('input',e=>{const f=$('project-editor');if(!f.elements.originalId.value)f.elements.id.value=e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);});
    $('job-editor').elements.title.addEventListener('input',e=>{const f=$('job-editor');if(!f.elements.originalId.value)f.elements.id.value=e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);});
    $('project-editor').addEventListener('submit',e=>{e.preventDefault();const f=e.target,fd=new FormData(f),p=Object.fromEntries(fd),id=p.originalId;delete p.originalId;p.featured=fd.has('featured');p.published=fd.has('published');p.sortOrder=Number(p.sortOrder);p.technologies=p.technologies.split(',').map(t=>t.trim()).filter(Boolean);if(content.projects.some(x=>x.id===p.id&&x.id!==id)){f.querySelector('.editor-error').textContent='This project ID is already used.';return;}const i=content.projects.findIndex(x=>x.id===id);if(i>=0)content.projects[i]=p;else content.projects.push(p);$('project-dialog').close();renderProjects();markDirty();});
    $('job-editor').addEventListener('submit',e=>{e.preventDefault();const f=e.target,fd=new FormData(f),j=Object.fromEntries(fd),id=j.originalId;delete j.originalId;j.published=fd.has('published');if(content.jobs.some(x=>x.id===j.id&&x.id!==id)){f.querySelector('.editor-error').textContent='This vacancy ID is already used.';return;}const i=content.jobs.findIndex(x=>x.id===id);if(i>=0)content.jobs[i]=j;else content.jobs.push(j);$('job-dialog').close();renderJobs();markDirty();});
    $('referral-editor').addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.target);content.referral={...Object.fromEntries(fd),enabled:fd.has('enabled')};markDirty();});
    $('story-editor').addEventListener('submit',e=>{e.preventDefault();content.about=Object.fromEntries(new FormData(e.target));content.about.story=content.about.story.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);markDirty();});
    // Unsaved field changes also warn before navigating away.
    document.querySelectorAll('.manager-form').forEach(f=>f.addEventListener('input',()=>{dirty=true;}));
    document.addEventListener('click',async e=>{
        const b=e.target.closest('button');if(!b)return;
        if(b.dataset.editProject)openProject(b.dataset.editProject);
        if(b.dataset.toggleProject){const p=content.projects.find(p=>p.id===b.dataset.toggleProject);p.published=!p.published;renderProjects();markDirty();}
        if(b.dataset.removeProject&&confirm('Remove this project from the draft? Publish changes to apply.')){content.projects=content.projects.filter(p=>p.id!==b.dataset.removeProject);renderProjects();markDirty();}
        if(b.dataset.editJob)openJob(b.dataset.editJob);
        if(b.dataset.removeJob&&confirm('Remove this vacancy? Existing applications will be kept.')){content.jobs=content.jobs.filter(j=>j.id!==b.dataset.removeJob);renderJobs();markDirty();}
        if(b.dataset.saveApplication){const row=b.closest('.application'),out=row.querySelector('.application-status');b.disabled=true;try{const status=row.querySelector('[name=status]').value,notes=row.querySelector('[name=notes]').value;await json(`/api/website/applications/${encodeURIComponent(b.dataset.saveApplication)}`,{method:'PATCH',body:JSON.stringify({status,notes})});const a=applications.find(a=>a.id===b.dataset.saveApplication);a.status=status;a.internal_notes=notes;out.textContent='Review saved.';}catch(error){out.textContent=error.message;}finally{b.disabled=false;}}
    });
    $('publish-content').addEventListener('click',async()=>{
        // Include the currently visible story/program fields, even before their draft buttons.
        if(!$('story-editor').reportValidity()||!$('referral-editor').reportValidity())return;
        content.about=Object.fromEntries(new FormData($('story-editor')));content.about.story=content.about.story.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
        const fd=new FormData($('referral-editor'));content.referral={...Object.fromEntries(fd),enabled:fd.has('enabled')};
        const b=$('publish-content');b.disabled=true;status('Publishing…');
        try{const result=await json('/api/website/admin',{method:'PUT',body:JSON.stringify({content,revision})});content=result.content;revision=result.revision;dirty=false;status('Published. The public website will show your changes within 30 seconds.','success');}
        catch(error){status(error.message,'error');}finally{b.disabled=false;}
    });
    $('refresh-applications').addEventListener('click',loadApplications);$('application-filter').addEventListener('change',renderApplications);
    switchPanel(new URLSearchParams(location.search).get('section'));
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
