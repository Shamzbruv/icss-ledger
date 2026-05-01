require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');
const { emitAccountingEvent, projectAccountingEvent } = require('../src/services/postingRulesService');

async function backfillExpenses() {
    try {
        console.log('Fetching all expenses...');
        const { data: expenses, error } = await supabase.from('expense_records').select('*');
        if (error) throw error;

        console.log(`Found ${expenses.length} expenses. Checking for missing events...`);
        let count = 0;

        for (const exp of expenses) {
            // Check if event exists
            const { data: events } = await supabase.from('accounting_events').select('id').eq('source_id', exp.id);
            if (!events || events.length === 0) {
                console.log(`Backfilling expense ${exp.id} - ${exp.description}`);

                try {
                    const event = await emitAccountingEvent({
                        companyId: exp.company_id,
                        sourceId: exp.id,
                        sourceType: 'EXPENSE',
                        eventType: exp.expense_type === 'bill' ? 'EXPENSE_BILL_CREATED' : 'EXPENSE_CASH',
                        eventVersion: 1,
                        payload: exp
                    });

                    await projectAccountingEvent(event);
                    count++;
                } catch (pe) {
                    console.log(`Failed to project expense ${exp.id}: ${pe.message}`);
                }
            }
        }

        console.log(`Successfully backfilled ${count} expenses into the ledger.`);
    } catch (err) {
        console.error('Fatal backfill error:', err);
    }
}

backfillExpenses();
