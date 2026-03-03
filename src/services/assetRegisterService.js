/**
 * Asset Register Service
 * Manages fixed assets, book depreciation, and Jamaica tax capital allowances.
 * Book depreciation ≠ tax deduction (per Jamaica law: depreciation is disallowed;
 * qualifying assets use capital allowances under Schedule 2).
 */

const supabase = require('../db');
const { emitAccountingEvent } = require('./postingRulesService');

// ============================================================================
// ASSET MANAGEMENT
// ============================================================================

async function addAsset(companyId, assetData) {
    const { data: asset, error } = await supabase
        .from('fixed_assets')
        .insert({
            company_id: companyId,
            asset_name: assetData.assetName,
            asset_category: assetData.assetCategory,
            purchase_date: assetData.purchaseDate,
            cost: Number(assetData.cost),
            currency: assetData.currency || 'JMD',
            fx_rate: Number(assetData.fxRate || 1),
            business_use_percent: Number(assetData.businessUsePercent || 100),
            useful_life_years: Number(assetData.usefulLifeYears || 5),
            residual_value: Number(assetData.residualValue || 0),
            depreciation_method: assetData.depreciationMethod || 'straight_line',
            coa_account_code: '1500',
            vendor: assetData.vendor || null,
            serial_number: assetData.serialNumber || null,
            receipt_url: assetData.receiptUrl || null,
            notes: assetData.notes || null
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to add asset: ${error.message}`);

    // Emit accounting event
    await emitAccountingEvent({
        companyId,
        sourceId: asset.id,
        sourceType: 'ASSET',
        eventType: 'ASSET_PURCHASE',
        eventVersion: 1,
        payload: {
            asset_name: asset.asset_name,
            asset_category: asset.asset_category,
            purchase_date: asset.purchase_date,
            cost: asset.cost,
            currency: asset.currency,
            fx_rate: asset.fx_rate,
            asset_payment_method: assetData.paymentMethod || 'bank'
        }
    });

    return asset;
}

async function getAssets(companyId, includeDisposed = false) {
    let query = supabase
        .from('fixed_assets')
        .select('*')
        .eq('company_id', companyId)
        .order('purchase_date', { ascending: false });

    if (!includeDisposed) query = query.eq('disposed', false);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
}

async function disposeAsset(companyId, assetId, disposalData) {
    const { data: asset, error: fetchErr } = await supabase
        .from('fixed_assets')
        .select('*')
        .eq('id', assetId)
        .eq('company_id', companyId)
        .single();

    if (fetchErr || !asset) throw new Error('Asset not found');

    await supabase
        .from('fixed_assets')
        .update({
            disposed: true,
            disposal_date: disposalData.disposalDate,
            disposal_proceeds: Number(disposalData.proceeds || 0),
            disposal_notes: disposalData.notes || null
        })
        .eq('id', assetId);

    return { success: true, asset };
}

// ============================================================================
// BOOK DEPRECIATION (Straight-line / Declining balance)
// For management P&L reporting ONLY — NOT a tax deduction in Jamaica
// ============================================================================

/**
 * Compute annual book depreciation for an asset.
 * Inserts a record into depreciation_schedules and emits DEPRECIATION_POSTED event.
 */
async function computeBookDepreciation(assetId, fiscalYear, companyId) {
    const { data: asset, error } = await supabase
        .from('fixed_assets')
        .select('*')
        .eq('id', assetId)
        .eq('company_id', companyId)
        .single();

    if (error || !asset) throw new Error(`Asset ${assetId} not found`);
    if (asset.disposed) return null;

    const cost = Number(asset.cost);
    const residual = Number(asset.residual_value || 0);
    const usefulLife = Number(asset.useful_life_years || 5);
    const depreciableAmount = cost - residual;

    // Fetch prior accumulated depreciation
    const { data: priorSchedules } = await supabase
        .from('depreciation_schedules')
        .select('depreciation_amount')
        .eq('asset_id', assetId)
        .lt('fiscal_year', fiscalYear);

    const priorAccumulated = (priorSchedules || []).reduce((sum, s) => sum + Number(s.depreciation_amount), 0);

    let annualDepreciation = 0;

    if (asset.depreciation_method === 'straight_line') {
        annualDepreciation = depreciableAmount / usefulLife;
    } else if (asset.depreciation_method === 'declining_balance') {
        const dbRate = 1 / usefulLife * 2; // Double declining
        const currentNBV = cost - priorAccumulated;
        annualDepreciation = currentNBV * dbRate;
    }

    // Cap at remaining depreciable amount
    annualDepreciation = Math.min(annualDepreciation, Math.max(0, depreciableAmount - priorAccumulated));
    annualDepreciation = Math.round(annualDepreciation * 100) / 100;

    if (annualDepreciation <= 0) return null;

    const accumulatedDepreciation = Math.round((priorAccumulated + annualDepreciation) * 100) / 100;
    const netBookValue = Math.round((cost - accumulatedDepreciation) * 100) / 100;

    // Upsert into depreciation_schedules
    const { data: schedule, error: schedErr } = await supabase
        .from('depreciation_schedules')
        .upsert({
            asset_id: assetId,
            company_id: companyId,
            fiscal_year: fiscalYear,
            depreciation_amount: annualDepreciation,
            accumulated_depreciation: accumulatedDepreciation,
            net_book_value: netBookValue,
            posted: false
        }, { onConflict: 'asset_id,fiscal_year' })
        .select()
        .single();

    if (schedErr) throw new Error(`Failed to compute depreciation: ${schedErr.message}`);

    return { asset, schedule, annualDepreciation, accumulatedDepreciation, netBookValue };
}

/**
 * Post depreciation journal entries for all active assets for a given year.
 */
async function postDepreciationJournalEntries(companyId, fiscalYear) {
    const assets = await getAssets(companyId, false);
    const results = [];

    for (const asset of assets) {
        const result = await computeBookDepreciation(asset.id, fiscalYear, companyId);
        if (!result) continue;

        // Emit event (postingRulesService will handle the journal entry)
        const event = await emitAccountingEvent({
            companyId,
            sourceId: asset.id,
            sourceType: 'ASSET',
            eventType: 'DEPRECIATION_POSTED',
            eventVersion: fiscalYear, // Use fiscal year as version
            payload: {
                asset_name: asset.asset_name,
                fiscal_year: fiscalYear,
                depreciation_amount: result.annualDepreciation,
                period_end_date: `${fiscalYear}-12-31`
            }
        });

        // Mark schedule as posted
        await supabase
            .from('depreciation_schedules')
            .update({ posted: true })
            .eq('asset_id', asset.id)
            .eq('fiscal_year', fiscalYear);

        results.push({ assetId: asset.id, assetName: asset.asset_name, depreciation: result.annualDepreciation });
    }

    console.log(`📊 Depreciation posted for ${results.length} assets — FY${fiscalYear}`);
    return results;
}

// ============================================================================
// JAMAICA TAX CAPITAL ALLOWANCES
// Depreciation is NOT deductible in Jamaica; instead capital allowances apply.
// This computes the Schedule 2 capital allowance claim.
// ============================================================================

// Jamaica capital allowance rates by asset category (percentage of cost, initial year + annual)
const CAPITAL_ALLOWANCE_RATES = {
    computer: { initial: 0.20, annual: 0.20 },          // 20% initial + 20% annually
    equipment: { initial: 0.20, annual: 0.20 },
    furniture: { initial: 0.10, annual: 0.10 },
    vehicle: { initial: 0.20, annual: 0.20 },
    building_commercial: { initial: 0.04, annual: 0.04 }, // 4% per year
    building_industrial: { initial: 0.05, annual: 0.05 },
    ip: { initial: 0.10, annual: 0.10 },                 // Intellectual property
    other: { initial: 0.10, annual: 0.10 }
};

/**
 * Compute Jamaica tax capital allowance for an asset for a given tax year.
 */
async function computeCapitalAllowance(assetId, taxYear, companyId) {
    const { data: asset, error } = await supabase
        .from('fixed_assets')
        .select('*')
        .eq('id', assetId)
        .eq('company_id', companyId)
        .single();

    if (error || !asset) throw new Error(`Asset ${assetId} not found`);

    const purchaseYear = new Date(asset.purchase_date).getFullYear();
    if (taxYear < purchaseYear) return null; // Asset not yet acquired

    const costJMD = Number(asset.cost) * Number(asset.fx_rate || 1);
    const businessUsePct = Number(asset.business_use_percent || 100) / 100;
    const qualifyingCost = costJMD * businessUsePct;

    const category = asset.asset_category || 'other';
    const rates = CAPITAL_ALLOWANCE_RATES[category] || CAPITAL_ALLOWANCE_RATES.other;

    // Prior year allowances (to determine tax WDV)
    const { data: priorAllowances } = await supabase
        .from('capital_allowance_schedules')
        .select('total_allowance')
        .eq('asset_id', assetId)
        .lt('tax_year', taxYear);

    const priorTotalAllowances = (priorAllowances || []).reduce((sum, a) => sum + Number(a.total_allowance), 0);
    const taxWDVOpening = Math.max(0, qualifyingCost - priorTotalAllowances);

    let initialAllowance = 0;
    let annualAllowance = 0;

    if (taxYear === purchaseYear) {
        // First year: initial allowance applies
        initialAllowance = Math.round(qualifyingCost * rates.initial * 100) / 100;
    }

    // Annual allowance on tax WDV after initial
    const afterInitialWDV = taxWDVOpening - initialAllowance;
    if (afterInitialWDV > 0) {
        annualAllowance = Math.round(afterInitialWDV * rates.annual * 100) / 100;
    }

    const totalAllowance = Math.round((initialAllowance + annualAllowance) * 100) / 100;
    const taxWDVClosing = Math.max(0, Math.round((taxWDVOpening - totalAllowance) * 100) / 100);

    // Upsert
    const { data: schedule, error: schedErr } = await supabase
        .from('capital_allowance_schedules')
        .upsert({
            asset_id: assetId,
            company_id: companyId,
            tax_year: taxYear,
            initial_allowance: initialAllowance,
            annual_allowance: annualAllowance,
            total_allowance: totalAllowance,
            tax_wdv_opening: taxWDVOpening,
            tax_wdv_closing: taxWDVClosing,
            policy_version_date: new Date().toISOString().split('T')[0],
            notes: `Category: ${category}, Business use: ${businessUsePct * 100}%`
        }, { onConflict: 'asset_id,tax_year' })
        .select()
        .single();

    if (schedErr) throw new Error(`Capital allowance computation failed: ${schedErr.message}`);

    return { asset, schedule, totalAllowance, taxWDVOpening, taxWDVClosing, rates };
}

/**
 * Build the full capital allowances schedule for all assets for a tax year.
 * This is what feeds the S04 Schedule 2 attachment.
 */
async function getCapitalAllowanceReport(companyId, taxYear) {
    const assets = await getAssets(companyId, true);
    const report = [];
    let totalAllowances = 0;

    for (const asset of assets) {
        const result = await computeCapitalAllowance(asset.id, taxYear, companyId);
        if (!result) continue;
        report.push({
            assetName: asset.asset_name,
            category: asset.asset_category,
            purchaseDate: asset.purchase_date,
            cost: asset.cost,
            qualifyingCost: Number(asset.cost) * Number(asset.fx_rate || 1) * (Number(asset.business_use_percent || 100) / 100),
            businessUsePercent: asset.business_use_percent,
            taxWDVOpening: result.taxWDVOpening,
            initialAllowance: result.schedule.initial_allowance,
            annualAllowance: result.schedule.annual_allowance,
            totalAllowance: result.totalAllowance,
            taxWDVClosing: result.taxWDVClosing
        });
        totalAllowances += result.totalAllowance;
    }

    return {
        taxYear,
        assets: report,
        totalCapitalAllowances: Math.round(totalAllowances * 100) / 100,
        note: 'Jamaica book depreciation is NOT tax-deductible. Capital allowances under Schedule 2 apply instead.'
    };
}

async function getAssetRegisterReport(companyId) {
    const assets = await getAssets(companyId, true);

    // Compute current NVB for each asset
    const report = await Promise.all(assets.map(async (asset) => {
        const { data: schedules } = await supabase
            .from('depreciation_schedules')
            .select('fiscal_year, depreciation_amount, accumulated_depreciation, net_book_value')
            .eq('asset_id', asset.id)
            .order('fiscal_year', { ascending: false })
            .limit(1);

        const latestSchedule = schedules && schedules[0];

        return {
            id: asset.id,
            assetName: asset.asset_name,
            category: asset.asset_category,
            purchaseDate: asset.purchase_date,
            cost: Number(asset.cost),
            currency: asset.currency,
            businessUsePercent: Number(asset.business_use_percent),
            usefulLifeYears: Number(asset.useful_life_years),
            currentNBV: latestSchedule ? Number(latestSchedule.net_book_value) : Number(asset.cost),
            accumulatedDepreciation: latestSchedule ? Number(latestSchedule.accumulated_depreciation) : 0,
            disposed: asset.disposed,
            disposalDate: asset.disposal_date,
            disposalProceeds: Number(asset.disposal_proceeds || 0),
            vendor: asset.vendor
        };
    }));

    const totalCost = report.reduce((sum, a) => sum + a.cost, 0);
    const totalNBV = report.filter(a => !a.disposed).reduce((sum, a) => sum + a.currentNBV, 0);

    return { assets: report, totalCost, totalNBV };
}

module.exports = {
    addAsset, getAssets, disposeAsset,
    computeBookDepreciation, postDepreciationJournalEntries,
    computeCapitalAllowance, getCapitalAllowanceReport,
    getAssetRegisterReport,
    CAPITAL_ALLOWANCE_RATES
};
