require('dotenv').config({ path: '../.env' });
const { getTrailingTwelveMonthTurnover } = require('../src/services/gctService');
const { getDashboardWidgets } = require('../src/services/reportingService');
const supabase = require('../src/db');

async function test() {
    try {
        const { data } = await supabase.from('companies').select('id').limit(1).single();
        const cid = data.id;
        console.log('Company ID:', cid);

        console.log('\n--- Testing Dashboard Widgets ---');
        try {
            const widgets = await getDashboardWidgets(cid);
            console.log('Widgets success!');
        } catch (e) {
            console.error('Widgets Error:', e.message);
        }

        console.log('\n--- Testing GCT Turnover ---');
        try {
            const tz = await getTrailingTwelveMonthTurnover(cid);
            console.log('GCT success!');
        } catch (e) {
            console.error('GCT Error:', e.message);
        }
    } catch (err) {
        console.error('Fatal:', err);
    }
}
test();
