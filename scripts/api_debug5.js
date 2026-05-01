require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const { getDashboardWidgets } = require('../src/services/reportingService');
const supabase = require('../src/db');

async function test() {
    try {
        const { data } = await supabase.from('companies').select('id').limit(1).single();
        const cid = data.id;

        const widgets = await getDashboardWidgets(cid);
        fs.writeFileSync('debug_widgets.json', JSON.stringify(widgets, null, 2));
    } catch (err) {
        fs.writeFileSync('debug_widgets.json', JSON.stringify({ error: err.message }));
    }
}
test();
