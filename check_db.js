const supabase = require('./src/db');

async function check() {
    const t1 = await supabase.from('journal_entries').select('id').limit(1);
    console.log("journal_entries:", t1.error ? t1.error.message : "Exists!");

    const t2 = await supabase.from('journals').select('id').limit(1);
    console.log("journals:", t2.error ? t2.error.message : "Exists!");

    const t3 = await supabase.from('journal_lines').select('id').limit(1);
    console.log("journal_lines:", t3.error ? t3.error.message : "Exists!");

    const t4 = await supabase.from('journal_entry_lines').select('id').limit(1);
    console.log("journal_entry_lines:", t4.error ? t4.error.message : "Exists!");
}

check();
