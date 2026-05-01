const { computeSoleTraderContributions, getTaxPolicy } = require('./src/services/taxEngineService');
const fs = require('fs');

let out = "";
function log(msg) {
    console.log(msg);
    out += msg + "\n";
}

async function testTaxEngine() {
    try {
        log("--- Testing Tax Policy Engine (Jamaica) ---");

        const itRate2025 = await getTaxPolicy('JM', 'IT_RATE_STANDARD', '2025-01-01');
        log(`2025 Standard IT Rate: ${itRate2025}`);

        log("\n--- Sole Trader Contributions (2025) ---");
        const res2025 = await computeSoleTraderContributions(
            10000000, // 10M Gross
            2000000,  // 2M Deductions (8M Statutory)
            2025,
            { nht_category: 'cat1_5' }
        );
        log(`Tax-Free Threshold 2025: ${res2025.income.taxFreeThreshold}`);
        log(`Chargeable Income: ${res2025.income.chargeableIncome}`);
        log(`Income Tax: ${res2025.contributions.incomeTax.amount}`);
        log(`Total: ${res2025.contributions.totalContributions}`);
        log(`Note: ${res2025.crossReferences.thresholdNotes}`);

        log("\n--- Sole Trader Contributions (2026) ---");
        const res2026 = await computeSoleTraderContributions(
            10000000,
            2000000,
            2026,
            { nht_category: 'cat1_5' }
        );
        log(`Tax-Free Threshold 2026: ${res2026.income.taxFreeThreshold}`);
        log(`Note: ${res2026.crossReferences.thresholdNotes}`);

        log("\n✅ Tax Engine Policy Tests completed.");
        fs.writeFileSync('test_results_tax.txt', out, 'utf8');
    } catch (err) {
        log("Test Failed: " + err.message);
        fs.writeFileSync('test_results_tax.txt', out, 'utf8');
    }
}

testTaxEngine();
