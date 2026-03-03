const supabase = require('../db');
const { postJournalEntry, reversalEntry } = require('./accountingCoreService');
const crypto = require('crypto');

/**
 * Executes deterministic auto-categorization.
 * Priority: vendor (exact), vendor (alias), regex description.
 */
async function autoCategorizeLines(companyId, parsedLines) {
    // 1. Fetch rules for company
    const { data: rules } = await supabase
        .from('auto_category_rules')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('priority', { ascending: true });

    // 2. Fetch vendors and aliases for fast lookup
    const { data: vendors } = await supabase.from('vendors').select('id, vendor_name').eq('company_id', companyId);
    const { data: aliases } = await supabase.from('vendor_aliases').select('vendor_id, alias_normalized').eq('company_id', companyId);

    const vendorMap = new Map();
    (vendors || []).forEach(v => vendorMap.set(v.vendor_name.toUpperCase(), v.id));

    const aliasMap = new Map();
    (aliases || []).forEach(a => aliasMap.set(a.alias_normalized.toUpperCase(), a.vendor_id));

    // Process each line
    for (const line of parsedLines) {
        if (line.parse_status === 'error') continue;

        let vendorId = null;
        let accountId = null;
        let confidence = 0;
        let ruleFired = null;

        const cp = line.normalized.counterparty_name || '';
        const desc = line.normalized.description || '';

        // Match Vendor Exact
        if (vendorMap.has(cp)) {
            vendorId = vendorMap.get(cp);
            confidence = Math.max(confidence, 1.0);
        } else if (aliasMap.has(cp)) {
            vendorId = aliasMap.get(cp);
            confidence = Math.max(confidence, 0.95);
        }

        // Apply Categorization Rules
        if (rules && rules.length > 0) {
            for (const rule of rules) {
                if (rule.rule_type === 'vendor_exact' && vendorId) {
                    // Requires pre-matching vendor id, complex if rule_def stores vendor_id
                    if (rule.rule_def.vendor_id === vendorId) {
                        accountId = rule.target_account_id;
                        confidence = 1.0;
                        break;
                    }
                } else if (rule.rule_type === 'description_regex') {
                    const regex = new RegExp(rule.rule_def.regex, rule.rule_def.case_insensitive ? 'i' : '');
                    if (regex.test(desc) || regex.test(cp)) {
                        accountId = rule.target_account_id;
                        confidence = 0.9;
                        ruleFired = rule.id;
                        break;
                    }
                }
            }
        }

        line.matched_vendor_id = vendorId;
        line.suggested_account_id = accountId;
        line.suggestion_confidence = confidence;

        // fingerprint
        line.line_fingerprint = crypto.createHash('sha256')
            .update(`${line.normalized.txn_date}|${line.normalized.amount_signed}|${desc}`)
            .digest('hex');
    }

    return parsedLines;
}

/**
 * Confirms a bulk import batch, generating Immutable Journal Entries idempotently.
 */
