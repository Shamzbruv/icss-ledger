const supabase = require('../db');
const { sendEmail } = require('./emailService');
const { getWelcomeSubscriptionTemplate } = require('./emailTemplates');
const { findCatalogPlan } = require('./subscriptionCatalog');
const { calculateNextRunIso, getLocalCalendarParts, normalizeTimeZone } = require('./scheduleTimeService');

const WEBSITE_PLAN_CODES = new Set(['HOST_PRO', 'HOST_DOM', 'MAINT', 'REFRESH']);
const WEBSITE_CHECKLIST = [
    { code: 'UPTIME', label: 'Website Uptime' },
    { code: 'SSL', label: 'SSL Certificate' },
    { code: 'DNS', label: 'Domain & DNS' },
    { code: 'REDIRECT', label: 'Secure Redirect' },
    { code: 'PERF_LIGHT', label: 'Website Performance' },
    { code: 'GA_TRAFFIC', label: 'Google Analytics Traffic Analysis' }
];

function subscriberDetails(subscription) {
    const subscriber = subscription?.subscriber || {};
    const email = String(subscriber.email_address || '').trim().toLowerCase();
    const fullName = subscriber.name
        ? `${subscriber.name.given_name || ''} ${subscriber.name.surname || ''}`.trim()
        : email.split('@')[0];
    return { email, fullName, phone: subscriber.phone?.phone_number?.national_number || '' };
}

async function ensureServicePlan(catalogPlan) {
    const names = [catalogPlan.name, ...(catalogPlan.legacyNames || [])];
    const { data: existing, error } = await supabase.from('service_plans').select('*').in('name', names).limit(1).maybeSingle();
    if (error) throw error;
    if (existing) {
        const { data: updated, error: updateError } = await supabase.from('service_plans').update({
            name: catalogPlan.name,
            price: catalogPlan.price,
            default_frequency: catalogPlan.careFrequency === 'yearly' ? 'yearly' : 'monthly',
            features_json: catalogPlan.features || []
        }).eq('id', existing.id).select().single();
        if (!updateError && updated) return updated;
        const { data: canonical } = await supabase.from('service_plans').select('*').eq('name', catalogPlan.name).maybeSingle();
        if (canonical) return canonical;
        throw updateError;
    }
    const { data, error: insertError } = await supabase.from('service_plans').insert({
        name: catalogPlan.name,
        default_frequency: catalogPlan.careFrequency === 'yearly' ? 'yearly' : 'monthly',
        price: catalogPlan.price,
        features_json: catalogPlan.features || []
    }).select().single();
    if (insertError) throw insertError;
    return data;
}

async function ensureChecklistTemplate(plan, catalogPlan) {
    if (!WEBSITE_PLAN_CODES.has(catalogPlan.code)) return;
    const { data: existing, error: lookupError } = await supabase.from('checklist_templates')
        .select('id').eq('plan_id', plan.id).limit(1).maybeSingle();
    if (lookupError) {
        console.warn(`[CLIENT CARE] Checklist lookup skipped: ${lookupError.message}`);
        return;
    }
    if (existing) return;
    const { error } = await supabase.from('checklist_templates').insert({
        plan_id: plan.id,
        name: `${catalogPlan.name} Weekly Health & Traffic`,
        items_json: WEBSITE_CHECKLIST
    });
    if (error && String(error.code) !== '23505') console.warn(`[CLIENT CARE] Checklist creation skipped: ${error.message}`);
}

