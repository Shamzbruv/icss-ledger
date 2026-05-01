const supabase = require('./src/db');

async function check() {
    const { data: d1, error: e1 } = await supabase.from('journal_entries').select('*').limit(1);
    if (d1 && d1.length > 0) {
        console.log("journal_entries data:", d1[0]);
    } else {
        const { error: e1b } = await supabase.from('journal_entries').select('nope').limit(1);
        console.log("journal_entries err:", e1b);
    }

    const { data: d2, error: e2 } = await supabase.from('journal_entry_lines').select('*').limit(1);
    if (d2 && d2.length > 0) {
        console.log("journal_entry_lines data:", d2[0]);
    } else {
        const { error: e2b } = await supabase.from('journal_entry_lines').select('nope').limit(1);
        console.log("journal_entry_lines err:", e2b);
    }
}

check();
