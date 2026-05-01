const supabase = require('./src/db');

async function seedCoA() {
    console.log("Seeding Chart of Accounts...");
    const { data: company, error: compErr } = await supabase.from('companies').select('id').limit(1).single();
    if (compErr || !company) {
        console.error("No company found:", compErr);
        return;
    }
    const companyId = company.id;

    const defaultAccounts = [
        { code: '1000', name: 'Cash on Hand', account_type: 'asset', normal_balance: 'debit' },
        { code: '1010', name: 'Bank Account (Primary)', account_type: 'asset', normal_balance: 'debit' },
        { code: '1100', name: 'Accounts Receivable', account_type: 'asset', normal_balance: 'debit' },
        { code: '1200', name: 'Input GCT Receivable', account_type: 'asset', normal_balance: 'debit' },
        { code: '1500', name: 'Fixed Assets (Cost)', account_type: 'asset', normal_balance: 'debit' },
        { code: '1510', name: 'Accumulated Depreciation', account_type: 'asset', normal_balance: 'credit' },
        { code: '2000', name: 'Accounts Payable', account_type: 'liability', normal_balance: 'credit' },
        { code: '2010', name: 'Customer Deposits', account_type: 'liability', normal_balance: 'credit' },
        { code: '2100', name: 'Income Tax Payable', account_type: 'liability', normal_balance: 'credit' },
        { code: '2200', name: 'Output GCT Payable', account_type: 'liability', normal_balance: 'credit' },
        { code: '3000', name: 'Owner Capital', account_type: 'equity', normal_balance: 'credit' },
        { code: '4000', name: 'Service Revenue', account_type: 'income', normal_balance: 'credit' },
        { code: '5000', name: 'General Expense', account_type: 'expense', normal_balance: 'debit' },
        { code: '5120', name: 'Book Depreciation', account_type: 'expense', normal_balance: 'debit' }
    ];

    for (const acc of defaultAccounts) {
        const { error } = await supabase.from('chart_of_accounts').upsert({
            company_id: companyId,
            code: acc.code,
            name: acc.name,
            account_type: acc.account_type,
            normal_balance: acc.normal_balance
        }, { onConflict: 'company_id, code' });

        if (error) {
            console.error(`Error inserting ${acc.code}:`, error.message);
        }
    }
    console.log("Seeding complete.");
}

seedCoA();
