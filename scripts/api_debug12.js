require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');

async function test() {
    try {
        const { data: c } = await supabase.from('companies').select('id').limit(1).single();
        const cid = c.id;

        const { data: j } = await supabase.from('journals').select('id').eq('company_id', cid).limit(1).single();
        const jid = j.id;

        const { data: acc } = await supabase.from('chart_of_accounts').select('id').eq('company_id', cid).limit(1).single();
        const acc_id = acc.id;

        console.log('Inserting test line for journal:', jid, 'account:', acc_id);

        const lineInserts = [{
            journal_id: jid,
            line_no: 999,
            account_id: acc_id,
            description: 'Test manual insert',
            debit: 100,
            credit: 0
        }];

        const { data: inserted, error: insertError } = await supabase
            .from('journal_lines')
            .insert(lineInserts)
            .select();

        console.log('Insert Result:', inserted);
        console.log('Insert Error:', insertError);

    } catch (err) {
        console.error('Fatal err:', err);
    }
}
test();
