require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');

async function test() {
    try {
        const { data: c } = await supabase.from('companies').select('id').limit(1).single();
        const cid = c.id;

        const { data: entries } = await supabase.from('journals').select('id').eq('company_id', cid);
        const entryIds = entries.map(e => e.id);

        const { data: lines } = await supabase.from('journal_lines').select('id, account_id, debit, credit').in('journal_id', entryIds);
        console.log(`Pre-join lines: ${lines.length}`);

        let validAccounts = 0;
        let invalidAccounts = 0;
        const invalidAccIds = new Set();

        for (const l of lines) {
            const { data: acc } = await supabase.from('chart_of_accounts').select('id').eq('id', l.account_id).single();
            if (acc) {
                validAccounts++;
            } else {
                invalidAccounts++;
                invalidAccIds.add(l.account_id);
            }
        }

        console.log(`Valid Accs: ${validAccounts} | Invalid Accs: ${invalidAccounts}`);
        console.log(`Unique invalid account IDs:`, Array.from(invalidAccIds));
    } catch (err) {
        console.error('Fatal err:', err);
    }
}
test();
