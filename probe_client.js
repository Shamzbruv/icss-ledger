const supabase = require('./src/db');

async function check() {
    const { data: client } = await supabase.from('clients').select('*').eq('email', 'CAMERON0910@GMAIL.COM').single();
    if (!client) {
        console.log('Client not found');
        return;
    }
    console.log('Client:', client);

    const { data: services } = await supabase.from('client_services').select('*').eq('client_id', client.id);
    console.log('\nServices:', services);

    const { data: invoices } = await supabase.from('invoices').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(5);
    console.log('\nRecent Invoices:', invoices.map(i => ({ id: i.id, invoice_number: i.invoice_number, status: i.status, payment_status: i.payment_status, amount_paid: i.amount_paid, created_at: i.created_at })));

    const { data: payments } = await supabase.from('payments').select('*').in('invoice_id', invoices.map(i => i.id));
    console.log('\nPayments:', payments);
}

check().catch(console.error);
