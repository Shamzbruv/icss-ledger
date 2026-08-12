const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const supabase = require('../src/db');

async function fixBalances() {
    console.log('Fetching all invoices...');
    const { data: invoices, error } = await supabase.from('invoices').select('id, total_amount, amount_paid, remaining_amount, balance_due');
    if (error) {
        console.error('Error fetching invoices:', error);
        return;
    }

    console.log(`Found ${invoices.length} invoices. Checking for discrepancies...`);
    let fixedCount = 0;

    for (const inv of invoices) {
        const expectedBalance = inv.total_amount - (inv.amount_paid || 0);
        let needsUpdate = false;
        let updateData = {};

        if (inv.balance_due !== expectedBalance) {
            updateData.balance_due = expectedBalance;
            needsUpdate = true;
        }
        if (inv.remaining_amount !== expectedBalance) {
            updateData.remaining_amount = expectedBalance;
            needsUpdate = true;
        }

        if (needsUpdate) {
            const { error: updateErr } = await supabase.from('invoices').update(updateData).eq('id', inv.id);
            if (updateErr) {
                console.error(`Failed to update invoice ${inv.id}:`, updateErr);
            } else {
                console.log(`Fixed invoice ${inv.id}. Set balances to ${expectedBalance}.`);
                fixedCount++;
            }
        }
    }

    console.log(`Finished. Fixed ${fixedCount} invoices.`);
}

fixBalances();
