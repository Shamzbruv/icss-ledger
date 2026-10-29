const defaults = require('../data/website-defaults.json');

const clone = value => JSON.parse(JSON.stringify(value));
function safeUrl(value, local = true) {
    if (!value) return '';
    const str = String(value).trim();
    if (local && /^\/(?!\/)/.test(str)) return str;
    // Existing portfolio demonstrations have relative project paths.
    if (local && /^projects\/[\w/.-]+\.html$/.test(str)) return `/${str}`;
    try { const url = new URL(str); if (url.protocol === 'https:') return url.href; } catch {}
    throw new Error('Use an https:// URL or a local path beginning with /.');
}
function text(value, max = 500, required = false) {
    const str = String(value ?? '').trim();
    if ((required && !str) || str.length > max) throw new Error(`Text must ${required ? 'be supplied and ' : ''}contain at most ${max} characters.`);
    return str;
}
function validateContent(input) {
    if (!input || !Array.isArray(input.projects) || !Array.isArray(input.jobs) || !input.about || !input.referral) throw new Error('Incomplete website content.');
    if (input.projects.length > 150 || input.jobs.length > 100) throw new Error('Too many projects or jobs.');
    const ids = new Set();
    const id = value => {
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value || '') || ids.has(value)) throw new Error('Use a unique ID containing lowercase letters, numbers and hyphens.');
        ids.add(value); return value;
    };
    const projects = input.projects.map(p => {
        if (!['simple', 'advanced', 'mobile'].includes(p.complexity)) throw new Error('Choose a valid project complexity.');
        return { id: id(p.id), title: text(p.title, 150, true), category: text(p.category, 100, true), complexity: p.complexity,
            summary: text(p.summary, 400, true), description: text(p.description, 6000), url: safeUrl(p.url), appUrl: safeUrl(p.appUrl, false), image: safeUrl(p.image),
            featured: p.featured === true, published: p.published === true, kind: text(p.kind, 80),
            sortOrder: Number.isFinite(Number(p.sortOrder)) ? Number(p.sortOrder) : 0,
            technologies: (Array.isArray(p.technologies) ? p.technologies : []).slice(0, 20).map(t => text(t, 60)) };
    });
    ids.clear();
    const jobs = input.jobs.map(j => ({ id: id(j.id), title: text(j.title, 150, true), location: text(j.location, 150, true),
        type: text(j.type, 100, true), description: text(j.description, 6000, true), requirements: text(j.requirements, 4000),
        published: j.published === true, closesOn: j.closesOn ? text(j.closesOn, 10) : '' }));
    jobs.forEach(j => { if (j.closesOn && (!/^\d{4}-\d{2}-\d{2}$/.test(j.closesOn) || new Date(j.closesOn).toISOString().slice(0, 10) !== j.closesOn)) throw new Error('Invalid job closing date.'); });
    if (!Array.isArray(input.about.story) || input.about.story.length > 15) throw new Error('Supply up to 15 story paragraphs.');
    return { version: 1, projects, jobs,
        about: { eyebrow: text(input.about.eyebrow, 150), title: text(input.about.title, 200, true), story: input.about.story.map(p => text(p, 3000)), motto: text(input.about.motto, 250), linkedin: safeUrl(input.about.linkedin, false) },
        referral: { enabled: input.referral.enabled === true, title: text(input.referral.title, 200, true), description: text(input.referral.description, 3000), terms: text(input.referral.terms, 3000) } };
}
function publicContent(content) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Jamaica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return { ...content, projects: content.projects.filter(p => p.published).sort((a,b) => a.sortOrder - b.sortOrder),
        jobs: content.jobs.filter(j => j.published && (!j.closesOn || j.closesOn >= today)) };
}
function createWebsiteContentService(db) {
    let cached; let expires = 0; let pending;
    async function readRow() {
        const { data, error } = await db.from('link_hub_settings').select('content, updated_at').eq('id', 1).maybeSingle().abortSignal(AbortSignal.timeout(4000));
        if (error) throw error;
        return data;
    }
    async function read({ strict = false } = {}) {
        if (!strict && cached && Date.now() < expires) return clone(cached);
        if (!strict && pending) return clone(await pending);
        const work = async () => {
            try {
                const row = await readRow();
                const result = { content: row?.content?.website || clone(defaults), revision: row?.updated_at || null, storageAvailable: true };
                cached = result; expires = Date.now() + 30000; return clone(result);
            } catch (error) {
                if (strict) throw error;
                const result = { content: clone(defaults), revision: null, storageAvailable: false };
                cached = result; expires = Date.now() + 10000; return result;
            }
        };
        if (strict) return work();
        pending = work();
        try { return await pending; } finally { pending = null; }
    }
    // One document in the existing settings row. Compare-and-swap prevents a stale
    // editor or Link Hub save from erasing either section of the shared document.
    async function writeSection(section, value, expectedRevision) {
        const row = await readRow();
        if (expectedRevision !== undefined && expectedRevision !== (row?.updated_at || null)) {
            const error = new Error('The content changed in another window. Reload before saving.'); error.status = 409; throw error;
        }
        const content = section === 'website' ? { ...(row?.content || {}), website: value }
            : { ...value, ...(row?.content?.website ? { website: row.content.website } : {}) };
        const updated_at = new Date(Math.max(Date.now(), (Date.parse(row?.updated_at || '') || 0) + 1)).toISOString();
        let result;
        if (row) result = await db.from('link_hub_settings').update({ content, updated_at }).eq('id', 1).eq('updated_at', row.updated_at).select('updated_at').maybeSingle();
        else result = await db.from('link_hub_settings').insert({ id: 1, content, updated_at }).select('updated_at').single();
        if (result.error) throw result.error;
        if (!result.data) { const error = new Error('Content changed while saving. Reload and try again.'); error.status = 409; throw error; }
        cached = null; expires = 0;
        return result.data.updated_at;
    }
    return { read, writeSection };
}
module.exports = { createWebsiteContentService, validateContent, publicContent, safeUrl };
