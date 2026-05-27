process.env.SUPABASE_URL = "https://bfhyuohoukpqvyfhqugm.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_qn5EaD-4JuCY2iT9JUuIQQ_0Rnh3b6F";

const supabase = require('./src/db');

async function fix() {
    console.log('[GARY FIX] Starting...');

    // 1. Find or create Gary Mitchell
    let { data: client } = await supabase.from('clients').select('*').ilike('email', 'gtdiagularm@gmail.com').single();
    if (!client) {
        const { data: defaultComp } = await supabase.from('companies').select('id').limit(1).single();
        const { data: newClient, error: ce } = await supabase.from('clients').insert({
            name: 'Gary Mitchell',
            email: 'gtdiagularm@gmail.com',
            company_id: defaultComp ? defaultComp.id : null
        }).select().single();
        if (ce) { console.error('Client create error:', ce); return; }
        client = newClient;
        console.log('[GARY FIX] Created client:', client.id);
    } else {
        console.log('[GARY FIX] Found existing client:', client.id);
    }

    // 2. Check if service exists
    let { data: existingSvc } = await supabase.from('client_services').select('*').eq('client_id', client.id).eq('status', 'active').single();
    let serviceId;

    if (!existingSvc) {
        // Match plan by price $78.19
        const { data: allPlans } = await supabase.from('service_plans').select('*');
        let plan = allPlans ? allPlans.find(p => Math.abs(Number(p.price) - 78.19) < 1) : null;
        if (!plan && allPlans && allPlans.length > 0) plan = allPlans[0];
        console.log('[GARY FIX] Matched plan:', plan ? plan.name : 'none (will use null)');

        const nextRenewal = new Date('2026-06-26');
        const { data: newSvc, error: svcErr } = await supabase.from('client_services').insert({
            client_id: client.id,
            plan_id: plan ? plan.id : null,
            status: 'active',
            frequency: 'monthly',
            send_time: '09:00:00',
            timezone: 'America/Jamaica',
            service_meta_json: { paypal_subscription_id: 'I-87DC00RR1RYP' },
            next_renewal_date: nextRenewal.toISOString().split('T')[0]
        }).select('*, clients(id, name, email), service_plans(id, name, price, default_frequency)').single();

        if (svcErr) { console.error('[GARY FIX] Service create error:', svcErr); return; }
        serviceId = newSvc.id;
        console.log('[GARY FIX] Created client_service:', serviceId);
    } else {
        serviceId = existingSvc.id;
        console.log('[GARY FIX] Service already exists:', serviceId);
    }

    // 3. Check for existing invoice
    const { data: existingInvoice } = await supabase.from('invoices').select('id,invoice_number,status').eq('client_id', client.id).order('created_at', { ascending: false }).limit(1).single();
    if (existingInvoice) {
        console.log('[GARY FIX] Existing invoice found:', existingInvoice.invoice_number, existingInvoice.status);
    }

    // 4. Manually create the paid invoice for 5/26 payment
    const { data: seqData } = await supabase.rpc('get_next_invoice_sequence');
    let nextSeq = seqData;
    if (!nextSeq) {
        const { data: recent } = await supabase.from('invoices').select('invoice_number').order('created_at', { ascending: false }).limit(1);
        if (recent && recent.length > 0) {
            const match = recent[0].invoice_number.match(/INV-ICSS-(\d+)/);
            if (match) nextSeq = parseInt(match[1], 10) + 1;
        }
        if (!nextSeq) nextSeq = 100;
    }
    const invoiceNumber = `INV-ICSS-${String(nextSeq).padStart(3, '0')}`;
    const issueDate = new Date('2026-05-26T17:23:05.000Z');

    const { data: invoice, error: invErr } = await supabase.from('invoices').insert({
        invoice_number: invoiceNumber,
        client_id: client.id,
        client_service_id: serviceId,
        issue_date: issueDate.toISOString(),
        due_date: issueDate.toISOString(),
        status: 'paid',
        payment_status: 'PAID',
        notes: 'Automated Subscription Renewal',
        total_amount: 78.19,
        amount_paid: 78.19,
        remaining_amount: 0,
        balance_due: 0,
        payment_expected_type: 'FULL',
        payment_expected_percentage: 100,
        is_subscription: true,
        is_renewal: false,
        billing_cycle: 'monthly',
        plan_name: 'Website Content Refresh',
        renewal_date: '2026-06-26T17:23:05.000Z',
        paid_at: issueDate.toISOString()
    }).select().single();

    if (invErr) { console.error('[GARY FIX] Invoice error:', invErr); return; }
    console.log('[GARY FIX] Invoice created:', invoiceNumber);

    await supabase.from('invoice_items').insert({
        invoice_id: invoice.id,
        description: 'Website Content Refresh - May 2026',
        quantity: 1,
        unit_price: 78.19
    });

    console.log('[GARY FIX] Done! Now open the dashboard and hit RESEND on', invoiceNumber, 'to email Gary his receipt.');
    console.log('[GARY FIX] Also manually send Gary a welcome email from the dashboard or via the welcome email route.');
}

fix().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
