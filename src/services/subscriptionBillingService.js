const supabase = require('../db');
const { computeInvoiceState } = require('./invoiceStateService');
const { generateReferenceCode } = require('./referenceService');

/**
 * Syncs a newly created Client Service to Accounting by generating its first invoice.
 */
async function syncServiceActivation(serviceId) {
    try {
        const { data: service, error: svcError } = await supabase
            .from('client_services')
            .select(`
                *,
                clients (id, name, email),
                service_plans (id, name, price, default_frequency)
            `)
            .eq('id', serviceId)
            .single();

        if (svcError || !service) throw new Error('Service not found');
        if (service.status !== 'active') return;

        // Ensure we don't double charge if it was already billed this month
        if (service.next_billing_date && new Date(service.next_billing_date) > new Date()) {
            return;
        }

        await generateSubscriptionInvoice(service);

        // Advance next_billing_date by the correct cadence
        const nextBilling = new Date();
        const syncFreq = service.frequency || service.service_plans?.default_frequency || 'monthly';
        if (syncFreq === 'yearly') {
            nextBilling.setFullYear(nextBilling.getFullYear() + 1);
        } else {
            nextBilling.setMonth(nextBilling.getMonth() + 1);
        }

        await supabase
            .from('client_services')
            .update({ next_billing_date: nextBilling.toISOString().split('T')[0] })
            .eq('id', service.id);

        console.log(`[BILLING] Activated & Billed subscription ${service.id} for ${service.clients.name}`);
    } catch (err) {
        console.error('[BILLING] Failed to sync service activation:', err.message);
    }
}

/**
 * Cancels a subscription and voids any unpaid automated invoices.
 */
async function cancelServiceBilling(serviceId) {
    try {
        const { data: unpaidInvoices, error: invError } = await supabase
            .from('invoices')
            .select('id, invoice_number')
            .eq('client_service_id', serviceId)
            .eq('payment_status', 'UNPAID');

        if (invError) throw invError;

        for (const inv of unpaidInvoices) {
            // Void the invoice (this will automatically trigger reversal in the projector via an INVOICE_UPDATED event)
            await supabase
                .from('invoices')
                .update({ payment_status: 'VOID' })
                .eq('id', inv.id);

            // Fetch the updated payload to push to outbox
            const { data: updatedInv } = await supabase
                .from('invoices')
                .select('*, clients(name)')
                .eq('id', inv.id)
                .single();

            const defaultComp = await supabase.from('companies').select('id').limit(1).single();

            // Push INVOICE_UPDATED to outbox
            if (defaultComp.data && updatedInv) {
                const payload = {
                    ...updatedInv,
                    client_name: updatedInv.clients?.name
                };

                await supabase.from('outbox_events').insert({
                    company_id: defaultComp.data.id,
                    aggregate_type: 'invoice',
                    aggregate_id: inv.id,
                    event_version: Date.now(), // Monotonic version bump
                    event_type: 'INVOICE_UPDATED',
                    idempotency_key: `${inv.id}-${Date.now()}-INVOICE_UPDATED`,
                    payload_jsonb: payload,
                    publish_status: 'pending'
                });
            }
            console.log(`[BILLING] Voided unpaid invoice ${inv.invoice_number} due to subscription cancellation.`);
        }
    } catch (err) {
        console.error('[BILLING] Failed to cancel service billing:', err.message);
    }
}

/**
 * Runs daily to process recurring billing for all active subscriptions globally.
 */
