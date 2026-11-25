const express = require('express');

// Guest entries for the "Big Reveal Hunt" game (main website file/reveal-hunt).
// Public: POST (save progress) and GET (anonymous totals only).
// Protected by checkAuth in server.js: everything under /admin.
const TABLE = 'reveal_hunt_entries';
const POLL_KEYS = ['q1', 'q2', 'q3', 'q4'];
const POLL_VALUES = ['halona', 'shamar'];
const MAX_TICKETS = 5;
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanName(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40);
}

// Turns a request body into a safe partial row. Only known fields are kept.
function sanitizeEntry(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
    const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
    if (!SESSION_RE.test(sessionId)) return { error: 'Invalid session' };
    const entry = { session_id: sessionId };
    if (body.name !== undefined) entry.guest_name = cleanName(body.name) || null;
    if (body.team !== undefined) {
        if (body.team !== 'pink' && body.team !== 'blue') return { error: 'Invalid team' };
        entry.team = body.team;
    }
    if (body.picks !== undefined) {
        const picks = {};
        if (body.picks && typeof body.picks === 'object') {
            POLL_KEYS.forEach(key => {
                if (POLL_VALUES.includes(body.picks[key])) picks[key] = body.picks[key];
            });
        }
        entry.picks = picks;
    }
    if (body.tickets_won !== undefined) {
        const n = Number(body.tickets_won);
        if (!Number.isInteger(n) || n < 0 || n > MAX_TICKETS) return { error: 'Invalid ticket count' };
        entry.tickets_won = n;
    }
    if (body.finished !== undefined) entry.finished = body.finished === true;
    return { entry };
}

// Anonymous totals shown to guests: no names, no individual rows.
function aggregate(rows) {
    const out = {
        total: rows.length,
        finished: rows.filter(r => r.finished).length,
        teams: { pink: 0, blue: 0 },
        polls: {}
    };
    POLL_KEYS.forEach(key => { out.polls[key] = { halona: 0, shamar: 0 }; });
    rows.forEach(row => {
        if (row.team === 'pink' || row.team === 'blue') out.teams[row.team]++;
        POLL_KEYS.forEach(key => {
            const pick = row.picks && row.picks[key];
            if (POLL_VALUES.includes(pick)) out.polls[key][pick]++;
        });
    });
    return out;
}

// Small in-memory limiter. Guests at one party often share an IP, so the cap is generous.
function createLimiter({ windowMs = 10 * 60 * 1000, max = 600 } = {}) {
    const hits = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || 'unknown';
        let hit = hits.get(key);
        if (!hit || now - hit.start > windowMs) {
            hit = { start: now, count: 0 };
            hits.set(key, hit);
        }
        hit.count++;
        if (hits.size > 5000) {
            for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
        }
        if (hit.count > max) return res.status(429).json({ error: 'Too many requests' });
        next();
    };
}

function isMissingTable(error) {
    const text = `${error && error.code} ${error && error.message}`;
    return /42P01|PGRST205|does not exist|schema cache/i.test(text);
}

function createRevealHuntRouter(supabase) {
    const router = express.Router();
    const limiter = createLimiter();

    function fail(res, error, label) {
        if (isMissingTable(error)) {
            return res.status(503).json({ error: 'Guest book is not set up yet. Run schema_reveal_hunt.sql in Supabase.' });
        }
        console.error(`[REVEAL-HUNT] ${label}:`, error && error.message);
        return res.status(500).json({ error: 'Server error' });
    }

    // Public: save or update one guest's progress.
    router.post('/', limiter, async (req, res) => {
        const { entry, error: badInput } = sanitizeEntry(req.body);
        if (badInput) return res.status(400).json({ error: badInput });
        try {
            const { error } = await supabase
                .from(TABLE)
                .upsert({ ...entry, updated_at: new Date().toISOString() }, { onConflict: 'session_id' });
            if (error) return fail(res, error, 'save');
            res.json({ success: true });
        } catch (err) {
            fail(res, err, 'save');
        }
    });

    // Public: anonymous totals (team split and "who's more likely" results).
    router.get('/', limiter, async (req, res) => {
        try {
            const { data, error } = await supabase.from(TABLE).select('team, picks, finished').limit(5000);
            if (error) return fail(res, error, 'totals');
            res.set('Cache-Control', 'no-store');
            res.json(aggregate(data || []));
        } catch (err) {
            fail(res, err, 'totals');
        }
    });

    // Protected: every entry, newest first.
    router.get('/admin/entries', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from(TABLE)
                .select('*')
                .order('created_at', { ascending: false })
                .limit(2000);
            if (error) return fail(res, error, 'list');
            res.json(data || []);
        } catch (err) {
            fail(res, err, 'list');
        }
    });

    // Protected: delete one entry.
    router.delete('/admin/entries/:id', async (req, res) => {
        if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        try {
            const { error } = await supabase.from(TABLE).delete().eq('id', req.params.id);
            if (error) return fail(res, error, 'delete');
            res.json({ success: true });
        } catch (err) {
            fail(res, err, 'delete');
        }
    });

    // Protected: delete every entry. Needs ?confirm=all so it cannot happen by accident.
    router.delete('/admin/entries', async (req, res) => {
        if (req.query.confirm !== 'all') return res.status(400).json({ error: 'Add ?confirm=all to delete every entry' });
        try {
            const { error } = await supabase.from(TABLE).delete().not('id', 'is', null);
            if (error) return fail(res, error, 'delete-all');
            res.json({ success: true });
        } catch (err) {
            fail(res, err, 'delete-all');
        }
    });

    return router;
}

module.exports = createRevealHuntRouter;
module.exports.sanitizeEntry = sanitizeEntry;
module.exports.aggregate = aggregate;
module.exports.createLimiter = createLimiter;
