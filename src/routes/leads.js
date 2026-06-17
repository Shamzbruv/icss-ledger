const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { sendEmail } = require('../services/emailService');

// Public lead submission
router.post('/', async (req, res) => {
    try {
        const payload = req.body;
        
        // Spam protection: honeypot check
        if (payload.honeypot) {
            return res.status(400).json({ error: 'Spam detected' });
        }

        // Spam protection: submission timing (if provided and < 3s)
        if (payload.submission_time_ms && parseInt(payload.submission_time_ms) < 3000) {
            return res.status(400).json({ error: 'Form submitted too quickly' });
        }

        // Basic validation
        if (!payload.name) {
            return res.status(400).json({ error: 'Name is required' });
        }
        if (!payload.email && !payload.phone) {
            return res.status(400).json({ error: 'Email or phone is required' });
        }
        if (payload.lead_type === 'Free Website Audit' && !payload.website_url) {
            return res.status(400).json({ error: 'Website URL is required for audit' });
        }

        // Message length
        const msg = payload.message || '';
        if (msg.length > 5000) {
            return res.status(400).json({ error: 'Message too long' });
        }

        // Auto priority
        let priority = 'Warm';
        const hotTriggers = [
            'ASAP',
            'Ready to Start',
            'Package Inquiry',
            'Consultation Request',
            'Instant Quote'
        ];
        
        const isHotBudget = payload.budget && (payload.budget.includes('120,000') || payload.budget.includes('250,000') || payload.budget.includes('500,000') || payload.budget.includes('$1,299') || payload.budget.includes('$2,999'));
        const hasPhone = !!payload.phone;
        
        if (
            hotTriggers.includes(payload.timeline) ||
            hotTriggers.includes(payload.project_stage) ||
            hotTriggers.includes(payload.lead_type) ||
            isHotBudget ||
            hasPhone
        ) {
            priority = 'Hot';
        }

        const { data, error } = await supabase
            .from('leads')
            .insert({
                source: payload.source,
                lead_type: payload.lead_type || 'Contact Form',
                page_url: payload.page_url,
                referrer: payload.referrer,
                landing_page: payload.landing_page,
                utm_source: payload.utm_source,
                utm_medium: payload.utm_medium,
                utm_campaign: payload.utm_campaign,
                utm_content: payload.utm_content,
                utm_term: payload.utm_term,
                user_agent: req.get('User-Agent'),
                status: 'New',
                priority: priority,
                name: payload.name,
                email: payload.email,
                phone: payload.phone,
                business_name: payload.business_name,
                website_url: payload.website_url,
                preferred_contact_method: payload.preferred_contact_method,
                consent_given: payload.consent_given === true,
                service_needed: payload.service_needed,
                package_name: payload.package_name,
                project_type: payload.project_type,
                project_stage: payload.project_stage,
                budget: payload.budget,
                timeline: payload.timeline,
                goal: payload.goal,
                message: msg,
                pain_point: payload.pain_point,
                description: payload.description,
                selected_features: payload.selected_features || [],
                selected_needs: payload.selected_needs || [],
                form_data: payload.form_data || {}
            })
            .select()
            .single();

        if (error) {
            console.error('Error inserting lead:', error);
            return res.status(500).json({ error: 'Failed to save lead' });
        }

        console.log(`[LEADS] Saved lead ${data.id} | ${payload.lead_type} | ${payload.email || payload.phone}`);

        // Email notification (non-blocking)
        try {
            const adminEmail = process.env.ADMIN_EMAIL;
            if (adminEmail) {
                const subject = `New Lead: ${payload.lead_type} - ${payload.name}`;
                const textBody = `
New lead received from ${payload.source}:
Name: ${payload.name}
Email: ${payload.email}
Phone: ${payload.phone}
Business: ${payload.business_name}
Service: ${payload.service_needed || payload.package_name}
Budget: ${payload.budget}
Timeline: ${payload.timeline}
Message: ${msg}
                `;
                // Using existing email service - assuming it handles standard emails or we can mock standard params
                // Call the generic sendEmail helper
                // We'll pass null for attachment
                const emailSent = await sendEmail(adminEmail, subject, `<pre>${textBody}</pre>`);
                if (!emailSent) {
                    console.error('Lead notification email returned false');
                } else {
                    console.log('Lead notification email sent successfully');
                }
                
                // Add email_notification_sent flag to form_data to keep track
                const updatedFormData = payload.form_data || {};
                updatedFormData.email_notification_sent = !!emailSent;
                await supabase.from('leads').update({ form_data: updatedFormData }).eq('id', data.id);
            } else {
                console.warn('ADMIN_EMAIL not set, skipping lead notification email');
            }
        } catch (emailErr) {
            console.error('Lead notification email failed, but lead was saved:', emailErr);
            const updatedFormData = payload.form_data || {};
            updatedFormData.email_notification_sent = false;
            await supabase.from('leads').update({ form_data: updatedFormData }).eq('id', data.id);
        }

        res.json({ success: true, message: 'Lead saved successfully', leadId: data.id });
    } catch (err) {
        console.error('Lead submission error:', err);
        res.status(500).json({ error: 'Server error during submission' });
    }
});

// Protected admin endpoints (mounting in server.js will handle requireAuth)

// List all leads
router.get('/', async (req, res) => {
    try {
        console.log(`[LEADS] Admin list requested`);
        let query = supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(100);
        
        if (req.query.status) query = query.eq('status', req.query.status);
        if (req.query.priority) query = query.eq('priority', req.query.priority);
        if (req.query.lead_type) query = query.eq('lead_type', req.query.lead_type);

        const { data, error } = await query;
        if (error) throw error;
        
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Dashboard stats
router.get('/stats', async (req, res) => {
    try {
        const { data, error } = await supabase.from('leads').select('status, priority, lead_type, source');
        if (error) throw error;
        
        console.log(`[LEADS] Stats requested: ${data.length} leads found`);

        const stats = {
            total: data.length,
            new: data.filter(l => l.status === 'New').length,
            hot: data.filter(l => l.priority === 'Hot').length,
            won: data.filter(l => l.status === 'Won').length,
            byType: {},
            bySource: {}
        };

        data.forEach(l => {
            if (l.lead_type) {
                stats.byType[l.lead_type] = (stats.byType[l.lead_type] || 0) + 1;
            }
            if (l.source) {
                stats.bySource[l.source] = (stats.bySource[l.source] || 0) + 1;
            }
        });

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single lead
router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('leads').select('*').eq('id', req.params.id).single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update lead
router.patch('/:id', async (req, res) => {
    try {
        const { status, priority, internal_notes } = req.body;
        const updates = { updated_at: new Date().toISOString() };
        
        if (status) updates.status = status;
        if (priority) updates.priority = priority;
        if (internal_notes !== undefined) updates.internal_notes = internal_notes;

        const { data, error } = await supabase.from('leads').update(updates).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json({ success: true, lead: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Hard delete lead
router.delete('/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('leads').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Lead deleted permanently' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
