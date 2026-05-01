require('dotenv').config();
const supabase = require('./src/db');
const { processSubscriptionReminders } = require('./src/services/subscriptionReminderService');

async function check() {
    console.log('--- DB STATE ---');
    const { data: services, error } = await supabase
        .from('client_services')
        .select(`
            id, status, next_renewal_date, last_renewal_reminder_sent_date,
            clients (email, name),
            service_plans (name)
        `)
        .eq('status', 'active');

    if (error) {
        console.error('DB Error:', error);
    } else {
        console.log(`Found ${services.length} active services`);
        console.log(services);
    }

    console.log('\n--- TARGET DATE CALCULATION (7 days) ---');
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 7);
    const targetDateStr = targetDate.toISOString().split('T')[0];
    console.log('Local current time:', new Date().toString());
    console.log('Local target time:', targetDate.toString());
    console.log('UTC targetDateStr (used in query):', targetDateStr);

    console.log('\n--- RUNNING REMINDER SERVICE (dry run ideally, but let\'s see what it logs) ---');
    // I can't easily dry-run without modifying the service, but let's just run it
    // Wait, running it will actually send emails if any match. I'll just rely on the DB output to see what would match.
}

check();
