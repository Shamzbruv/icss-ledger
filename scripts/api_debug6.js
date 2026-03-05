require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const supabase = require('../src/db');

async function test() {
    try {
        const { data } = await supabase.from('journals').select('id, journal_date, source_type').limit(10);
        fs.writeFileSync('debug_journals.json', JSON.stringify(data, null, 2));
    } catch (err) {
        fs.writeFileSync('debug_journals.json', JSON.stringify({ error: err.message }));
    }
}
test();
