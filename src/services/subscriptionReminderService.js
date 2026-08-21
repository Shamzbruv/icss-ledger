const supabase = require('../db');
const { getSubscriptionRenewalTemplate } = require('./emailTemplates');
const { sendEmail } = require('./emailService');
const { addBillingPeriod } = require('./subscriptionBillingService');
const { getLatestVerifiedPayPalEvent, isRenewalEligibleEvent } = require('./paypalEventGateService');

async function processSubscriptionReminders(daysNotice = 7) {
    console.log(`[REMINDERS] Checking PayPal-verified subscriptions renewing within ${daysNotice} days...`);
    try {
        const targetDate = new Date();
        targetDate.setUTCDate(targetDate.getUTCDate() + daysNotice);
        const targetDateStr = targetDate.toISOString().split('T')[0];
        const todayStr = new Date().toISOString().split('T')[0];

        const { data: services, error } = await supabase
            .from('client_services')
            .select(`
                *,
                clients (id, name, email),
                service_plans (id, name, price, billing_cycle, default_frequency)
            `)
            .eq('status', 'active')
            .gte('next_renewal_date', todayStr)
            .lte('next_renewal_date', targetDateStr);
        if (error) throw error;

        const result = { success: true, processed: 0, skippedUnverified: 0, targetDate: targetDateStr };
        for (const service of services || []) {
            if (!service.next_renewal_date || !service.clients?.email) continue;
            if (service.last_renewal_reminder_sent_date === service.next_renewal_date) continue;

            const subscriptionId = service.service_meta_json?.paypal_subscription_id;
            if (!subscriptionId) {
                result.skippedUnverified++;
                console.warn(`[REMINDERS] Skipping service ${service.id}: no correlated PayPal subscription ID.`);
                continue;
            }

            const latestPayPalEvent = await getLatestVerifiedPayPalEvent(service);
            if (!isRenewalEligibleEvent(latestPayPalEvent?.event_type)) {
                result.skippedUnverified++;
                console.warn(`[REMINDERS] Skipping service ${service.id}: latest verified PayPal event is ${latestPayPalEvent?.event_type || 'missing'}.`);
                continue;
            }

            try {
                const emailSent = await sendEmail(
                    service.clients.email,
                    `Upcoming Subscription Renewal: ${service.service_plans?.name || 'Subscription'}`,
                    getSubscriptionRenewalTemplate(service),
                    'iCreate Solutions <no-reply@icreatesolutionsandservices.com>',
                    null
                );
                if (!emailSent) continue;

                const { error: markerError } = await supabase
                    .from('client_services')
                    .update({ last_renewal_reminder_sent_date: service.next_renewal_date })
                    .eq('id', service.id);
                if (markerError) throw markerError;
                result.processed++;
            } catch (emailError) {
                console.error(`[REMINDERS] Service ${service.id} failed:`, emailError.message);
            }
        }

        return result;
    } catch (error) {
        console.error('[REMINDERS] Critical error checking renewals:', error.message);
        return { success: false, processed: 0, error: error.message };
    }
}

/**
 * Automatically advances the renewal date by 1 month for subscriptions
 * whose renewal date is today or in the past.
 */
async function autoAdvanceRenewalDates() {
    console.log(`[RENEWALS] Checking for subscriptions that need date advancement...`);
    try {
        const todayStr = new Date().toISOString().split('T')[0];

        // Find active services where next_renewal_date <= today
        const { data: services, error } = await supabase
            .from('client_services')
            .select('*, service_plans(default_frequency)')
            .eq('status', 'active')
            .lte('next_renewal_date', todayStr);

        if (error) throw error;

        let advancedCount = 0;

        for (const service of (services || [])) {
            if (!service.next_renewal_date) continue;
            // PayPal is authoritative for managed subscriptions. Advancing an
            // overdue date locally would hide an unconfirmed/failed renewal;
            // the verified payment webhook updates these dates instead.
            if (service.service_meta_json?.paypal_subscription_id) continue;

            const currentDate = new Date(service.next_renewal_date);
            const cycle = service.service_plans?.default_frequency === 'yearly'
                || service.frequency === 'yearly'
                ? 'yearly'
                : 'monthly';
            const nextDate = addBillingPeriod(currentDate, cycle);
            const newDateStr = nextDate.toISOString().split('T')[0];

            console.log(`[RENEWALS] Auto-advancing ${service.id} from ${service.next_renewal_date} to ${newDateStr}`);

            try {
                // Update DB securely
                await supabase
                    .from('client_services')
                    .update({ next_renewal_date: newDateStr })
                    .eq('id', service.id);

                advancedCount++;
            } catch (updateErr) {
                console.error(`[RENEWALS] Error advancing date for ${service.id}:`, updateErr.message);
            }
        }

        console.log(`[RENEWALS] Auto-advanced ${advancedCount} subscriptions.`);
        return { success: true, advanced: advancedCount };

    } catch (err) {
        console.error('[RENEWALS] Critical error advancing renewals:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    processSubscriptionReminders,
    autoAdvanceRenewalDates
};
