require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');

async function test() {
    try {
        const { data: c } = await supabase.from('companies').select('id').limit(1).single();
        const cid = c.id;

        const { data: entries } = await supabase
            .from('journals')
            .select('id')
            .eq('company_id', cid)
            .gte('journal_date', '2026-01-01')
            .lte('journal_date', '2026-12-31')
            .eq('status', 'posted');

        const entryIds = entries.map(e => e.id);
        const { data: lines, error: lineErr } = await supabase
            .from('journal_lines')
            .select('journal_id, debit, credit, description, account_id')
            .in('journal_id', entryIds);

        console.log('lines without join:', lines?.length, 'error:', lineErr);
        if (lines?.length > 0) {
            console.log('Sample account_id:', lines[0].account_id);
            const { data: account } = await supabase.from('chart_of_accounts').select('id, code').eq('id', lines[0].account_id).single();
            console.log('Does this account exist in chart_of_accounts?', !!account, account);

            // Try different join syntax
            const { data: lines2, error: err2 } = await supabase
                .from('journal_lines')
                .select(`
                    journal_id, debit, credit, description, account_id,
                    account:account_id ( code, name, account_type )
                `)
                .in('journal_id', entryIds);
            console.log('Lines with relation "account:account_id":', lines2?.length, 'err:', err2);
        }
    } catch (err) {
        console.error('Fatal err:', err);
    }
}
test();
