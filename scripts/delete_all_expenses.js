require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');

async function deleteAllExpenses() {
    try {
        console.log('Fetching expenses...');
        const { data: expenses } = await supabase.from('expense_records').select('id');
        const expenseIds = (expenses || []).map(e => e.id);
        console.log(`Found ${expenseIds.length} expenses to delete.`);

        if (expenseIds.length > 0) {
            // Delete journals
            console.log('Deleting expense journals...');
            const { error: jErr } = await supabase.from('journals').delete().eq('source_type', 'EXPENSE');
            if (jErr) console.error('Error deleting journals:', jErr);

            // Delete accounting events
            console.log('Deleting accounting events...');
            const { error: evErr } = await supabase.from('accounting_events').delete().eq('source_type', 'EXPENSE');
            if (evErr) console.error('Error deleting events:', evErr);

            // Delete expense records
            console.log('Deleting actual expense records...');
            const { error: expErr } = await supabase.from('expense_records').delete().in('id', expenseIds);
            if (expErr) console.error('Error deleting expense records:', expErr);

            console.log('Cleanup complete!');
        } else {
            console.log('No expenses to delete.');
        }

    } catch (err) {
        console.error('Fatal err:', err);
    }
}
deleteAllExpenses();
