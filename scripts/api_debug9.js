require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');
const { getJournalLinesForPeriod } = require('../src/services/reportingService');

async function test() {
    try {
        const { data } = await supabase.from('companies').select('id').limit(1).single();
        const cid = data.id;
        const lines = await getJournalLinesForPeriod(cid, '2026-01-01', '2026-12-31');
        console.log('Total Lines Found:', lines.length);
        if (lines.length > 0) {
            console.log('Sample Line:', JSON.stringify(lines[1], null, 2));
        }

        const expenseLines = lines.filter(l => l.chart_of_accounts?.account_type === 'expense');
        console.log('Expense Lines Found:', expenseLines.length);

    } catch (err) {
        console.error('Fatal err:', err);
    }
}
test();
