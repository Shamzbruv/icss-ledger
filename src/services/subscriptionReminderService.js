const supabase = require('../db');
const { getSubscriptionRenewalTemplate } = require('./emailTemplates');
const { sendEmail } = require('./emailService');

/**
 * Checks for subscriptions that are renewing in `daysNotice` days (default 7)
 * and sends a reminder email if one hasn't been sent yet.
 */
async function processSubscriptionReminders(daysNotice = 7) {
    console.log(`[REMINDERS] Checking for subscriptions renewing in ${daysNotice} days...`);
    try {
        // Calculate the target renewal date
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + daysNotice);
        const targetDateStr = targetDate.toISOString().split('T')[0];

        // Find services matching the target date
        // that either haven't had a reminder OR the last reminder was before this cycle.
        const { data: services, error } = await supabase
            .from('client_services')
            .select(`
                *,
                clients (id, name, email),
                service_plans (id, name, price)
            `)
            .eq('status', 'active')
            .eq('next_renewal_date', targetDateStr);

        if (error) throw error;

        let sentCount = 0;

        for (const service of (services || [])) {
            // Check if reminder was already sent for this specific date
            if (service.last_renewal_reminder_sent_date === targetDateStr) {
                console.log(`[REMINDERS] Reminder already sent to ${service.clients.email} for renewal on ${targetDateStr}`);
                continue;
            }

            console.log(`[REMINDERS] Sending renewal reminder for ${service.clients.name} (${service.service_plans.name})`);

            try {
                // Generate Email
                const emailHtml = getSubscriptionRenewalTemplate(service);
                const subject = `Upcoming Subscription Renewal: ${service.service_plans.name}`;

                // Send Email via Resend structure
                const emailSent = await sendEmail(
                    service.clients.email,
                    subject,
                    emailHtml,
                    'iCreate Solutions <no-reply@icreatesolutionsandservices.com>',
                    'Shamzbiz1@gmail.com'
                );

                if (emailSent) {
                    // Update DB securely
                    await supabase
                        .from('client_services')
                        .update({ last_renewal_reminder_sent_date: targetDateStr })
                        .eq('id', service.id);

                    sentCount++;
                }

            } catch (emailErr) {
                console.error(`[REMINDERS] Error sending to ${service.clients.email}:`, emailErr.message);
            }
        }

        console.log(`[REMINDERS] Processed ${sentCount} reminders.`);
        return { success: true, processed: sentCount, targetDate: targetDateStr };

    } catch (err) {
        console.error('[REMINDERS] Critical error checking renewals:', err.message);
        return { success: false, error: err.message };
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
            .select('*')
            .eq('status', 'active')
            .lte('next_renewal_date', todayStr);

        if (error) throw error;

        let advancedCount = 0;

        for (const service of (services || [])) {
            if (!service.next_renewal_date) continue;

            const currentDate = new Date(service.next_renewal_date);
            // Add 1 month
            currentDate.setMonth(currentDate.getMonth() + 1);
            const newDateStr = currentDate.toISOString().split('T')[0];

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
