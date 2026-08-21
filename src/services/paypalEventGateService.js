const supabase = require('../db');

const RENEWAL_ELIGIBLE_EVENTS = new Set([
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'PAYMENT.SALE.COMPLETED',
    'PAYMENT.CAPTURE.COMPLETED'
]);

const SUBSCRIPTION_FAILURE_EVENTS = new Set([
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    'PAYMENT.SALE.REVERSED',
    'PAYMENT.CAPTURE.DECLINED',
    'PAYMENT.CAPTURE.DENIED'
]);

function isRenewalEligibleEvent(eventType) {
    return RENEWAL_ELIGIBLE_EVENTS.has(String(eventType || ''));
}

function isSubscriptionFailureEvent(eventType) {
    return SUBSCRIPTION_FAILURE_EVENTS.has(String(eventType || ''));
}

async function getLatestVerifiedPayPalEvent(service) {
    if (!service?.id) return null;

    const fields = 'id, paypal_event_id, event_type, resource_id, custom_id, processed_at';
    const { data: correlatedEvent, error: correlatedError } = await supabase
        .from('paypal_webhook_events')
        .select(fields)
        .eq('status', 'processed')
        .eq('custom_id', String(service.id))
        .order('processed_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    if (correlatedError) throw correlatedError;

    const subscriptionId = service.service_meta_json?.paypal_subscription_id;
    if (!subscriptionId) return correlatedEvent || null;

    const { data: subscriptionEvent, error: subscriptionError } = await supabase
        .from('paypal_webhook_events')
        .select(fields)
        .eq('status', 'processed')
        .eq('resource_id', String(subscriptionId))
        .order('processed_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    if (subscriptionError) throw subscriptionError;

    if (!correlatedEvent) return subscriptionEvent || null;
    if (!subscriptionEvent) return correlatedEvent;
    return new Date(subscriptionEvent.processed_at || 0) > new Date(correlatedEvent.processed_at || 0)
        ? subscriptionEvent
        : correlatedEvent;
}

module.exports = {
    getLatestVerifiedPayPalEvent,
    isRenewalEligibleEvent,
    isSubscriptionFailureEvent
};
