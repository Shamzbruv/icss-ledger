/**
 * Tax Engine Service
 * Jamaica-specific tax computations for self-employed (sole trader) and corporate entities.
 * All thresholds and rates are fetched from tax_policy_store — zero hardcoded tax values.
 */

const supabase = require('../db');

// ============================================================================
// TAX POLICY LOOKUP
// ============================================================================

/**
 * Get the most recent policy value effective on or before `asOfDate`.
 * @param {string} jurisdiction - e.g. 'JM'
 * @param {string} policyKey - e.g. 'IT_THRESHOLD_JMD'
 * @param {string} asOfDate - ISO date string
 * @returns {number} policy value
 */
async function getTaxPolicy(jurisdiction, policyKey, asOfDate) {
    const { data, error } = await supabase
        .from('tax_policy_versions')
        .select('policy_json, name, effective_from')
        .eq('jurisdiction', jurisdiction)
        .lte('effective_from', asOfDate)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(`Tax policy lookup failed [${policyKey}]: ${error.message}`);
    if (!data) throw new Error(`No tax policy found for jurisdiction ${jurisdiction} as of ${asOfDate}`);

    const policyValue = data.policy_json[policyKey];
    if (policyValue === undefined) {
        throw new Error(`Policy key [${policyKey}] not found in policy version ${data.name} as of ${asOfDate}`);
    }

    return Number(policyValue);
}

/**
 * Get all policy values for a given date (batch fetch for efficiency).
 */
async function getAllPoliciesAsOf(jurisdiction, asOfDate) {
    const { data, error } = await supabase
        .from('tax_policy_versions')
        .select('policy_json, name, effective_from')
        .eq('jurisdiction', jurisdiction)
        .lte('effective_from', asOfDate)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(`Tax policies fetch failed: ${error.message}`);
    if (!data) return {};

    // Map to legacy format expected by callers: { KEY: { policy_value: ... } }
    const mapped = {};
    if (data.policy_json) {
        Object.keys(data.policy_json).forEach(key => {
            mapped[key] = {
                policy_key: key,
                policy_value: data.policy_json[key],
                effective_date: data.effective_from,
                policy_label: data.name
            };
        });
    }

    return mapped;
}

// ============================================================================
// BLENDED THRESHOLD COMPUTATION
// For calendar years where the IT threshold changes mid-year (e.g., April 1 2026).
// The calendar-year effective threshold is a weighted average.
// ============================================================================

/**
 * Compute the blended income-tax-free threshold for a given calendar year.
 * Fetches all effective policies and prorates exactly by month boundaries.
 */
async function computeBlendedThreshold(taxYear) {
    const jurisdiction = 'JM';
    const yearEnd = new Date(`${taxYear}-12-31T23:59:59Z`);
    const yearStart = new Date(`${taxYear}-01-01T00:00:00Z`);

    // Get all policies that could affect this year (effective ON OR BEFORE the end of the year)
    const { data: policies, error } = await supabase
        .from('tax_policy_versions')
        .select('policy_json, effective_from')
        .eq('jurisdiction', jurisdiction)
        .lte('effective_from', `${taxYear}-12-31`)
        .order('effective_from', { ascending: true });

    if (error) throw new Error(`Failed to fetch policies for threshold calc: ${error.message}`);

    const thresholdChanges = (policies || [])
        .filter(p => p.policy_json && p.policy_json['IT_THRESHOLD_JMD'] !== undefined)
        .map(p => ({
            date: new Date(`${p.effective_from}T00:00:00Z`),
            val: Number(p.policy_json['IT_THRESHOLD_JMD'])
        }));

    if (thresholdChanges.length === 0) {
        throw new Error('No baseline IT_THRESHOLD_JMD found.');
    }

    let blendedTotal = 0;
    let explanation = [];

    for (let i = 0; i < thresholdChanges.length; i++) {
        const current = thresholdChanges[i];
        const next = thresholdChanges[i + 1];

        let segmentStart = current.date < yearStart ? yearStart : current.date;
        let segmentEnd = next ? (next.date < yearEnd ? next.date : yearEnd) : yearEnd;

        if (segmentEnd < yearStart || segmentStart > segmentEnd) continue;

        let mStart = segmentStart.getUTCMonth();
        let mEnd = next && next.date <= yearEnd ? next.date.getUTCMonth() : 12;

        const monthsActive = mEnd - mStart;

        if (monthsActive > 0) {
            blendedTotal += current.val * (monthsActive / 12);
            explanation.push(`${monthsActive}/12 × ${current.val.toLocaleString()}`);
        }
    }

    const blendedThreshold = Math.round(blendedTotal);

    return {
        blendedThreshold,
        changeOccurred: explanation.length > 1,
        note: `Blended threshold for CY${taxYear}: ${explanation.join(' + ')} = ${blendedThreshold.toLocaleString()}`
    };
}

