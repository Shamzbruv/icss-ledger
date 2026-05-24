process.env.SUPABASE_URL = "https://bfhyuohoukpqvyfhqugm.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_qn5EaD-4JuCY2iT9JUuIQQ_0Rnh3b6F";

const supabase = require('./src/db');

async function fix() {
    const { data: client } = await supabase.from('clients').select('*').eq('id', '1caec460-30be-466a-87e0-b22372f66236').single();
    
    // Get next invoice number
    const { data: seqData } = await supabase.rpc('get_next_invoice_sequence');
    let nextSeq = seqData;
    if (!nextSeq) {
        const { data: recent } = await supabase.from('invoices').select('invoice_number').order('created_at', { ascending: false }).limit(1);
        if (recent && recent.length > 0) {
            const match = recent[0].invoice_number.match(/INV-ICSS-(\d+)/);
            if (match) nextSeq = parseInt(match[1], 10) + 1;
        }
        if (!nextSeq) nextSeq = 1214;
    }
    const invoiceNumber = `INV-ICSS-${String(nextSeq).padStart(3, '0')}`;
    
    const issueDate = new Date('2026-05-24T10:22:36.000Z');
    
    // Create Invoice
    const { data: invoice, error: invErr } = await supabase.from('invoices').insert({
        invoice_number: invoiceNumber,
        client_id: client.id,
        issue_date: issueDate.toISOString(),
        due_date: issueDate.toISOString(),
        status: 'paid',
        payment_status: 'PAID',
        notes: 'Automated Subscription Renewal',
        total_amount: 34.50,
        amount_paid: 34.50,
        remaining_amount: 0,
        balance_due: 0,
        payment_expected_type: 'FULL',
        payment_expected_percentage: 100,
        is_subscription: true,
        is_renewal: true,
        billing_cycle: 'monthly',
        plan_name: 'Professional Hosting',
        renewal_date: '2026-06-24T10:22:36.000Z',
        paid_at: issueDate.toISOString(),
        client_service_id: '6ba9a005-7d2e-45b8-8b15-54d76eda10c3' // Include the old service ID if needed, or null
    }).select().single();
    
    if (invErr) {
        console.error('Invoice error:', invErr);
        return;
    }
    
    // Create Invoice Item
    const { error: itemErr } = await supabase.from('invoice_items').insert({
        invoice_id: invoice.id,
        description: 'Professional Hosting Plan - May 2026',
        quantity: 1,
        unit_price: 34.50
    });
    if (itemErr) console.error('Item error:', itemErr);
    
    // Record Payment
    const { error: payErr } = await supabase.from('payments').insert({
        invoice_id: invoice.id,
        amount: 34.50,
        method: 'PayPal',
        reference_id: '7X775028YW121623P',
        payment_date: issueDate.toISOString()
    });
    if (payErr) console.error('Payment error:', payErr);
    
    console.log('Invoice created successfully:', invoiceNumber);
}
fix().then(() => process.exit(0)).catch(console.error);
