const express = require('express');
const router = express.Router();
const supabase = require('../db');

// Public: Get approved reviews
router.get('/', async (req, res) => {
    try {
        let query = supabase
            .from('reviews')
            .select('id, created_at, name, business_name, rating, website_url, service_completed, message')
            .eq('status', 'approved')
            .order('created_at', { ascending: false });
        
        // If limit is provided (e.g. for homepage)
        if (req.query.limit) {
            query = query.limit(parseInt(req.query.limit));
        }

        const { data, error } = await query;
        if (error) throw error;
        
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Public: Submit a review
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
        if (!payload.name) return res.status(400).json({ error: 'Name is required' });
        if (!payload.message) return res.status(400).json({ error: 'Message is required' });
        
        const rating = parseInt(payload.rating);
        if (isNaN(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Valid rating between 1 and 5 is required' });
        }

        // Message length
        const msg = payload.message || '';
        if (msg.length > 3000) {
            return res.status(400).json({ error: 'Message too long' });
        }

        const { data, error } = await supabase
            .from('reviews')
            .insert({
                status: 'pending',
                name: payload.name,
                business_name: payload.business_name,
                rating: rating,
                website_url: payload.website_url,
                service_completed: payload.service_completed,
                message: msg
            })
            .select()
            .single();

        if (error) {
            console.error('Error inserting review:', error);
            return res.status(500).json({ error: 'Failed to save review' });
        }

        res.json({ success: true, message: 'Review saved successfully', reviewId: data.id });
    } catch (err) {
        console.error('Review submission error:', err);
        res.status(500).json({ error: 'Server error during submission' });
    }
});

// Protected: Get ALL reviews (including pending/hidden) for Admin
router.get('/admin/all', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('reviews')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Protected: Update review status
router.patch('/:id', async (req, res) => {
    try {
        const { status } = req.body;
        if (!['pending', 'approved', 'hidden', 'deleted'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const { data, error } = await supabase
            .from('reviews')
            .update({ status: status })
            .eq('id', req.params.id)
            .select()
            .single();
            
        if (error) throw error;
        res.json({ success: true, review: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Protected: Hard delete review
router.delete('/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('reviews').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Review deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
