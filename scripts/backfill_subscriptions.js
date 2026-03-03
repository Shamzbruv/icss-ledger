require('dotenv').config();
const supabase = require('../src/db');
const { syncServiceActivation } = require('../src/services/subscriptionBillingService');

async function backfillSubscriptions() {
    console.log('--- STARTING SUBSCRIPTION BACKFILL ---');

    // Find all active services that don't have a next_billing_date yet
    const { data: services, error } = await supabase
        .from('client_services')
        .select('*')
        .eq('status', 'active')
        .is('next_billing_date', null);

    if (error) {
        console.error('Error fetching services to backfill:', error);
        process.exit(1);
    }

    if (!services || services.length === 0) {
        console.log('No subscriptions require backfilling. All are already synced.');
        process.exit(0);
    }

    console.log(`Found ${services.length} active subscriptions to sync...`);

    let successCount = 0;
    for (const service of services) {
        try {
            console.log(`Syncing subscription ${service.id} for client ${service.client_id}...`);
            await syncServiceActivation(service.id);
            successCount++;
        } catch (err) {
            console.error(`Failed to sync subscription ${service.id}:`, err.message);
        }
    }

    console.log(`--- BACKFILL COMPLETE: ${successCount}/${services.length} SYNCED ---`);
    process.exit(0);
}

backfillSubscriptions();
