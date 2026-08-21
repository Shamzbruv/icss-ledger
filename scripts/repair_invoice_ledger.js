require('dotenv').config();
const supabase = require('../src/db');
const { inspectInvoiceLedger, repairInvoiceLedger } = require('../src/services/invoiceLedgerIntegrityService');

async function main() {
    const { data: company, error } = await supabase.from('companies').select('id, name').limit(1).single();
    if (error || !company) throw error || new Error('No company is configured');
    const apply = process.argv.includes('--apply');
    const result = apply ? await repairInvoiceLedger(company.id) : await inspectInvoiceLedger(company.id);
    console.log(JSON.stringify({ company: company.name, mode: apply ? 'repair' : 'audit', ...result }, null, 2));
    if (!apply && result.issueCount > 0) process.exitCode = 2;
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
