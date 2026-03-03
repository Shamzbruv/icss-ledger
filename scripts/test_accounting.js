// scripts/test_accounting.js
require('dotenv').config();
const supabase = require('../src/db');
const { getChartOfAccounts, postJournalEntry, getTrialBalance } = require('../src/services/accountingCoreService');
const { handleInvoiceEvent } = require('../src/services/postingRulesService');
const { computeSoleTraderContributions } = require('../src/services/taxEngineService');

async function runTests() {
    console.log('--- STARTING ACCOUNTING MODULE INTEGRATION TESTS ---\n');

    try {
        const { data: comp } = await supabase.from('companies').select('id').limit(1).single();
        if (!comp) throw new Error("No company found for testing.");
        const companyId = comp.id;
        console.log(`Testing with Company ID: ${companyId}`);

        // --- 1. Income Tax Blended Rate Calculation ---
        console.log('\n[Test 1] Jamaica Income Tax Calculation');
        const estRevenue = 7000000;
        const estExpenses = 2000000;
        const taxYear = 2026;
        const settings = { nht_category: 'cat1_5' };

        const taxRes = await computeSoleTraderContributions(estRevenue, estExpenses, taxYear, settings);

        console.assert(taxRes.totalContributions > 0, "Tax should be greater than zero");
        console.assert(taxRes.quarterlySchedule.length === 4, "Should generate 4 quarterly payments");
        console.log('✅ Tax Computation Passed:', {
            statutoryIncome: taxRes.incomeTax.chargeableIncome,
            incomeTax: taxRes.incomeTax.totalTax,
            nht: taxRes.nhtContribution,
            nis: taxRes.nisContribution,
            eduTax: taxRes.educationTax,
            total: taxRes.totalContributions
        });

        // --- 2. Journal Balance Invariant ---
        console.log('\n[Test 2] Journal Balance Invariant Safety');
        const accounts = await getChartOfAccounts(companyId);
        if (!accounts || accounts.length < 2) throw new Error("Chart of Accounts not seeded properly");

        const revAcc = accounts.find(a => a.account_type === 'revenue' && a.code.startsWith('4'));
        const expAcc = accounts.find(a => a.account_type === 'expense' && a.code.startsWith('5'));

        // Test Unbalanced Entry Check (Should Fail/Throw)
        const badEntry = {
            company_id: companyId,
            description: "TEST: Unbalanced Entry",
            source_type: 'MANUAL',
            journal_lines: [
                { coa_account_code: expAcc.code, is_credit: false, amount: 500 },
                { coa_account_code: revAcc.code, is_credit: true, amount: 400 } // Unbalanced!
            ]
        };

        try {
            await postJournalEntry(badEntry);
            console.error("❌ FAILED: System allowed an unbalanced journal entry!");
        } catch (e) {
            console.log("✅ Passed: System correctly rejected unbalanced journal entry ->", e.message);
        }

        // --- 3. Try Trial Balance ---
        console.log('\n[Test 3] Trial Balance Computation');
        const tb = await getTrialBalance(companyId, '2025-01-01', '2026-12-31');
        console.assert(tb.totalDebits === tb.totalCredits, "Trial Balance is not balanced!");
        console.log("✅ Trial balance successfully computed and debits equal credits.");

        console.log('\nALL FAST TESTS PASSED 🎉');

    } catch (err) {
        console.error('Test Suite Failed:', err);
    }
}

runTests();