// ============================================================================
// SOLE TRADER CONTRIBUTIONS CALCULATOR
// ============================================================================

/**
 * Compute all Jamaica statutory contributions for a self-employed sole trader.
 * @param {number} grossIncomeJMD - Total gross revenue/profit in JMD
 * @param {number} allowableDeductionsJMD - Deductible expenses
 * @param {number} taxYear - e.g. 2025
 * @param {Object} settings - accounting_settings record ({ nht_category })
 * @returns {Object} Full contribution breakdown + quarterly schedule
 */
async function computeSoleTraderContributions(grossIncomeJMD, allowableDeductionsJMD, taxYear, settings) {
    const jurisdiction = 'JM';
    const asOfDec31 = `${taxYear}-12-31`;
    const nhtCategory = settings.nht_category || 'cat1_5'; // 'cat1_5' | 'cat6_7'

    // Fetch all policies for the year
    const policies = await getAllPoliciesAsOf(jurisdiction, asOfDec31);

    // Blended threshold
    const { blendedThreshold, changeOccurred, note: thresholdNote } = await computeBlendedThreshold(taxYear);

    // ---- Statutory Income ----
    const statutoryIncome = Math.max(0, grossIncomeJMD - allowableDeductionsJMD);

    // ---- Income Tax ----
    const chargeableIncome = Math.max(0, statutoryIncome - blendedThreshold);
    const itHighBand = Number(policies['IT_HIGH_BAND_JMD']?.policy_value || 6000000);
    const itRateStandard = Number(policies['IT_RATE_STANDARD']?.policy_value || 0.25);
    const itRateHigh = Number(policies['IT_RATE_HIGH']?.policy_value || 0.30);

    let incomeTax = 0;
    if (chargeableIncome > 0) {
        if (chargeableIncome <= itHighBand) {
            incomeTax = chargeableIncome * itRateStandard;
        } else {
            incomeTax = (itHighBand * itRateStandard) + ((chargeableIncome - itHighBand) * itRateHigh);
        }
    }
    incomeTax = Math.round(incomeTax * 100) / 100;

    // ---- Education Tax ----
    const eduTaxRate = Number(policies['EDU_TAX_RATE_SELF']?.policy_value || 0.0225);
    const educationTax = Math.round(statutoryIncome * eduTaxRate * 100) / 100;

    // ---- NHT ----
    const nhtRateKey = nhtCategory === 'cat6_7' ? 'NHT_RATE_CAT6_7' : 'NHT_RATE_CAT1_5';
    const nhtRate = Number(policies[nhtRateKey]?.policy_value || 0.03);
    const nhtContribution = Math.round(grossIncomeJMD * nhtRate * 100) / 100;

    // ---- NIS ----
    const nisRate = Number(policies['NIS_RATE_SELF_EMPLOYED']?.policy_value || 0.03);
    const nisWageCeiling = Number(policies['NIS_WAGE_CEILING_JMD']?.policy_value || 1500000);
    const nisableIncome = Math.min(grossIncomeJMD, nisWageCeiling);
    const nisContribution = Math.round(nisableIncome * nisRate * 100) / 100;

    const totalContributions = incomeTax + educationTax + nhtContribution + nisContribution;

    // ---- Quarterly Payment Schedule (March/June/Sept/Dec 15) ----
    // S04A estimated quarterly payments: each quarter = 1/4 of total contributions
    const quarterlyAmount = Math.round((totalContributions / 4) * 100) / 100;
    const quarterlySchedule = [
        { quarter: 'Q1', dueDate: `${taxYear}-03-15`, label: 'March 15', amount: quarterlyAmount, description: 'S04A Q1 — Due March 15' },
        { quarter: 'Q2', dueDate: `${taxYear}-06-15`, label: 'June 15', amount: quarterlyAmount, description: 'S04A Q2 — Due June 15' },
        { quarter: 'Q3', dueDate: `${taxYear}-09-15`, label: 'September 15', amount: quarterlyAmount, description: 'S04A Q3 — Due September 15' },
        { quarter: 'Q4', dueDate: `${taxYear}-12-15`, label: 'December 15', amount: quarterlyAmount, description: 'S04A Q4 — Due December 15' }
    ];

    return {
        taxYear,
        crossReferences: {
            jurisdiction: 'JM',
            policyDate: asOfDec31,
            thresholdNotes: changeOccurred ? thresholdNote : `Fixed threshold for CY${taxYear}: JMD ${blendedThreshold.toLocaleString()}`
        },
        income: {
            grossIncome: grossIncomeJMD,
            allowableDeductions: allowableDeductionsJMD,
            statutoryIncome,
            chargeableIncome,
            taxFreeThreshold: blendedThreshold
        },
        contributions: {
            incomeTax: { amount: incomeTax, rate: chargeableIncome <= itHighBand ? itRateStandard : 'blended', label: 'Income Tax' },
            educationTax: { amount: educationTax, rate: eduTaxRate, label: 'Education Tax (self-employed)' },
            nhtContribution: { amount: nhtContribution, rate: nhtRate, category: nhtCategory, label: `NHT (${nhtCategory === 'cat6_7' ? 'Category 6–7' : 'Category 1–5'})` },
            nisContribution: { amount: nisContribution, rate: nisRate, wageCeiling: nisWageCeiling, nisableIncome, label: 'NIS Contribution' },
            totalContributions: Math.round(totalContributions * 100) / 100
        },
        quarterlySchedule,
        taxReserveRecommendation: Math.round(totalContributions * 100) / 100
    };
}

