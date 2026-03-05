require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const { getTrailingTwelveMonthTurnover } = require('../src/services/gctService');
const { getDashboardWidgets } = require('../src/services/reportingService');
const supabase = require('../src/db');

async function test() {
    try {
        const { data } = await supabase.from('companies').select('id').limit(1).single();
        const cid = data.id;

        const results = { widgetsError: null, gctError: null };
        try {
            await getDashboardWidgets(cid);
            results.widgetsSuccess = true;
        } catch (e) {
            results.widgetsError = e.message;
        }

        try {
            await getTrailingTwelveMonthTurnover(cid);
            results.gctSuccess = true;
        } catch (e) {
            results.gctError = e.message;
        }

        fs.writeFileSync('debug_output.json', JSON.stringify(results, null, 2));
    } catch (err) {
        fs.writeFileSync('debug_output.json', JSON.stringify({ fatal: err.message }));
    }
}
test();
