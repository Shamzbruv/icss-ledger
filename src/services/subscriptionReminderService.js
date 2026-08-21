const supabase = require('../db');
const { addBillingPeriod } = require('./subscriptionBillingService');

// Subscription communication is event-driven. A server start, cron run, or
// date window must never send billing messages to customers.
async function processSubscriptionReminders(daysNotice = 7) {
    console.log(`[REMINDERS] Automatic subscription emails are disabled; ignored ${daysNotice}-day reminder check.`);
    return { success: true, processed: 0, disabled: true };
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
