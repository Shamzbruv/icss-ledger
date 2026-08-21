const supabase = require('../db');
const { queueOutboxEvent } = require('./outboxEventService');

/**
 * Subscription billing is intentionally separate from invoicing.
 * Client Care and PayPal continue to track service/renewal state, but none of
 * these entry points may create an invoice or post subscription revenue.
 */
async function syncServiceActivation(serviceId) {
    console.log(`[BILLING] Subscription invoice generation is disabled for service ${serviceId}.`);
    return null;
}

async function processRecurringBilling() {
    return { processed: 0, disabled: true };
}

async function generateSubscriptionInvoice(service) {
    console.log(`[BILLING] Subscription invoice generation is disabled for service ${service?.id || 'unknown'}.`);
    return null;
}

function isSubscriptionPaymentContext({ clientServiceId, captureHasSubscriptionIdentity, invoice } = {}) {
    return Boolean((clientServiceId && captureHasSubscriptionIdentity) || invoice?.is_subscription);
}

async function cancelServiceBilling(serviceId) {
    const { data: invoices, error } = await supabase.from('invoices')
        .select('id, company_id, invoice_number, currency')
        .eq('client_service_id', serviceId)
        .eq('payment_status', 'UNPAID');
    if (error) throw error;

    for (const invoice of invoices || []) {
        await queueOutboxEvent({
            companyId: invoice.company_id,
            aggregateType: 'invoice',
            aggregateId: invoice.id,
            eventType: 'INVOICE_VOIDED',
            payload: { ...invoice, currency: invoice.currency || 'JMD' }
        });
        const { error: updateError } = await supabase.from('invoices')
            .update({ payment_status: 'VOID', status: 'void', balance_due: 0, remaining_amount: 0 })
            .eq('id', invoice.id);
        if (updateError) throw updateError;
    }
    return { success: true, voidedInvoices: (invoices || []).length };
}

function addBillingPeriod(sourceDate, frequency) {
    const source = new Date(sourceDate);
    const sourceYear = source.getUTCFullYear();
    const sourceMonth = source.getUTCMonth();
    const sourceDay = source.getUTCDate();
    const targetYear = frequency === 'yearly' ? sourceYear + 1 : sourceYear + Math.floor((sourceMonth + 1) / 12);
    const targetMonth = frequency === 'yearly' ? sourceMonth : (sourceMonth + 1) % 12;
    const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return new Date(Date.UTC(
        targetYear,
        targetMonth,
        Math.min(sourceDay, lastTargetDay),
        source.getUTCHours(),
        source.getUTCMinutes(),
        source.getUTCSeconds(),
        source.getUTCMilliseconds()
    ));
}

module.exports = {
    syncServiceActivation,
    cancelServiceBilling,
    processRecurringBilling,
    generateSubscriptionInvoice,
    isSubscriptionPaymentContext,
    addBillingPeriod
};