async function ensureSubscriptionContext(subscription, onboarding = {}) {
    const subscriber = subscriberDetails(subscription);
    if (!subscriber.email) throw new Error('PayPal did not provide a subscriber email address');
    const catalogPlan = findCatalogPlan({
        planId: subscription.plan_id,
        name: onboarding.planName || subscription.description,
        amount: subscription.billing_info?.last_payment?.amount?.value
    });
    if (!catalogPlan) throw new Error(`The PayPal plan ${subscription.plan_id || ''} is not mapped to a service plan`);

    // Prefer the service already bound to this exact PayPal subscription. This
    // keeps a returning customer tied to the right client even if legacy data
    // contains more than one record with the same email address.
    const subscriptionId = subscription.id;
    let { data: service, error: serviceLookupError } = await supabase.from('client_services')
        .select('*').contains('service_meta_json', { paypal_subscription_id: subscriptionId }).limit(1).maybeSingle();
    if (serviceLookupError) throw serviceLookupError;

    let client = null;
    if (service?.client_id) {
        const { data: serviceClient, error: serviceClientError } = await supabase.from('clients')
            .select('*').eq('id', service.client_id).maybeSingle();
        if (serviceClientError) throw serviceClientError;
        client = serviceClient;
    }
    if (!client) {
        const { data: emailClient, error: clientLookupError } = await supabase.from('clients')
            .select('*').ilike('email', subscriber.email).limit(1).maybeSingle();
        if (clientLookupError) throw clientLookupError;
        client = emailClient;
    }

    const { data: defaultCompany } = await supabase.from('companies').select('id').limit(1).maybeSingle();
    const clientValues = {
        name: String(onboarding.businessName || onboarding.fullName || client?.name || subscriber.fullName || subscriber.email).trim(),
        email: subscriber.email,
        address: String(onboarding.address || client?.address || '').trim() || null,
        company_id: client?.company_id || defaultCompany?.id || null
    };
    if (client) {
        const { data: updated, error } = await supabase.from('clients').update(clientValues).eq('id', client.id).select().single();
        if (error) throw error;
        client = updated;
    } else {
        const { data: created, error } = await supabase.from('clients').insert(clientValues).select().single();
        if (error) throw error;
        client = created;
    }

    const plan = await ensureServicePlan(catalogPlan);
    await ensureChecklistTemplate(plan, catalogPlan);
    if (!service) {
        const { data: compatibleServices, error: compatibleServicesError } = await supabase.from('client_services').select('*')
            .eq('client_id', client.id).eq('plan_id', plan.id).eq('status', 'active')
            .limit(5);
        if (compatibleServicesError) throw compatibleServicesError;
        const unboundServices = (compatibleServices || []).filter(candidate => !candidate.service_meta_json?.paypal_subscription_id);
        // Reuse only an unambiguous legacy service. If several candidates
        // exist, creating a new bound service is safer than modifying the
        // wrong subscription.
        service = unboundServices.length === 1 ? unboundServices[0] : null;
    }

    const oldMeta = service?.service_meta_json || {};
    const requestedCareFrequency = onboarding.reportFrequency || service?.frequency || 'monthly';
    const frequency = WEBSITE_PLAN_CODES.has(catalogPlan.code)
        ? 'weekly'
        : (['daily', 'weekly', 'monthly'].includes(requestedCareFrequency) ? requestedCareFrequency : 'monthly');
    const sendDayOfWeek = frequency === 'weekly' ? Number(onboarding.sendDayOfWeek ?? service?.send_day_of_week ?? 1) : null;
    const sendDayOfMonth = frequency === 'monthly' ? Number(onboarding.sendDayOfMonth ?? service?.send_day_of_month ?? 1) : null;
    const sendTime = onboarding.sendTime || service?.send_time || '09:00';
    const timeZone = normalizeTimeZone(onboarding.timezone || service?.timezone || 'America/Jamaica');
    const metadata = {
        ...oldMeta,
        paypal_subscription_id: subscriptionId,
        paypal_plan_id: subscription.plan_id,
        plan_code: catalogPlan.code,
        entitlements: catalogPlan.features,
        contact_name: String(onboarding.fullName || oldMeta.contact_name || subscriber.fullName || '').trim(),
        contact_phone: String(onboarding.phone || oldMeta.contact_phone || subscriber.phone || '').trim(),
        website_url: String(onboarding.websiteUrl || oldMeta.website_url || '').trim(),
        domain: String(onboarding.domainName || oldMeta.domain || '').trim(),
        report_email: String(onboarding.reportEmail || oldMeta.report_email || subscriber.email).trim().toLowerCase(),
        cc_emails: Array.isArray(onboarding.ccEmails) ? onboarding.ccEmails : (oldMeta.cc_emails || []),
        birthday_month: Number(onboarding.birthdayMonth || oldMeta.birthday_month) || null,
        birthday_day: Number(onboarding.birthdayDay || oldMeta.birthday_day) || null,
        onboarding_completed_at: onboarding.completed ? new Date().toISOString() : oldMeta.onboarding_completed_at || null
    };
    const nextRenewal = subscription.billing_info?.next_billing_time
        ? new Date(subscription.billing_info.next_billing_time).toISOString().split('T')[0]
        : service?.next_renewal_date || null;
    const serviceValues = {
        client_id: client.id,
        plan_id: plan.id,
        status: String(subscription.status || '').toUpperCase() === 'ACTIVE'
            ? 'active'
            : (['CANCELLED', 'SUSPENDED', 'EXPIRED'].includes(String(subscription.status || '').toUpperCase()) ? 'inactive' : 'pending'),
        frequency,
        send_time: sendTime,
        timezone: timeZone,
        send_day_of_week: sendDayOfWeek,
        send_day_of_month: sendDayOfMonth,
        send_week_of_month: null,
        next_run_at: calculateNextRunIso({ frequency, sendDayOfWeek, sendDayOfMonth, sendTime, timeZone }),
        next_renewal_date: nextRenewal,
        service_meta_json: metadata
    };
    if (service) {
        const { data: updated, error } = await supabase.from('client_services').update(serviceValues).eq('id', service.id).select().single();
        if (error) throw error;
        service = updated;
    } else {
        const { data: created, error } = await supabase.from('client_services').insert(serviceValues).select().single();
        if (error && String(error.code) === '23505') {
            const { data: concurrentService, error: concurrentError } = await supabase.from('client_services')
                .select('*').contains('service_meta_json', { paypal_subscription_id: subscriptionId }).limit(1).maybeSingle();
            if (concurrentError || !concurrentService) throw concurrentError || error;
            const { data: updated, error: updateError } = await supabase.from('client_services')
                .update(serviceValues).eq('id', concurrentService.id).select().single();
            if (updateError) throw updateError;
            service = updated;
        } else {
            if (error) throw error;
            service = created;
        }
    }
    service.clients = client;
    service.service_plans = plan;
    return { client, service, plan, catalogPlan };
}

