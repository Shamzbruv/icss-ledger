require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function backfill() {
    console.log('Starting backfill of missing expense_records from bulk_imports...');

    // Get all posted bulk imports
    const { data: batches } = await supabase.from('bulk_imports').select('id, company_id').eq('status', 'posted');
    if (!batches || batches.length === 0) {
        console.log('No posted batches found.');
        return;
    }

    // Refresh schema cache just in case
    await supabase.rpc('postgres_query', { query: `NOTIFY pgrst, 'reload schema'` });

    const { data: coaData } = await supabase.from('chart_of_accounts').select('id, code');
    const coaMap = new Map();
    if (coaData) {
        coaData.forEach(c => coaMap.set(c.id, c.code));
    }

    let insertedCount = 0;

    for (const batch of batches) {
        console.log(`Processing batch ${batch.id}...`);

        // Get all lines for this batch
        const { data: lines } = await supabase
            .from('bulk_import_lines')
            .select('*')
            .eq('bulk_import_id', batch.id);

        if (!lines) continue;

        for (const line of lines) {
            const isMoneyOut = line.normalized_json && line.normalized_json.direction === 'money_out';
            if (!isMoneyOut) continue;

            const targetAccId = line.user_overridden ? line.user_account_id : (line.user_account_id || line.suggested_account_id);
            if (!targetAccId) continue;

            const expenseAccCode = coaMap.get(targetAccId) || '5000';
            const absoluteAmount = Math.abs(line.normalized_json.amount_signed);

            // Check if already exists (prevent duplicates)
            const { data: existing } = await supabase
                .from('expense_records')
                .select('id')
                .eq('company_id', batch.company_id)
                .eq('total_amount', absoluteAmount)
                .eq('expense_date', line.normalized_json.txn_date)
                .eq('description', line.normalized_json.description || 'Imported Expense')
                .limit(1);

            if (existing && existing.length > 0) {
                continue; // Already backfilled
            }

            const { error } = await supabase.from('expense_records').insert({
                company_id: batch.company_id,
                vendor: line.normalized_json.counterparty_name || null,
                expense_date: line.normalized_json.txn_date,
                description: line.normalized_json.description || 'Imported Expense',
                expense_type: 'cash',
                status: 'posted',
                coa_account_code: expenseAccCode,
                total_amount: absoluteAmount,
                currency: line.normalized_json.currency || 'JMD'
            });

            if (error) {
                console.error(`Failed to backfill line ${line.id}:`, error);
            } else {
                insertedCount++;
            }
        }
    }

    console.log(`Backfill complete. Inserted ${insertedCount} missing expense records.`);
}

backfill();
