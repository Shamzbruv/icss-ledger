require('dotenv').config({ path: '../.env' });
const { getDashboardWidgets } = require('../src/services/reportingService');
const supabase = require('../src/db');

async function test() {
    try {
        const { data } = await supabase.from('companies').select('id').limit(1).single();
        const cid = data.id;
        const widgets = await getDashboardWidgets(cid);
        console.log(JSON.stringify(widgets, null, 2));
    } catch (err) {
        console.error('Fatal:', err.message);
    }
}
test();