async function sendWelcomeOnce(context) {
    const metadata = context.service.service_meta_json || {};
    if (metadata.welcome_email_sent_at) return false;
    const subscriptionId = metadata.paypal_subscription_id || context.service.id;
    const claim = await claimRelationshipMessage(context.client.id, context.service.id, 'subscription_welcome', String(subscriptionId));
    if (!claim.claimed) return false;
    const template = getWelcomeSubscriptionTemplate(context.service);
    const sent = await sendEmail(context.client.email, template.subject, template.html);
    if (!sent) {
        await finishRelationshipMessage(claim, false, 'Welcome email could not be sent');
        throw new Error('Welcome email could not be sent');
    }
    const sentAt = new Date().toISOString();
    const { data: latest } = await supabase.from('client_services').select('service_meta_json').eq('id', context.service.id).maybeSingle();
    context.service.service_meta_json = { ...(latest?.service_meta_json || metadata), welcome_email_sent_at: sentAt };
    const { error: markerError } = await supabase.from('client_services')
        .update({ service_meta_json: context.service.service_meta_json }).eq('id', context.service.id);
    if (markerError) console.warn(`[WELCOME] Metadata marker could not be saved: ${markerError.message}`);
    await finishRelationshipMessage(claim, true);
    return true;
}

async function processPendingWelcomeEmails(options = {}) {
    const requestedBatchSize = Number(options.batchSize);
    const batchSize = Number.isInteger(requestedBatchSize)
        ? Math.min(100, Math.max(1, requestedBatchSize))
        : 25;
    const { data: services, error } = await supabase.from('client_services')
        .select('*, clients(id, name, email), service_plans(id, name, price, default_frequency)')
        .eq('status', 'active')
        .not('service_meta_json->>paypal_subscription_id', 'is', null)
        .is('service_meta_json->>welcome_email_sent_at', null)
        .limit(batchSize);
    if (error) throw error;

    const result = { attempted: 0, sent: 0, skipped: 0, failed: 0 };
    for (const service of services || []) {
        const client = service.clients;
        if (!client?.id || !client.email) {
            result.skipped++;
            console.warn(`[WELCOME RETRY] Service ${service.id} has no deliverable client email`);
            continue;
        }

        result.attempted++;
        try {
            const sent = await sendWelcomeOnce({
                client,
                service,
                plan: service.service_plans || null
            });
            if (sent) result.sent++;
            else result.skipped++;
        } catch (error) {
            result.failed++;
            console.error(`[WELCOME RETRY] Service ${service.id} failed:`, error.message);
        }
    }
    return result;
}

