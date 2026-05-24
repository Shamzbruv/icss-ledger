process.env.SUPABASE_URL = "https://bfhyuohoukpqvyfhqugm.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_qn5EaD-4JuCY2iT9JUuIQQ_0Rnh3b6F";

const supabase = require('./src/db');

async function check() {
    const { data: webhooks } = await supabase.from('paypal_webhook_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
    console.log('Recent Webhooks:', webhooks.map(w => ({ id: w.paypal_event_id, event: w.event_type, status: w.status, error: w.last_error })));
}

check().then(() => process.exit(0)).catch(console.error);
