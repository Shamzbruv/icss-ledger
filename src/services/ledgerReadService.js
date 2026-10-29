const supabase = require('../db');
// Supabase's default row cap must never silently truncate financial totals.
async function readAll(query, pageSize = 500) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await query().range(offset, offset + pageSize - 1);
        if (error) throw new Error(`Ledger data could not be read: ${error.message}`);
        rows.push(...(data || []));
        if (!data || data.length < pageSize) return rows;
    }
}
async function readLedgerLines(companyId, start, end) {
    const rows = await readAll(() => supabase.from('journal_lines')
        .select('id,journal_id,debit,credit,description,account_id,chart_of_accounts!account_id(code,name,account_type,normal_balance),journals!inner(id,company_id,journal_date,source_type,status)')
        .eq('journals.company_id', companyId)
        .gte('journals.journal_date', start)
        .lte('journals.journal_date', end)
        .in('journals.status', ['posted','reversed'])
        .order('id'));
    return rows.map(line => ({ ...line, entry: line.journals }));
}
module.exports = { readAll, readLedgerLines };
