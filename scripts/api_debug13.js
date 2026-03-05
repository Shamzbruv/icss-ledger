require('dotenv').config({ path: '../.env' });
const supabase = require('../src/db');

async function debugFlow() {
    try {
        console.log('--- 1. Find a 2026 Expense ---');
        const { data: expenses } = await supabase.from('expense_records').select('*').gte('expense_date', '2026-01-01').order('created_at', { ascending: false }).limit(1);
        if (!expenses || expenses.length === 0) {
            console.log('No 2026 expenses found!');
            return;
        }
        const exp = expenses[0];
        console.log(`Found Expense: ${exp.id} | Date: ${exp.expense_date} | Desc: ${exp.description}`);

        console.log('\n--- 2. Find Accounting Event ---');
        const { data: events } = await supabase.from('accounting_events').select('*').eq('source_id', exp.id);
        if (!events || events.length === 0) {
            console.log('No accounting events found for this expense!');
            return;
        }
        for (const ev of events) {
            console.log(`Event ID: ${ev.id} | Type: ${ev.event_type} | Version: ${ev.event_version}`);

            console.log('\n--- 3. Find Consumed Event ---');
            const { data: consume } = await supabase.from('consumed_events').select('*').eq('event_id', ev.id);
            console.log('Consumed?', consume && consume.length > 0 ? consume[0].idempotency_key : 'No');

            console.log('\n--- 4. Find Journal ---');
            const { data: journals } = await supabase.from('journals').select('id, journal_date, period_yyyymm, status, source_type, idempotency_key').eq('source_id', ev.source_id);
            if (!journals || journals.length === 0) {
                console.log('No journal created for source_id:', ev.source_id);

                // Try finding by idempotency
                const { data: j2 } = await supabase.from('journals').select('id, journal_date').eq('idempotency_key', ev.id);
                console.log('Found by idempotency?', j2 && j2.length > 0 ? j2[0].id : 'No');
            } else {
                for (const j of journals) {
                    console.log(`Journal ID: ${j.id} | Date: ${j.journal_date} | Status: ${j.status}`);
                    console.log('\n--- 5. Find Journal Lines ---');
                    const { data: lines } = await supabase.from('journal_lines').select('id, account_id, debit, credit').eq('journal_id', j.id);
                    console.log(`Found ${lines?.length || 0} lines`);
                    for (const l of lines || []) {
                        console.log(`  Line: ${l.id} | Acc: ${l.account_id} | Dr: ${l.debit} | Cr: ${l.credit}`);
                    }
                }
            }
        }

    } catch (err) {
        console.error('Fatal err:', err);
    }
}
debugFlow();
