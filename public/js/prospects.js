const byId = id => document.getElementById(id);
const stages = ['New', 'Reviewed', 'Contacted', 'Replied', 'Proposal sent', 'Client'];
const size = 15;
let page = 0, request = 0, db;
function element(tag, text) {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    return item;
}
function labeled(label, input) {
    const el = element('label', label + ' ');
    el.append(input);
    return el;
}
function prospect(row) {
    const card = element('details');
    const summary = element('summary', row.business);
    summary.append(element('small', [row.product, row.location, stages[row.stage], row.discovered_on].filter(Boolean).join(' · ')));
    const source = element('a', 'Business source ↗');
    source.href = row.source_url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    card.append(summary, element('p', row.fit), source, element('p', [row.contact_name, row.email, row.phone && 'Phone '+row.phone, row.whatsapp && 'WhatsApp '+row.whatsapp].filter(Boolean).join(' · ')));
    if (!row.suppressed) {
        for (const [title,key] of [['Email draft','email_draft'],['WhatsApp draft','whatsapp_draft'],['Call script','call_script']]) {
            const section = element('details'), copy = element('button','Copy');
            copy.onclick = async () => {
                try { await navigator.clipboard.writeText(row[key]); copy.textContent = 'Copied'; }
                catch { copy.textContent = 'Select the text to copy'; }
            };
            section.append(element('summary', title),element('pre',row[key]),copy);
            card.append(section);
        }
    }
    let stage = row.stage;
    const steps = element('div');
    steps.className = 'steps';
    const boxes = stages.slice(1).map((name,index) => {
        const box = element('input');
        box.type = 'checkbox'; box.checked = stage > index;
        box.onchange = () => {
            stage = box.checked ? index + 1 : index;
            boxes.forEach((item,i) => item.checked = i < stage);
        };
        steps.append(labeled(name,box));
        return box;
    });
    const notes = element('textarea'), follow = element('input'), stop = element('input');
    notes.value = row.notes; notes.maxLength = 6000;
    follow.type = 'date'; follow.value = row.follow_up || '';
    stop.type = 'checkbox'; stop.checked = row.suppressed;
    const actions = element('div'); actions.className = 'save-row';
    const save = element('button','Save progress'), feedback = element('span');
    feedback.setAttribute('role','status'); save.className = 'save';
    save.onclick = async () => {
        save.disabled = true;
        try {
            const {data,error} = await db.from('sales_prospects').update({stage,notes:notes.value,follow_up:follow.value || null,suppressed:stop.checked,revision:row.revision+1}).eq('id',row.id).eq('revision',row.revision).select('id').maybeSingle();
            if (error) throw error;
            if (!data) throw Error('Record changed. Refresh before saving.');
            await refresh('Progress saved. ');
        } catch (e) { feedback.textContent = e.message || 'Save failed. Try again.'; }
        finally { save.disabled = false; }
    };
    actions.append(labeled('Follow up',follow),labeled('Do not contact',stop),save,feedback);
    card.append(steps,labeled('Conversation notes',notes),actions);
    return card;
}
async function refresh(prefix='') {
    const current = ++request;
    byId('rows').replaceChildren();
    byId('prev').disabled = byId('next').disabled = true;
    byId('status').textContent = 'Loading prospects…';
    try {
        db = await window.ensureSupabaseClient();
        const filter = byId('queue').value;
        let query = db.from('sales_prospects').select('*',{count:'exact'}).eq('suppressed',filter==='stop');
        if (filter==='new') query = query.eq('stage',0);
        if (filter==='active') query = query.gt('stage',0).lt('stage',5);
        if (filter==='won') query = query.eq('stage',5);
        if (filter==='due') query = query.lt('stage',5).lte('follow_up',new Intl.DateTimeFormat('en-CA',{timeZone:'America/Jamaica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())).order('follow_up');
        if (byId('product').value) query = query.eq('product',byId('product').value);
        const {data,count,error} = await query.order('discovered_on',{ascending:false}).order('id').range(page*size,(page+1)*size-1);
        if (current!==request) return;
        if (error) throw error;
        if (!data.length && page>0) {page--; return refresh(prefix);}
        byId('rows').replaceChildren(...data.map(prospect));
        byId('status').textContent = prefix + (count ? (page*size+1)+'–'+(page*size+data.length)+' of '+count+' prospects' : 'No prospects in this queue.');
        byId('prev').disabled = page===0;
        byId('next').disabled = (page+1)*size>=count;
    } catch { if (current===request) byId('status').textContent = 'Could not load prospects. Refresh to retry.'; }
}
for (const id of ['product','queue']) byId(id).onchange = () => {page=0; refresh();};
byId('prev').onclick = () => {page--;refresh();};
byId('next').onclick = () => {page++;refresh();};
refresh();
