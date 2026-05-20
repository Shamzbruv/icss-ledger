const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://bfhyuohoukpqvyfhqugm.supabase.co',
    // Using service key from Railway env screenshot - user must paste this in
    process.env.SUPABASE_SERVICE_KEY || 'PASTE_SERVICE_KEY_HERE'
);

async function run() {
    console.log('\n=== LAST 20 PAYPAL WEBHOOK EVENTS ===');
    const { data: events, error: evErr } = await supabase
        .from('paypal_webhook_events')
        .select('id, paypal_event_id, event_type, custom_id, status, last_error, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

    if (evErr) {
        console.error('Error fetching events:', evErr.message);
        console.error('Full error:', JSON.stringify(evErr, null, 2));
    } else {
        console.table(events);
    }

    console.log('\n=== KAMILLE CLIENT LOOKUP ===');
    const { data: clients, error: cErr } = await supabase
        .from('clients')
        .select('id, name, email')
        .ilike('email', '%kgardnerhoilett%');

    if (cErr) console.error('Client error:', cErr.message);
    else console.table(clients);

    if (clients && clients.length > 0) {
        const { data: services } = await supabase
            .from('client_services')
            .select('id, plan_name, status, next_renewal_date, next_billing_date')
            .eq('client_id', clients[0].id);
        console.log('\n=== CLIENT SERVICES ===');
        console.table(services);

        const { data: invoices } = await supabase
            .from('invoices')
            .select('id, invoice_number, status, payment_status, total_amount, created_at')
            .eq('client_id', clients[0].id)
            .order('created_at', { ascending: false })
            .limit(5);
        console.log('\n=== RECENT INVOICES ===');
        console.table(invoices);
    }
}

run().catch(console.error);