async function processRecurringBilling() {
    console.log('[BILLING] Starting Recurring Subscription Billing check...');
    try {
        const today = new Date().toISOString().split('T')[0];

        // Find services exactly due today or past due
        const { data: dueServices, error } = await supabase
            .from('client_services')
            .select(`
                *,
                clients (id, name, email),
                service_plans (id, name, price, default_frequency)
            `)
            .eq('status', 'active')
            .lte('next_billing_date', today);

        if (error) throw error;

        console.log(`[BILLING] Found ${dueServices?.length || 0} subscriptions due for billing.`);

        for (const service of dueServices) {
            await generateSubscriptionInvoice(service);

            // Advance billing date by the correct cadence
            const currentBillingDt = new Date(service.next_billing_date);
            const freq = service.frequency || service.service_plans?.default_frequency || 'monthly';
            if (freq === 'yearly') {
                currentBillingDt.setFullYear(currentBillingDt.getFullYear() + 1);
            } else {
                currentBillingDt.setMonth(currentBillingDt.getMonth() + 1);
            }

            await supabase
                .from('client_services')
                .update({ next_billing_date: currentBillingDt.toISOString().split('T')[0] })
                .eq('id', service.id);
        }

        console.log('[BILLING] Recurring Subscription Billing completed.');
    } catch (err) {
        console.error('[BILLING] Critical error in processing recurring billing:', err.message);
    }
}

/**
 * Core engine to generate an Invoice from a Subscription.
 */
async function generateSubscriptionInvoice(service) {
    // 1. Generate Invoice Number
    const { data: seqData } = await supabase.rpc('get_next_invoice_sequence');
    const nextSeq = seqData || Math.floor(Math.random() * 1000);
    const invoiceNumber = `INV-ICSS-${String(nextSeq).padStart(3, '0')}`;
    const targetCompanyId = await getDefaultCompanyId();

    const price = Number(service.service_plans?.price || 0);
    const taxAmount = price * 0.15; // 15% GCT
    const totalAmount = price + taxAmount;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14); // Net 14 by default for recurring
    
    const freq = service.frequency || service.service_plans?.billing_cycle || service.service_plans?.default_frequency || 'monthly';
    const renewalDate = new Date();
    if (freq === 'yearly') {
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);
    } else {
        renewalDate.setMonth(renewalDate.getMonth() + 1);
    }

    // 2. Create Invoice
    const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
            invoice_number: invoiceNumber,
            company_id: targetCompanyId,
            client_id: service.client_id,
            client_service_id: service.id, // Linking back to subscription
            due_date: dueDate.toISOString(),
            notes: `Automated billing for ${service.service_plans.name}`,
            total_amount: totalAmount,
            service_code: 'MAINT',
            payment_expected_type: 'FULL',
            payment_expected_percentage: 100,
            remaining_amount: totalAmount,
            is_subscription: true,
            is_renewal: true,
            plan_name: service.service_plans.name,
            billing_cycle: service.frequency || service.service_plans?.default_frequency || 'monthly',
            payment_status: 'UNPAID',
            balance_due: totalAmount,
            renewal_date: renewalDate.toISOString()
        })
        .select()
        .single();

    if (invoiceError) throw invoiceError;

    // 3. Generate Reference Code
    const refCode = generateReferenceCode(service.clients.name, invoice.invoice_number, 'MAINT', 100);
    await supabase.from('invoices').update({ reference_code: refCode }).eq('id', invoice.id);
    invoice.reference_code = refCode;

    // 4. Create Invoice Item (Single line item for the plan)
    const currentMonthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    await supabase.from('invoice_items').insert({
        invoice_id: invoice.id,
        description: `${service.service_plans.name} - ${currentMonthName}`,
        quantity: 1,
        unit_price: price
    });

    // 5. Emit Event to Outbox for Ledger Projection
    const eventPayload = {
        ...invoice,
        client_name: service.clients.name,
        payment_method: 'bank'
    };

    await supabase.from('outbox_events').insert({
        company_id: targetCompanyId,
        aggregate_type: 'invoice',
        aggregate_id: invoice.id,
        event_version: 1,
        event_type: 'INVOICE_CREATED',
        idempotency_key: `${invoice.id}-1-INVOICE_CREATED`,
        payload_jsonb: eventPayload,
        publish_status: 'pending'
    });

    console.log(`[BILLING] Successfully generated invoice ${invoice.invoice_number} for service ${service.id}`);
}

async function getDefaultCompanyId() {
    const { data } = await supabase.from('companies').select('id').limit(1).single();
    return data ? data.id : null;
}

module.exports = {
    syncServiceActivation,
    cancelServiceBilling,
    processRecurringBilling
};
