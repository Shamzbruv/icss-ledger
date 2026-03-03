const supabase = require('../src/db');
const fs = require('fs');

async function run() {
    let output = '';
    // Query columns from chart_of_accounts
    let res = await supabase.from('chart_of_accounts').select('*').limit(1);
    output += "chart_of_accounts columns:\n" + Object.keys(res.data && res.data[0] ? res.data[0] : {}).join(', ') + "\n\n";

    // Query tables containing 'expense'
    res = await supabase.rpc('get_tables_by_name', { name: 'expense' }); // supabase RPC might not exist, let's just use query if we had pg, but we don't.
    // Since we only have supabase client without direct SQL access, we'll try to guess the expense table.
    // Try 'expenses' table
    res = await supabase.from('expenses').select('*').limit(1);
    if (!res.error) {
        output += "Table 'expenses' exists. Columns:\n" + Object.keys(res.data && res.data[0] ? res.data[0] : {}).join(', ');
    } else {
        output += "Table 'expenses' error: " + JSON.stringify(res.error) + "\n";
    }

    fs.writeFileSync('schema_probe.log', output);
}

run();
