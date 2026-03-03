/**
 * Outbox Publisher
 * Background worker that polls the outbox_events table for pending events
 * and delivers them to the posting rules projector. Ensures at-least-once delivery.
 */

const supabase = require('../db');
const { projectAccountingEvent } = require('./postingRulesService');

let pollingInterval = null;

async function processOutbox() {
    try {
        // Fetch up to 50 pending events, ordered by occurrence
        const { data: events, error } = await supabase
            .from('outbox_events')
            .select('*')
            .eq('publish_status', 'pending')
            .order('occurred_at', { ascending: true })
            .limit(50);

        if (error) {
            console.error('[OUTBOX] Query error:', error.message);
            return;
        }

        if (!events || events.length === 0) return;

        for (const outboxEvent of events) {
            try {
                // Pre-update attempt count to prevent infinite rapid loops if something crashes hard
                await supabase.from('outbox_events')
                    .update({
                        attempt_count: outboxEvent.attempt_count + 1,
                        last_attempt_at: new Date().toISOString()
                    })
                    .eq('id', outboxEvent.id);

                // Map outbox structure to the expected event structure for the projector
                const mappedEvent = {
                    id: outboxEvent.id, // Using outbox event ID as the tracking ID
                    company_id: outboxEvent.company_id,
                    source_id: outboxEvent.aggregate_id,
                    source_type: outboxEvent.aggregate_type.toUpperCase(),
                    event_type: outboxEvent.event_type,
                    event_version: outboxEvent.event_version,
                    idempotency_key: outboxEvent.idempotency_key,
                    payload: outboxEvent.payload_jsonb
                };

                // Pass to projector
                await projectAccountingEvent(mappedEvent);

                // Mark success
                await supabase.from('outbox_events')
                    .update({ publish_status: 'published' })
                    .eq('id', outboxEvent.id);

                console.log(`[OUTBOX] Successfully projected event: ${outboxEvent.idempotency_key}`);

            } catch (projErr) {
                console.error(`[OUTBOX] Failed to project event ${outboxEvent.idempotency_key}:`, projErr.message);

                // After 5 attempts, mark as failed (dead letter queue conceptually)
                if (outboxEvent.attempt_count >= 4) {
                    await supabase.from('outbox_events')
                        .update({ publish_status: 'failed' })
                        .eq('id', outboxEvent.id);
                    console.error(`[OUTBOX] Event ${outboxEvent.idempotency_key} marked as FAILED after 5 retries.`);
                }
            }
        }
    } catch (err) {
        console.error('[OUTBOX] Processor error:', err.message);
    }
}

function startPolling(intervalMs = 5000) {
    if (pollingInterval) return;
    console.log(`[OUTBOX] Started projection polling worker every ${intervalMs}ms`);
    pollingInterval = setInterval(processOutbox, intervalMs);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log(`[OUTBOX] Stopped projection polling worker`);
    }
}

module.exports = { startPolling, stopPolling, processOutbox };