async function confirmBatch(batchId, confirmPayload, userId, companyId) {
    // 1. Load the batch to ensure it's not already posted
    const { data: batch, error: batchErr } = await supabase
        .from('bulk_imports')
        .select('*')
        .eq('id', batchId)
        .eq('company_id', companyId)
        .single();
    if (batchErr || !batch) throw new Error('Batch not found');
    if (batch.status === 'posted') throw new Error('Batch is already posted.');

    // Start idempotent check
    const batchVersion = confirmPayload.batch_version || batch.batch_version;
    const idempotencyKey = `icss:company=${companyId}:bulk_import=${batchId}:v=${batchVersion}:confirm`;

    // 2. Fetch lines mapping
    const { data: lines } = await supabase
        .from('bulk_import_lines')
        .select('*')
        .eq('bulk_import_id', batchId)
        .in('parse_status', ['parsed', 'confirmed']); // Only post valid lines

    if (!lines || lines.length === 0) throw new Error('No valid lines to post.');

    // 3. For every line, if valid and has account/vendor, post journal
    const { data: coa } = await supabase.from('chart_of_accounts').select('id, code').eq('company_id', companyId);
    if (!coa) throw new Error('Could not load Chart of Accounts for company');

    const coaMap = new Map();
    coa.forEach(c => coaMap.set(c.id, c.code));

    const defaultPaymentAccId = confirmPayload.default_payment_account_id;
    if (!defaultPaymentAccId) throw new Error('Default payment/bank account is required to post expenses.');

    const paymentAccCode = coaMap.get(defaultPaymentAccId);
    if (!paymentAccCode) throw new Error('Invalid default payment account.');

    for (const line of lines) {
        // We only post if account is mapped 
        const targetAccId = line.user_overridden ? line.user_account_id : (line.user_account_id || line.suggested_account_id);

        if (!targetAccId) continue; // Skip lines missing categories (might want to enforce strictly in UI)

        const expenseAccCode = coaMap.get(targetAccId);
        if (!expenseAccCode) continue;

        const isMoneyOut = line.normalized_json.direction === 'money_out';
        const absoluteAmount = Math.abs(line.normalized_json.amount_signed);

        const jeLines = [];
        if (isMoneyOut) {
            jeLines.push({ accountCode: expenseAccCode, debitAmount: absoluteAmount, creditAmount: 0 });
            jeLines.push({ accountCode: paymentAccCode, debitAmount: 0, creditAmount: absoluteAmount });
        } else {
            // Money In (Refunds, etc.)
            jeLines.push({ accountCode: paymentAccCode, debitAmount: absoluteAmount, creditAmount: 0 });
            jeLines.push({ accountCode: expenseAccCode, debitAmount: 0, creditAmount: absoluteAmount });
        }

        const postingKey = `icss:company=${companyId}:bulk_line=${line.id}:v=${batchVersion}:post`;

        try {
            const journal = await postJournalEntry({
                companyId,
                entryDate: line.normalized_json.txn_date,
                description: `Bulk Import: ${line.normalized_json.description}`,
                sourceType: 'bulk_import_line',
                sourceId: line.id,
                sourceEventVersion: batchVersion,
                accountingEventId: postingKey,
                lines: jeLines
            });

            // Log mapping
            await supabase.from('bulk_import_line_postings').insert({
                bulk_import_line_id: line.id,
                journal_id: journal.id,
                posting_version: batchVersion
            });
        } catch (jeErr) {
            console.error(`Failed to post line ${line.id}: ${jeErr.message}`);
            // Depending on strictness, we might want to fail the whole batch here
            throw jeErr;
        }
    }

    // 4. Update batch status
    await supabase.from('bulk_imports').update({
        status: 'posted',
        confirmed_at: new Date().toISOString(),
        confirmed_by_user_id: userId,
        batch_version: batchVersion
    }).eq('id', batchId);

    // 5. Emit Outbox Event
    const payloadJson = {
        bulk_import_id: batchId,
        batch_version: batchVersion,
        lines_count: lines.length
    };

    await supabase.from('outbox_events').insert({
        company_id: companyId,
        aggregate_type: 'bulk_import',
        aggregate_id: batchId,
        event_version: batchVersion,
        event_type: 'BULK_IMPORT_CONFIRMED',
        idempotency_key: idempotencyKey,
        payload_jsonb: payloadJson,
        publish_status: 'pending'
    });

    return { success: true, message: 'Batch posted successfully.' };
}

/**
 * Reverts an entire batch, reversing all associated journal entries.
 */
async function revertBatch(batchId, userId, companyId) {
    const { data: batch } = await supabase
        .from('bulk_imports')
        .select('*')
        .eq('id', batchId)
        .eq('company_id', companyId)
        .single();

    if (!batch || batch.status !== 'posted') throw new Error('Cannot revert a batch that is not posted');

    const { data: postings } = await supabase
        .from('bulk_import_line_postings')
        .select('*, bulk_import_lines!inner(bulk_import_id)')
        .eq('bulk_import_lines.bulk_import_id', batchId)
        .eq('posting_version', batch.batch_version);

    let reversedCount = 0;
    for (const posting of postings) {
        try {
            await reversalEntry(posting.journal_id, `Batch Reversal for ${batchId}`, companyId);
            reversedCount++;
        } catch (err) {
            console.error(`Error reversing journal ${posting.journal_id}:`, err);
        }
    }

    await supabase.from('bulk_imports').update({ status: 'reverted' }).eq('id', batchId);

    return { success: true, reversedCount };
}

module.exports = {
    autoCategorizeLines,
    confirmBatch,
    revertBatch
};
