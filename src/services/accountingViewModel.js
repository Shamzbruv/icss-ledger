// Shared, deterministic helpers for report filters and journal validation.
function monthBounds(value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')) throw new Error('Choose a valid month.');
    const [year, month] = value.split('-').map(Number);
    return { start: `${value}-01`, end: `${value}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` };
}
function validateJournalLines(lines, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(new Date(date).getTime()) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Supply a valid journal date.');
    if (!Array.isArray(lines) || lines.length < 2) throw new Error('A journal needs at least two lines.');
    let debit = 0, credit = 0;
    for (const line of lines) {
        const dr = Number(line.debitAmount || 0), cr = Number(line.creditAmount || 0);
        if (!Number.isFinite(dr) || !Number.isFinite(cr) || dr < 0 || cr < 0 || (dr > 0 && cr > 0) || (!dr && !cr) || !line.accountCode) throw new Error('Each journal line needs an account and one positive debit or credit.');
        debit += Math.round(dr*100); credit += Math.round(cr*100);
    }
    if (debit !== credit) throw new Error('Journal debits and credits must balance.');
}
module.exports = { monthBounds, validateJournalLines };
