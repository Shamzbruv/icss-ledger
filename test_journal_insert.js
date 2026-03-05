const supabase = require('./src/db');

async function run() {
    const { data, error } = await supabase.from('journals').insert({
        company_id: '123b88ea-d438-4e8c-8f24-0c2bbd3ef710',
        journal_date: '2026-03-04',
        description: 'test manual',
        source_type: 'MANUAL',
        status: 'posted',
        total_amount: 10
    }).select();

    console.log("DATA:", data);
    console.log("ERROR:", error ? JSON.stringify(error, null, 2) : "None");
}

run();
