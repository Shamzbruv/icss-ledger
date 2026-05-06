const supabase = require('../db');
const { generateReferenceCode } = require('./referenceService');
const { generateInvoicePDF } = require('./pdfService');
const { sendInvoiceEmail } = require('./emailService');
const { getInvoiceEmailContent } = require('./emailTemplates');

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

        if (service.next_billing_date && new Date(service.next_billing_date) > new Date()) {
            return;
        }

        await generateSubscriptionInvoice(service, { isRenewal: false });

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

        console.log(`[BILLING] Activated & billed subscription ${service.id} for ${service.clients.name}`);
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
            await supabase
                .from('invoices')
                .update({ payment_status: 'VOID' })
                .eq('id', inv.id);

            const { data: updatedInv } = await supabase
                .from('invoices')
                .select('*, clients(name)')
                .eq('id', inv.id)
                .single();

            const defaultComp = await supabase.from('companies').select('id').limit(1).single();

            if (defaultComp.data && updatedInv) {
                const payload = {
                    ...updatedInv,
                    client_name: updatedInv.clients?.name
                };

                await supabase.from('outbox_events').insert({
                    company_id: defaultComp.data.id,
                    aggregate_type: 'invoice',
                    aggregate_id: inv.id,
                    event_version: Date.now(),
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
    console.log('[BILLING] Starting recurring subscription billing check...');
    try {
        const today = new Date().toISOString().split('T')[0];

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
            await generateSubscriptionInvoice(service, { isRenewal: true });

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

        console.log('[BILLING] Recurring subscription billing completed.');
    } catch (err) {
        console.error('[BILLING] Critical error in processing recurring billing:', err.message);
    }
}

async function generateSubscriptionInvoice(service, { isRenewal = true } = {}) {
    const { data: seqData } = await supabase.rpc('get_next_invoice_sequence');
    const nextSeq = seqData || Math.floor(Math.random() * 1000);
    const invoiceNumber = `INV-ICSS-${String(nextSeq).padStart(3, '0')}`;
    const targetCompanyId = await getDefaultCompanyId();

    const price = Number(service.service_plans?.price || 0);
    const taxAmount = price * 0.15;
    const totalAmount = price + taxAmount;

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 14);

    const freq = service.frequency || service.service_plans?.billing_cycle || service.service_plans?.default_frequency || 'monthly';
    const renewalDate = new Date(issueDate);
    if (freq === 'yearly') {
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);
    } else {
        renewalDate.setMonth(renewalDate.getMonth() + 1);
    }

    const planName = service.service_plans?.name || 'Subscription Service';
    const lineItem = {
        description: `${planName} - ${issueDate.toLocaleString('default', { month: 'long', year: 'numeric' })}`,
        quantity: 1,
        unit_price: price
    };

    const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
            invoice_number: invoiceNumber,
            company_id: targetCompanyId,
            client_id: service.client_id,
            client_service_id: service.id,
            issue_date: issueDate.toISOString(),
            due_date: dueDate.toISOString(),
            status: 'pending',
            notes: isRenewal ? `Automated renewal billing for ${planName}` : `Subscription activation for ${planName}`,
            total_amount: totalAmount,
            service_code: 'MAINT',
            payment_expected_type: 'FULL',
            payment_expected_percentage: 100,
            remaining_amount: totalAmount,
            amount_paid: 0,
            balance_due: totalAmount,
            is_subscription: true,
            is_renewal: isRenewal,
            plan_name: planName,
            billing_cycle: freq,
            payment_status: 'UNPAID',
            renewal_date: renewalDate.toISOString()
        })
        .select()
        .single();

    if (invoiceError) throw invoiceError;

    const refCode = generateReferenceCode(service.clients.name, invoice.invoice_number, 'MAINT', 100);
    await supabase.from('invoices').update({ reference_code: refCode }).eq('id', invoice.id);
    invoice.reference_code = refCode;

    await supabase.from('invoice_items').insert({
        invoice_id: invoice.id,
        description: lineItem.description,
        quantity: lineItem.quantity,
        unit_price: lineItem.unit_price
    });

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

    try {
        await sendGeneratedInvoiceEmail(invoice, service, lineItem);
    } catch (emailErr) {
        console.error(`[BILLING] Failed to send invoice email for ${invoice.invoice_number}:`, emailErr.message);
    }

    console.log(`[BILLING] Successfully generated invoice ${invoice.invoice_number} for service ${service.id}`);
}

async function sendGeneratedInvoiceEmail(invoice, service, lineItem) {
    if (!service.clients?.email) {
        console.warn(`[BILLING] Skipping invoice email for ${invoice.invoice_number}; client email is missing.`);
        return;
    }

    const emailContent = getInvoiceEmailContent(invoice, service.clients);
    const pdfBuffer = await generateInvoicePDF(invoice, service.clients, [lineItem]);

    await sendInvoiceEmail(
        service.clients.email,
        emailContent.subject,
        emailContent.text,
        emailContent.html,
        pdfBuffer,
        invoice.invoice_number,
        null
    );

    console.log(`[BILLING] Sent invoice email for ${invoice.invoice_number} to ${service.clients.email}`);
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
