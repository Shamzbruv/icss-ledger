const supabase = require('../db');

const MAX_POSTGRES_INTEGER = 2147483647;

function calculateNextEventVersion(...values) {
    const latest = values
        .flat()
        .map(value => Number(value || 0))
        .filter(Number.isSafeInteger)
        .reduce((max, value) => Math.max(max, value), 0);

    if (latest >= MAX_POSTGRES_INTEGER) {
        throw new Error('Accounting event version limit reached for this record.');
    }
    return latest + 1;
}

async function getNextEventVersion(companyId, aggregateType, aggregateId) {
    if (!companyId || !aggregateId) {
        throw new Error('Company and aggregate IDs are required for an accounting event.');
    }

    const sourceType = String(aggregateType || '').toUpperCase();
    const [
        { data: outbox, error: outboxError },
        { data: accounting, error: accountingError },
        { data: journal, error: journalError }
    ] = await Promise.all([
        supabase.from('outbox_events')
            .select('event_version')
            .eq('company_id', companyId)
            .eq('aggregate_type', aggregateType)
            .eq('aggregate_id', aggregateId)
            .order('event_version', { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabase.from('accounting_events')
            .select('event_version')
            .eq('company_id', companyId)
            .eq('source_type', sourceType)
            .eq('source_id', aggregateId)
            .order('event_version', { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabase.from('journals')
            .select('source_event_version')
            .eq('company_id', companyId)
            .eq('source_type', sourceType)
            .eq('source_id', aggregateId)
            .order('source_event_version', { ascending: false })
            .limit(1)
            .maybeSingle()
    ]);

    if (outboxError) throw new Error(`Could not inspect queued accounting events: ${outboxError.message}`);
    if (accountingError) throw new Error(`Could not inspect accounting history: ${accountingError.message}`);
    if (journalError) throw new Error(`Could not inspect journal history: ${journalError.message}`);

    return calculateNextEventVersion(outbox?.event_version, accounting?.event_version, journal?.source_event_version);
}

async function queueOutboxEvent({
    companyId,
    aggregateType,
    aggregateId,
    eventType,
    payload,
    idempotencyKey,
    publishStatus = 'pending'
}) {
    const eventVersion = await getNextEventVersion(companyId, aggregateType, aggregateId);
    const finalIdempotencyKey = idempotencyKey || `${aggregateId}-${eventVersion}-${eventType}`;
    const { data, error } = await supabase.from('outbox_events').insert({
        company_id: companyId,
        aggregate_type: aggregateType,
        aggregate_id: aggregateId,
        event_version: eventVersion,
        event_type: eventType,
        idempotency_key: finalIdempotencyKey,
        payload_jsonb: payload,
        publish_status: publishStatus
    }).select('id, event_version, idempotency_key, publish_status').single();

    if (error) throw new Error(`Could not queue the accounting event: ${error.message}`);
    return data;
}

module.exports = {
    MAX_POSTGRES_INTEGER,
    calculateNextEventVersion,
    getNextEventVersion,
    queueOutboxEvent
};
