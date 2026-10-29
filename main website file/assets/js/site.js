(() => {
    'use strict';
    const page = document.body.dataset.page;
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const url = value => {
        if (!value) return '';
        if (/^\/(?!\/)/.test(value)) return value;
        if (/^projects\/[\w/.-]+\.html$/.test(value)) return `/${value}`;
        try { if (new URL(value).protocol === 'https:') return value; } catch {}
        return '';
    };
    const menu = document.querySelector('.menu-toggle');
    menu?.addEventListener('click', () => { const open = $('site-nav').classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('site-nav')?.classList.remove('open'); menu?.setAttribute('aria-expanded', 'false'); } });
    let contentPromise;
    let currentProjects = [];
    function content() {
        if (!contentPromise) contentPromise = fetch('/api/website/public', { signal: AbortSignal.timeout(6000) })
            .then(r => { if (!r.ok) throw Error('Unavailable'); return r.json(); })
            .catch(() => fetch('/assets/website-defaults.json').then(r => { if (!r.ok) throw Error('Unavailable'); return r.json(); }));
        return contentPromise;
    }
    const typeLabel = p => p.complexity === 'advanced' ? 'Advanced backend' : p.complexity === 'mobile' ? 'Mobile application' : 'Simple website';
    function cover(p, i) {
        const src = url(p.image);
        return `<div class="project-cover" data-tone="${i%5}">${src ? `<img src="${escape(src)}" loading="lazy" decoding="async" width="480" height="267" alt="${escape(p.title)}">` : `<span class="project-monogram">${escape(p.title)}</span>`}</div>`;
    }
    function card(p,i) {
        const href = `/project.html?id=${encodeURIComponent(p.id)}`;
        return `<article class="project-card"><a href="${href}" aria-label="Explore ${escape(p.title)}">${cover(p,i)}</a><div class="project-info"><div class="project-meta"><span class="badge ${escape(p.complexity)}">${typeLabel(p)}</span><small>${escape(p.category)}</small></div><h3><a href="${href}">${escape(p.title)}</a></h3><p>${escape(p.summary)}</p><a class="text-link" href="${href}">Explore project ↗</a></div></article>`;
    }
    const publishedProjects = d => d.projects.filter(p => p.published).sort((a,b) => a.sortOrder-b.sortOrder);
    async function init(provided) {
        if (['index','portfolio','project','about','work-with-icss'].includes(page)) {
            try {
                const data = provided || await content();
                if (page === 'index') $('featured-projects').innerHTML = (data.recentProjects || publishedProjects(data).sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0))).slice(0,3).map(card).join('') || '<p class="empty">New work will be shared here soon.</p>';
                if (page === 'portfolio') {
                    currentProjects = publishedProjects(data);
                    const projects = currentProjects;
                    const category = $('project-category');
                    const previousCategory = category.value;
                    category.innerHTML = '<option value="">All categories</option>' + [...new Set(projects.map(p=>p.category))].sort().map(c=>`<option>${escape(c)}</option>`).join('');
                    if ([...category.options].some(o => o.value === previousCategory)) category.value = previousCategory;
                    function render() {
                        const q = $('project-search').value.trim().toLowerCase();
                        const filtered = currentProjects.filter(p => (!category.value || p.category === category.value) && (!$('project-complexity').value || p.complexity === $('project-complexity').value) && `${p.title} ${p.category} ${p.summary} ${p.technologies.join(' ')}`.toLowerCase().includes(q));
                        $('portfolio-projects').innerHTML = filtered.map(card).join('') || '<p class="empty">No projects match these filters. Try another category or search.</p>';
                        $('project-count').textContent = `${filtered.length} project${filtered.length === 1 ? '' : 's'}`;
                    }
                    ['project-search','project-category','project-complexity'].forEach(id => { const el=$(id); if(!el.dataset.bound){el.addEventListener('input',render);el.dataset.bound='true';} }); render();
                }
                if (page === 'project') {
                    const p = publishedProjects(data).find(p => p.id === new URLSearchParams(location.search).get('id'));
                    if (!p) { $('project-detail').innerHTML = '<h2>Project not found.</h2><p>This project may no longer be published.</p><a class="button" href="/portfolio">Back to the portfolio</a>'; return; }
                    document.title = `${p.title} | ICSS Portfolio`;
                    document.querySelector('h1').textContent = p.title;
                    document.querySelector('.hero p').textContent = p.summary;
                    $('project-detail').innerHTML = `<div class="two-col"><div>${cover(p,0)}</div><div><div class="project-meta"><span class="badge ${escape(p.complexity)}">${typeLabel(p)}</span><span class="badge">${escape(p.category)}</span><span class="badge">${escape(p.kind)}</span></div><h2 style="margin-top:25px">The experience.</h2><p class="intro project-description">${escape(p.description)}</p><div class="tags">${p.technologies.map(t=>`<span class="badge">${escape(t)}</span>`).join('')}</div><div class="actions">${url(p.url)?`<a class="button" href="${escape(url(p.url))}" target="_blank" rel="noopener noreferrer">Visit project ↗</a>`:''}${url(p.appUrl)?`<a class="button secondary" href="${escape(url(p.appUrl))}" target="_blank" rel="noopener noreferrer">Get it on Google Play ↗</a>`:''}</div><a class="text-link" href="/contact">Have a similar idea? Let's talk ↗</a></div></div><div class="actions"><a class="text-link" href="/portfolio">← Back to the portfolio</a></div>`;
                    const canonical = document.querySelector('link[rel=canonical]'); canonical.href = `https://icreatesolutionsandservices.com/project.html?id=${encodeURIComponent(p.id)}`;
                }
                if (page === 'about') {
                    document.querySelector('h1').textContent = data.about.title;
                    document.querySelector('.hero .eyebrow').textContent = data.about.eyebrow;
                    $('about-story').innerHTML = data.about.story.map(p=>`<p>${escape(p)}</p>`).join('') + `<blockquote class="quote">${escape(data.about.motto)}</blockquote>${url(data.about.linkedin)?`<a class="button" href="${escape(url(data.about.linkedin))}" target="_blank" rel="noopener noreferrer">Follow ICSS on LinkedIn ↗</a>`:''}`;
                }
                if (page === 'work-with-icss') initOpportunities(data);
            } catch {
                if (page === 'project') $('project-detail').innerHTML = '<p class="empty">Project details are unavailable. Please try again later.</p>';
            }
        }
    }
    function initOpportunities(data) {
        const today = new Date().toLocaleDateString('en-CA',{timeZone:'America/Jamaica'});
        const jobs = data.jobs.filter(j => j.published && (!j.closesOn || j.closesOn >= today));
        $('job-list').innerHTML = jobs.length ? jobs.map(j=>`<article class="job-card"><h3>${escape(j.title)}</h3><div class="job-meta">${escape(j.type)} · ${escape(j.location)}${j.closesOn?` · Closes ${escape(j.closesOn)}`:''}</div><p>${escape(j.description)}</p>${j.requirements?`<h4>What you'll bring</h4><p>${escape(j.requirements)}</p>`:''}<a class="text-link apply-job" href="#apply" data-job="${escape(j.id)}">Apply for this role ↗</a></article>`).join('') : '<div class="empty">There are no advertised vacancies right now. Check back for new opportunities.</div>';
        $('referral-title').textContent=data.referral.title; $('referral-description').textContent=data.referral.description; $('referral-terms').textContent=data.referral.terms;
        $('referral-info').hidden=!data.referral.enabled;
        const select=$('application-type'); select.innerHTML=(data.referral.enabled?'<option value="referral">Referral program</option>':'')+(jobs.length?'<option value="career">Career application</option>':'');
        $('application-job').innerHTML=jobs.map(j=>`<option value="${escape(j.id)}">${escape(j.title)}</option>`).join('');
        function sync() { $('job-field').hidden=select.value!=='career'; $('application-job').required=select.value==='career'; }
        select.addEventListener('change',sync); sync();
        document.querySelectorAll('.apply-job').forEach(a=>a.addEventListener('click',()=>{select.value='career';$('application-job').value=a.dataset.job;sync();}));
        if (!jobs.length && !data.referral.enabled) { $('apply').innerHTML='<p class="empty">Applications are currently closed. Check back for new opportunities.</p>'; return; }
        bindForm($('opportunity-form'), '/api/website/applications', fd=>({ ...Object.fromEntries(fd), consent: fd.has('consent') }), 'Your request has been received. ICSS will review your details and contact you about the next step.');
    }
    function bindForm(form, endpoint, payload, success) {
        if (!form || form.dataset.bound) return;
        form.dataset.bound='true';
        const started=Date.now();
        form.addEventListener('submit',async e=>{
            e.preventDefault(); const btn=form.querySelector('[type=submit]'),status=form.querySelector('.form-status'),label=btn.textContent;
            btn.disabled=true;btn.textContent='Sending…';status.textContent='';status.classList.remove('error');
            try {
                const body=payload(new FormData(form)); body.submission_time_ms=Date.now()-started;
                const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
                const result=await r.json(); if (!r.ok) throw Error(result.error||'Your request could not be saved. Please try again.');
                form.reset(); $('application-type')?.dispatchEvent(new Event('change'));status.textContent=success;
            } catch(err) { status.classList.add('error');status.textContent=err.name==='TimeoutError'?'The request timed out. Please check with ICSS before resubmitting to avoid a duplicate.':err.message; }
            finally {btn.disabled=false;btn.textContent=label;}
        });
    }
    bindForm($('contact-form'),'/api/leads',fd=>({...Object.fromEntries(fd),source:'Contact page',lead_type:'Consultation Request',page_url:location.href,consent_given:fd.has('consent')}),'Thank you. Your inquiry has been received. We will contact you about your project.');
    // The static content responds immediately while saved content revalidates.
    // Project details wait for the authoritative response to avoid a false 404.
    if (page === 'project') init();
    else if (['index','portfolio','about','work-with-icss'].includes(page)) {
        const remote = content();
        const initial = fetch('/assets/website-defaults.json').then(r=>r.json()).then(d=>init(d)).catch(()=>{});
        remote.then(async d=>{await initial;await init(d);}).catch(()=>{});
    }
})();