async function claimRelationshipMessage(clientId, serviceId, messageType, occurrenceKey) {
    const payload = {
        client_id: clientId,
        client_service_id: serviceId || null,
        message_type: messageType,
        occurrence_key: occurrenceKey,
        status: 'processing',
        updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('client_relationship_messages').insert(payload).select('id').maybeSingle();
    if (!error && data) return { claimed: true, id: data.id, durable: true };
    if (String(error?.code) === '23505') {
        const { data: existing } = await supabase.from('client_relationship_messages').select('id, status, updated_at')
            .eq('client_id', clientId).eq('message_type', messageType).eq('occurrence_key', occurrenceKey).maybeSingle();
        const staleProcessing = existing?.status === 'processing'
            && Date.now() - new Date(existing.updated_at || 0).getTime() > 15 * 60 * 1000;
        if (existing?.status !== 'failed' && !staleProcessing) return { claimed: false, durable: true };
        let retryQuery = supabase.from('client_relationship_messages')
            .update({ status: 'processing', last_error: null, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        retryQuery = staleProcessing
            ? retryQuery.eq('status', 'processing').eq('updated_at', existing.updated_at)
            : retryQuery.eq('status', 'failed');
        const { data: retried, error: retryError } = await retryQuery.select('id').maybeSingle();
        return { claimed: Boolean(retried && !retryError), id: retried?.id, durable: true };
    }
    console.warn(`[CLIENT RELATIONS] Durable message claim unavailable: ${error?.message || 'unknown database error'}`);
    return { claimed: true, durable: false };
}

async function finishRelationshipMessage(claim, success, errorMessage = null) {
    if (!claim?.durable || !claim.id) return;
    await supabase.from('client_relationship_messages').update({
        status: success ? 'sent' : 'failed',
        sent_at: success ? new Date().toISOString() : null,
        last_error: success ? null : errorMessage,
        updated_at: new Date().toISOString()
    }).eq('id', claim.id);
}

async function processBirthdayGreetings(now = new Date()) {
    const { data: services, error } = await supabase.from('client_services')
        .select('id, timezone, service_meta_json, clients(id, name, email)').eq('status', 'active');
    if (error) throw error;
    const handledClients = new Set();
    let sent = 0;
    for (const service of services || []) {
        const client = service.clients;
        const meta = service.service_meta_json || {};
        if (!client?.email || handledClients.has(client.id)) continue;
        const local = getLocalCalendarParts(now, service.timezone || 'America/Jamaica');
        const leapDayObserved = Number(meta.birthday_month) === 2 && Number(meta.birthday_day) === 29
            && local.month === 2 && local.day === 28
            && new Date(Date.UTC(local.year, 1, 29)).getUTCMonth() !== 1;
        const birthdayMatches = (Number(meta.birthday_month) === local.month && Number(meta.birthday_day) === local.day) || leapDayObserved;
        if (!birthdayMatches || Number(meta.birthday_email_sent_year) === local.year) continue;
        handledClients.add(client.id);
        const claim = await claimRelationshipMessage(client.id, service.id, 'birthday', String(local.year));
        if (!claim.claimed) continue;
        const contactName = meta.contact_name || client.name;
        const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033"><div style="background:#0A1A3A;color:white;padding:28px;border-radius:16px 16px 0 0"><h1 style="margin:0;color:#00F5FF">Happy Birthday, ${escapeHtml(contactName)}!</h1></div><div style="padding:28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px"><p>Wishing you a wonderful birthday filled with good moments and continued success.</p><p>Thank you for trusting iCreate Solutions &amp; Services. We’re grateful to have you as part of our client family.</p><p>Warm wishes,<br><strong>iCreate Solutions &amp; Services</strong></p></div></div>`;
        const ok = await sendEmail(client.email, `Happy Birthday from iCreate Solutions & Services!`, html);
        if (ok) {
            await finishRelationshipMessage(claim, true);
            for (const clientService of (services || []).filter(candidate => candidate.clients?.id === client.id)) {
                const { data: latest } = await supabase.from('client_services').select('service_meta_json').eq('id', clientService.id).maybeSingle();
                await supabase.from('client_services').update({
                    service_meta_json: { ...(latest?.service_meta_json || clientService.service_meta_json || {}), birthday_email_sent_year: local.year }
                }).eq('id', clientService.id);
            }
            sent++;
        } else {
            await finishRelationshipMessage(claim, false, 'Birthday email could not be sent');
        }
    }
    return { sent };
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

module.exports = {
    ensureSubscriptionContext,
    sendWelcomeOnce,
    processPendingWelcomeEmails,
    processBirthdayGreetings,
    subscriberDetails
};
