require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');
const { projectAccountingEvent } = require('../src/services/postingRulesService');

async function backfillEvents() {
    try {
        console.log('Fetching unconsumed accounting events...');
        const { data: events, error } = await supabase.from('accounting_events').select('*').in('event_type', ['EXPENSE_CASH', 'EXPENSE_BILL_CREATED']);
        if (error) throw error;

        console.log(`Found ${events.length} expense events. Projecting them...`);
        let count = 0;

        for (const ev of events) {
            try {
                // Try to project
                const res = await projectAccountingEvent(ev);
                if (res) {
                    console.log(`Successfully projected event: ${ev.id}`);
                    count++;
                }
            } catch (pe) {
                console.log(`Failed to project event ${ev.id}: ${pe.message}`);
            }
        }

        console.log(`Successfully backfilled ${count} expense events into the ledger.`);
    } catch (err) {
        console.error('Fatal backfill error:', err);
    }
}

backfillEvents();
