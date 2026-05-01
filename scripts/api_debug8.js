require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');
const { getProfitAndLoss } = require('../src/services/reportingService');

async function test() {
    try {
        const { data } = await supabase.from('companies').select('id').limit(1).single();
        const cid = data.id;
        const pnl = await getProfitAndLoss(cid, '2026-01-01', '2026-12-31');
        console.log('Operating Expenses:', JSON.stringify(pnl.expenses.operating, null, 2));
    } catch (err) {
        console.error('Fatal err:', err);
    }
}
test();
