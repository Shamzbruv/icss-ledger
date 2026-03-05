require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');
const { getJournalLinesForPeriod } = require('../src/services/reportingService');

async function test() {
    try {
        const { data: c } = await supabase.from('companies').select('id').limit(1).single();
        const cid = c.id;
        const lines = await getJournalLinesForPeriod(cid, '2026-01-01', '2026-12-31');

        console.log('Lines found:', lines.length);
        if (lines.length > 0) {
            console.log('Sample line shape:', JSON.stringify(lines[0], null, 2));
            const acc = lines[0].chart_of_accounts;
            console.log('chart_of_accounts is array?', Array.isArray(acc));
            console.log('account code:', acc ? acc.code : 'missing');
        }
    } catch (err) {
        console.error('Fatal err:', err);
    }
}
test();
