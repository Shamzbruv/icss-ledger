const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const supabase = require('../src/db');

async function fixWindross() {
    console.log('Fixing invoice INV-ICSS-001...');
    
    // The user stated: total 180k, first payment 30k, second payment 40k. 
    // This means total amount_paid should be 70k.
    // The remaining balance should be 110k.

    const { error } = await supabase.from('invoices')
        .update({
            amount_paid: 70000,
            balance_due: 110000,
            remaining_amount: 110000
        })
        .eq('invoice_number', 'INV-ICSS-001');

    if (error) {
        console.error('Failed to update:', error);
    } else {
        console.log('Successfully updated INV-ICSS-001 to 70k paid, 110k remaining.');
    }
}

fixWindross();