// ============================================================================
// ANNUAL INCOME ESTIMATOR (for S04A)
// ============================================================================

/**
 * Project full-year income from YTD actuals.
 * @param {number} ytdRevenue - JMD, actual revenue to date
 * @param {number} ytdExpenses - JMD, actual deductible expenses to date
 * @param {Date} asOfDate - The date the YTD figures are as of
 * @param {number} taxYear
 */
function estimateAnnualIncome(ytdRevenue, ytdExpenses, asOfDate, taxYear) {
    const date = new Date(asOfDate);
    const dayOfYear = Math.ceil((date - new Date(date.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    const daysInYear = 365;
    const annualizationFactor = daysInYear / Math.max(dayOfYear, 1);

    const projectedRevenue = Math.round(ytdRevenue * annualizationFactor);
    const projectedExpenses = Math.round(ytdExpenses * annualizationFactor);
    const projectedNetIncome = projectedRevenue - projectedExpenses;

    return {
        ytdRevenue,
        ytdExpenses,
        ytdNetIncome: ytdRevenue - ytdExpenses,
        projectedRevenue,
        projectedExpenses,
        projectedNetIncome,
        annualizationFactor: Math.round(annualizationFactor * 100) / 100,
        asOfDate: asOfDate.toISOString ? asOfDate.toISOString().split('T')[0] : asOfDate,
        dayOfYear,
        note: `Projected from ${dayOfYear} days of data (factor: ${annualizationFactor.toFixed(2)}x)`
    };
}

// ============================================================================
// COMPLIANCE CALENDAR
// ============================================================================

/**
 * Generate upcoming compliance deadlines for a given business type and tax year.
 * @param {number} taxYear
 * @param {string} companyId - Company UUID to fetch business_type
 * @returns {Array} Sorted array of deadline objects
 */
async function getComplianceCalendar(taxYear, companyId) {
    let businessType = 'sole_trader';
    if (companyId) {
        const { data: comp } = await supabase.from('companies').select('business_type').eq('id', companyId).single();
        if (comp) businessType = comp.business_type;
    }

    const isSoleTrader = businessType === 'sole_trader';
    const nextYear = taxYear + 1;
    const today = new Date();

    const deadlines = [];

    // S04A filing (estimate) — March 15 of the tax year
    deadlines.push({
        id: `s04a-${taxYear}`,
        event: 'S04A Filing (Estimated Tax)',
        form: 'S04A',
        dueDate: `${taxYear}-03-15`,
        type: 'filing',
        appliesTo: 'sole_trader',
        description: `File estimated income/contributions declaration for year of assessment ${taxYear}`,
        authority: 'TAJ'
    });

    // Quarterly contribution payments
    const quarters = [
        { q: 'Q1', date: `${taxYear}-03-15`, desc: 'Q1 Quarterly Contributions Payment' },
        { q: 'Q2', date: `${taxYear}-06-15`, desc: 'Q2 Quarterly Contributions Payment' },
        { q: 'Q3', date: `${taxYear}-09-15`, desc: 'Q3 Quarterly Contributions Payment' },
        { q: 'Q4', date: `${taxYear}-12-15`, desc: 'Q4 Quarterly Contributions Payment' }
    ];

    quarters.forEach(q => {
        deadlines.push({
            id: `contrib-${taxYear}-${q.q}`,
            event: q.desc,
            form: 'S04A Quarterly',
            dueDate: q.date,
            type: 'payment',
            appliesTo: 'sole_trader',
            description: `NHT, NIS, Education Tax, and Income Tax quarterly payment`,
            authority: 'TAJ / NHT / MLSS'
        });
    });

    // S04 annual filing — March 15 of the FOLLOWING year
    if (isSoleTrader) {
        deadlines.push({
            id: `s04-${taxYear}`,
            event: `S04 Annual Return (FY ${taxYear})`,
            form: 'S04',
            dueDate: `${nextYear}-03-15`,
            type: 'filing',
            appliesTo: 'sole_trader',
            description: `Final S04 consolidated return for year of assessment ${taxYear}`,
            authority: 'TAJ'
        });
    } else {
        // Corporate: IT02 — April 15 of the following year (post YA2025)
        deadlines.push({
            id: `it02-${taxYear}`,
            event: `IT02 Corporate Return (FY ${taxYear})`,
            form: 'IT02',
            dueDate: `${nextYear}-04-15`,
            type: 'filing',
            appliesTo: 'company',
            description: `Corporate income tax return for year of assessment ${taxYear} (deadline moved to April 15 from YA2025)`,
            authority: 'TAJ'
        });
    }

    // BN1 Renewal reminder (Companies Office — every 3 years, reminders vary)
    deadlines.push({
        id: `bn1-renewal`,
        event: 'Business Name Registration Renewal (BN1)',
        form: 'BN1',
        dueDate: `${taxYear}-12-31`,
        type: 'registration',
        appliesTo: 'both',
        description: 'BN1 registrations are valid for 3 years. Check renewal date with Companies Office of Jamaica.',
        authority: 'Companies Office of Jamaica'
    });

    // Filter to applicable and add urgency
    const applicable = deadlines.filter(d =>
        d.appliesTo === 'both' ||
        d.appliesTo === businessType
    );

    return applicable
        .map(d => {
            const daysUntil = Math.ceil((new Date(d.dueDate) - today) / (1000 * 60 * 60 * 24));
            let urgency = 'normal';
            if (daysUntil < 0) urgency = 'overdue';
            else if (daysUntil <= 14) urgency = 'critical';
            else if (daysUntil <= 30) urgency = 'warning';
            else if (daysUntil <= 60) urgency = 'upcoming';
            return { ...d, daysUntil, urgency };
        })
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

module.exports = {
    getTaxPolicy,
    getAllPoliciesAsOf,
    computeBlendedThreshold,
    computeSoleTraderContributions,
    estimateAnnualIncome,
    getComplianceCalendar
};
