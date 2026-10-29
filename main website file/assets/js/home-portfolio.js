(() => {
    const target = document.getElementById('featured-projects');
    const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const safeImage = value => { if(/^\/(?!\/)/.test(value||''))return value;try{if(new URL(value).protocol==='https:')return value;}catch{}return ''; };
    function render(content) {
        if(!target || !Array.isArray(content.projects))return;
        const projects=(Array.isArray(content.recentProjects) ? content.recentProjects :
            content.projects.filter(p=>p.published).sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)||a.sortOrder-b.sortOrder)).slice(0,3);
        target.innerHTML=projects.map(p=>{
            const href=`/project.html?id=${encodeURIComponent(p.id)}`,image=safeImage(p.image);
            return `<article class="project-card"><a class="project-cover" href="${href}" aria-label="Explore ${escape(p.title)}">${image?`<img src="${escape(image)}" alt="${escape(p.title)}" width="480" height="267" loading="lazy" decoding="async">`:`<span class="project-monogram">${escape(p.title)}</span>`}</a><div class="project-info"><div class="project-meta"><span class="badge ${escape(p.complexity)}">${p.complexity==='advanced'?'Advanced backend':p.complexity==='mobile'?'Mobile application':'Simple website'}</span><small>${escape(p.category)}</small></div><h3><a href="${href}">${escape(p.title)}</a></h3><p>${escape(p.summary)}</p><a class="text-link" href="${href}">Explore project ↗</a></div></article>`;
        }).join('');
    }
    fetch('/api/website/public',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw Error('Unavailable');return r.json();}).then(render).catch(()=>{});
    // Deep links from the full services catalogue open the existing industry form.
    document.addEventListener('DOMContentLoaded',()=>{
        const service=new URLSearchParams(location.search).get('service');
        if(!service)return;
        const title=[...document.querySelectorAll('#services h4')].find(h=>h.textContent.trim()===service);
        const card=title?.closest('.solution-card-cursor'),form=card?.querySelector('.solution-form-container');
        if(form&&typeof window.toggleSolutionForm==='function'){window.toggleSolutionForm(form.id);card.scrollIntoView({block:'center'});}
    });
})();
