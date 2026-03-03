const crypto = require('crypto');
const supabase = require('./src/db');

async function seedTaxPolicies() {
    console.log("Seeding Tax Policies...");

    const policy2025 = {
        IT_THRESHOLD_JMD: 1500000,
        IT_HIGH_BAND_JMD: 6000000,
        IT_RATE_STANDARD: 0.25,
        IT_RATE_HIGH: 0.30,
        EDU_TAX_RATE_SELF: 0.0225,
        NHT_RATE_CAT1_5: 0.03,
        NHT_RATE_CAT6_7: 0.02,
        NIS_RATE_SELF_EMPLOYED: 0.03,
        NIS_WAGE_CEILING_JMD: 1500000
    };

    const policy2026 = {
        // Only threshold changes, everything else remains the same for simplicity
        ...policy2025,
        IT_THRESHOLD_JMD: 2000000
    };

    const hash2025 = crypto.createHash('sha256').update(JSON.stringify(policy2025)).digest('hex');
    const hash2026 = crypto.createHash('sha256').update(JSON.stringify(policy2026)).digest('hex');

    const policies = [
        {
            jurisdiction: 'JM',
            effective_from: '2025-01-01',
            name: 'Jamaica Income Tax & Contributions (Base 2025)',
            policy_json: policy2025,
            policy_sha256: hash2025
        },
        {
            jurisdiction: 'JM',
            effective_from: '2026-04-01', // Mid-year change for blended threshold test
            name: 'Jamaica Income Tax & Contributions (Apr 2026 Update)',
            policy_json: policy2026,
            policy_sha256: hash2026
        }
    ];

    for (const p of policies) {
        const { error } = await supabase.from('tax_policy_versions').upsert(p, { onConflict: 'jurisdiction, effective_from' });
        if (error) {
            console.error(`Error inserting ${p.name}:`, error.message);
        } else {
            console.log(`Successfully seeded ${p.name}`);
        }
    }
    console.log("Seeding complete.");
}

seedTaxPolicies();
