// The accounting ledger uses journals + journal_lines. The retired journal_entries
// table is not part of the deployed schema. Line amounts are stored in base JMD.
async function loadRecentJournalActivity(db) {
    const { data, error } = await db.from('journals')
        .select('id, journal_series, narration, journal_date, journal_lines(debit)')
        .eq('status', 'posted')
        .order('journal_date', { ascending: false })
        .limit(5)
        .abortSignal(AbortSignal.timeout(6000));
    if (error) throw new Error(`Could not load recent accounting activity: ${error.message}`);
    return (data || []).map(journal => ({
        type: 'accounting', id: journal.id,
        title: `Journal ${journal.journal_series || 'Entry'}`,
        description: journal.narration || 'Accounting Entry',
        amount: Math.round((journal.journal_lines || []).reduce((sum, line) => sum + Number(line.debit || 0), 0) * 100) / 100,
        currency: 'JMD', status: 'POSTED', date: journal.journal_date
    }));
}
module.exports = { loadRecentJournalActivity };
