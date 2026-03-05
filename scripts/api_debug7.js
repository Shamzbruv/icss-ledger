require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');
const { projectAccountingEvent } = require('../src/services/postingRulesService');

async function test() {
    try {
        const { data: events, error } = await supabase
            .from('accounting_events')
            .select('*')
            .eq('event_type', 'EXPENSE_CASH')
            .order('created_at', { ascending: false })
            .limit(2);

        if (error) throw error;
        console.log('Found events:', events.length);

        for (const ev of events) {
            console.log('Projecting:', ev.id);
            if (!ev.idempotency_key) {
                ev.idempotency_key = `test-idx-${ev.id}`;
            }
            try {
                const je = await projectAccountingEvent(ev);
                console.log('Success:', je);
            } catch (err) {
                console.error('Projection error for', ev.id, ':', err.message);
            }
        }
    } catch (err) {
        console.error('Fatal err:', err);
    }
}
test();
