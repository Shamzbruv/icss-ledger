const express = require('express');
const { validateContent, publicContent } = require('../services/websiteContentService');

module.exports = function websiteRoutes(db, contentService) {
    const router = express.Router();
    router.get('/public', async (req, res) => {
        const result = await contentService.read();
        res.set('Cache-Control', result.storageAvailable ? 'public, max-age=30' : 'no-store');
        res.json(publicContent(result.content));
    });
    router.get('/admin', async (req, res) => {
        try { res.set('Cache-Control', 'no-store'); res.json(await contentService.read({ strict: true })); }
        catch { res.status(503).json({ error: 'Website storage is unavailable. Check that the ICSS Supabase project is running. Your changes have not been saved.' }); }
    });
    router.put('/admin', async (req, res) => {
        let content;
        try { content = validateContent(req.body.content); }
        catch (error) { return res.status(400).json({ error: error.message }); }
        try {
            const revision = await contentService.writeSection('website', content, req.body.revision ?? null);
            res.json({ content, revision, storageAvailable: true });
        } catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : 'Website storage is unavailable. No changes were saved. Please try again when the database is running.' }); }
    });
    router.post('/applications', async (req, res) => {
        const b = req.body;
        if (b.website || !['referral', 'career'].includes(b.type)) return res.status(400).json({ error: 'Invalid request.' });
        if (typeof b.name !== 'string' || typeof b.email !== 'string' || !b.name.trim() || b.name.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email || '') || b.email.length > 254 || b.consent !== true || (typeof b.message !== 'string' || !b.message.trim() || b.message.length > 5000) || String(b.phone || '').length > 60) return res.status(400).json({ error: 'Provide your name, a valid email, a message within 5,000 characters and contact consent.' });
        try {
            const { content } = await contentService.read({ strict: true });
            const job = publicContent(content).jobs.find(j => j.id === b.jobId);
            if ((b.type === 'career' && !job) || (b.type === 'referral' && !content.referral.enabled)) return res.status(400).json({ error: 'This opportunity is no longer accepting applications.' });
            const portfolioUrl = require('../services/websiteContentService').safeUrl(b.portfolioUrl, false);
            const { error } = await db.from('leads').insert({ source: 'Work with ICSS', lead_type: b.type === 'career' ? 'Career Application' : 'Referral Program', name: b.name.trim(), email: b.email.trim(), phone: String(b.phone || '').trim(), message: String(b.message || '').trim(), status: 'New', priority: 'Warm', consent_given: true, form_data: { type: b.type, jobId: job?.id || null, jobTitle: job?.title || null, portfolioUrl } });
            if (error) throw error;
            res.status(201).json({ success: true });
        } catch { res.status(503).json({ error: 'We could not save your application. Please try again later or email iCreatesolutions.ja@gmail.com.' }); }
    });
    router.get('/applications', async (req, res) => {
        const { data, error } = await db.from('leads').select('id,created_at,name,email,phone,lead_type,message,status,internal_notes,form_data').eq('source', 'Work with ICSS').order('created_at', { ascending: false }).limit(200);
        if (error) return res.status(503).json({ error: 'Applications are unavailable. Please check the database connection.' });
        res.set('Cache-Control', 'no-store').json(data);
    });
    router.patch('/applications/:id', async (req, res) => {
        if (!['New', 'Reviewing', 'Contacted', 'Approved', 'Declined', 'Closed'].includes(req.body.status) || String(req.body.notes || '').length > 10000) return res.status(400).json({ error: 'Invalid status or notes.' });
        const { data, error } = await db.from('leads').update({ status: req.body.status, internal_notes: String(req.body.notes || ''), updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('source', 'Work with ICSS').select('id').maybeSingle();
        if (error) return res.status(503).json({ error: 'Application could not be updated.' });
        if (!data) return res.status(404).json({ error: 'Application not found.' });
        res.json({ success: true });
    });
    return router;
};
