const supabase = require('../src/db');

async function seedCoA() {
    const companyId = '123b8bee-baab-4763-a152-680cb80981e8';

    // Schema: chart_of_accounts 
    const accounts = [
        // Assets
        { company_id: companyId, code: '1000', name: 'Cash and Cash Equivalents', account_type: 'asset', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '1200', name: 'Accounts Receivable', account_type: 'asset', normal_balance: 'debit', is_active: true },
        // Liabilities
        { company_id: companyId, code: '2000', name: 'Accounts Payable', account_type: 'liability', normal_balance: 'credit', is_active: true },
        { company_id: companyId, code: '2200', name: 'Sales Tax (GCT) Payable', account_type: 'liability', normal_balance: 'credit', is_active: true },
        // Equity
        { company_id: companyId, code: '3000', name: 'Owner Equity', account_type: 'equity', normal_balance: 'credit', is_active: true },
        // Revenue
        { company_id: companyId, code: '4000', name: 'Service Revenue', account_type: 'revenue', normal_balance: 'credit', is_active: true },
        { company_id: companyId, code: '4100', name: 'Product Sales', account_type: 'revenue', normal_balance: 'credit', is_active: true },
        // Expenses
        { company_id: companyId, code: '5000', name: 'Advertising and Marketing', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5050', name: 'Bank Fees and Charges', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5100', name: 'Contractors & Freelancers', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5150', name: 'Insurance', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5200', name: 'Legal and Professional Fees', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5250', name: 'Meals and Entertainment', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5300', name: 'Office Supplies & Expenses', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5350', name: 'Rent and Lease', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5400', name: 'Repairs and Maintenance', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5450', name: 'Software and Subscriptions', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5500', name: 'Taxes and Licenses', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5550', name: 'Travel', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5600', name: 'Utilities (Electricity, Water, Internet)', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5650', name: 'Wages and Salaries', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5700', name: 'Miscellaneous Expenses', account_type: 'expense', normal_balance: 'debit', is_active: true },
        { company_id: companyId, code: '5800', name: 'Depreciation Expense', account_type: 'expense', normal_balance: 'debit', is_active: true }
    ];

    console.log(`Seeding ${accounts.length} Chart of Accounts entries...`);

    // Perform an upsert based on company_id and code
    const { data, error } = await supabase
        .from('chart_of_accounts')
        .upsert(accounts, { onConflict: 'company_id, code' })
        .select();

    if (error) {
        console.error('Error seeding CoA:', JSON.stringify(error, null, 2));
    } else {
        console.log(`Successfully seeded! Inserted/Updated ${data ? data.length : 0} records.`);
    }
}

seedCoA();
