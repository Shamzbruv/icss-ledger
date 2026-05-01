const supabase = require('./src/db');
async function run() {
    const { data } = await supabase.from('journals').select('id, journal_date, source_type, source_id, source_event_version, status, reversal_of_journal_id, reversed_by_journal_id').order('created_at', { ascending: false }).limit(5);
    console.log(JSON.stringify(data, null, 2));
}
run();
