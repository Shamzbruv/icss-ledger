require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');

async function test() {
    try {
        const { data: c } = await supabase.from('companies').select('id').limit(1).single();
        const cid = c.id;

        const { data: entries, error: jeErr } = await supabase
            .from('journals')
            .select('id, journal_date, source_type, status')
            .eq('company_id', cid)
            .gte('journal_date', '2026-01-01')
            .lte('journal_date', '2026-12-31')
            .eq('status', 'posted');

        console.log('entries:', entries?.length, 'error:', jeErr);
        if (!entries || entries.length === 0) return;

        const entryIds = entries.map(e => e.id);
        const { data: lines, error: lineErr } = await supabase
            .from('journal_lines')
            .select(`
                journal_id, debit, credit, description, account_id,
                chart_of_accounts!inner(code, name, account_type, normal_balance)
            `)
            .in('journal_id', entryIds);

        console.log('lines:', lines?.length, 'error:', lineErr);
    } catch (err) {
        console.error('Fatal err:', err);
    }
}
test();
