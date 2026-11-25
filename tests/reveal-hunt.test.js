const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createRevealHuntRouter = require('../src/routes/revealHunt');
const { sanitizeEntry, aggregate } = createRevealHuntRouter;

test('sanitizeEntry keeps only known, valid fields', () => {
    const { entry } = sanitizeEntry({
        session_id: 'abcd1234-efgh',
        name: '  <b>Aunty Jo</b>\n ',
        team: 'pink',
        picks: { q1: 'halona', q2: 'nobody', q9: 'shamar' },
        tickets_won: 3,
        finished: true,
        role: 'admin'
    });
    assert.deepEqual(entry, {
        session_id: 'abcd1234-efgh',
        guest_name: 'bAunty Jo/b',
        team: 'pink',
        picks: { q1: 'halona' },
        tickets_won: 3,
        finished: true
    });
});

test('sanitizeEntry rejects bad sessions, teams and ticket counts', () => {
    assert.ok(sanitizeEntry({}).error);
    assert.ok(sanitizeEntry({ session_id: 'short' }).error);
    assert.ok(sanitizeEntry({ session_id: 'abcd1234', team: 'green' }).error);
    assert.ok(sanitizeEntry({ session_id: 'abcd1234', tickets_won: 6 }).error);
    assert.ok(sanitizeEntry({ session_id: 'abcd1234', tickets_won: 1.5 }).error);
    assert.ok(sanitizeEntry(null).error);
});

test('sanitizeEntry trims names to 40 characters', () => {
    const { entry } = sanitizeEntry({ session_id: 'abcd1234', name: 'x'.repeat(100) });
    assert.equal(entry.guest_name.length, 40);
});

test('aggregate counts teams and poll answers without exposing rows', () => {
    const out = aggregate([
        { team: 'pink', picks: { q1: 'halona', q2: 'shamar' }, finished: true },
        { team: 'blue', picks: { q1: 'halona' }, finished: false },
        { team: null, picks: {}, finished: false }
    ]);
    assert.equal(out.total, 3);
    assert.equal(out.finished, 1);
    assert.deepEqual(out.teams, { pink: 1, blue: 1 });
    assert.deepEqual(out.polls.q1, { halona: 2, shamar: 0 });
    assert.deepEqual(out.polls.q2, { halona: 0, shamar: 1 });
});

function fakeDb() {
    const rows = [];
    return {
        rows,
        from() {
            let action = 'select';
            let payload;
            let filterId;
            const q = {
                select() { return q; },
                upsert(v) { action = 'upsert'; payload = v; return q; },
                delete() { action = 'delete'; return q; },
                eq(k, v) { filterId = v; return q; },
                not() { return q; },
                order() { return q; },
                limit() { return q; },
                then(resolve, reject) {
                    return Promise.resolve().then(() => {
                        if (action === 'upsert') {
                            const i = rows.findIndex(r => r.session_id === payload.session_id);
                            if (i >= 0) Object.assign(rows[i], payload); else rows.push({ id: String(rows.length + 1), ...payload });
                            return { data: null, error: null };
                        }
                        if (action === 'delete') {
                            if (filterId) { const i = rows.findIndex(r => r.id === filterId); if (i >= 0) rows.splice(i, 1); } else rows.length = 0;
                            return { data: null, error: null };
                        }
                        return { data: rows.slice(), error: null };
                    }).then(resolve, reject);
                }
            };
            return q;
        }
    };
}

async function withServer(db, fn) {
    const app = express();
    app.use(express.json());
    app.use('/api/reveal-hunt', createRevealHuntRouter(db));
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    try { await fn(`http://127.0.0.1:${server.address().port}/api/reveal-hunt`); }
    finally { server.close(); }
}

test('POST saves and updates one entry per session; GET returns totals only', async () => {
    const db = fakeDb();
    await withServer(db, async base => {
        const post = body => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal((await post({ session_id: 'session-0001', name: 'Mo', team: 'blue' })).status, 200);
        assert.equal((await post({ session_id: 'session-0001', tickets_won: 2, picks: { q1: 'shamar' } })).status, 200);
        assert.equal((await post({ session_id: 'bad id!' })).status, 400);
        assert.equal(db.rows.length, 1);
        assert.equal(db.rows[0].guest_name, 'Mo');
        assert.equal(db.rows[0].tickets_won, 2);

        const totals = await (await fetch(base)).json();
        assert.equal(totals.total, 1);
        assert.equal(totals.polls.q1.shamar, 1);
        assert.equal(JSON.stringify(totals).includes('Mo'), false);
    });
});

test('admin delete-all needs explicit confirmation', async () => {
    const db = fakeDb();
    db.rows.push({ id: '1', session_id: 'session-0001' });
    await withServer(db, async base => {
        assert.equal((await fetch(`${base}/admin/entries`, { method: 'DELETE' })).status, 400);
        assert.equal(db.rows.length, 1);
        assert.equal((await fetch(`${base}/admin/entries?confirm=all`, { method: 'DELETE' })).status, 200);
        assert.equal(db.rows.length, 0);
    });
});
