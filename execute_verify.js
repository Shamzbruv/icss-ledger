require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);

async function verify() {
    console.log('Verifying Database State...');

    // 1. Check Companies
    try {
        const { data: companies, error: compError } = await supabase.from('companies').select('*');
        if (compError) console.error('Error fetching companies:', compError.message);
        else console.log(`Companies found: ${companies.length}`);
        if (companies.length > 0) console.log('Sample Company:', companies[0]);
    } catch (e) {
        console.error('Exception fetching companies:', e.message);
    }

    // 2. Check Service Plans
    try {
        const { data: plans, error: planError } = await supabase.from('service_plans').select('*');
        if (planError) console.error('Error fetching service plans:', planError.message);
        else console.log(`Service Plans found: ${plans.length}`);
        if (plans.length > 0) console.log('Sample Plan:', plans[0]);
    } catch (e) {
        console.error('Exception fetching service plans:', e.message);
    }

    // 3. Check Clients
    try {
        const { count, error: clientError } = await supabase.from('clients').select('*', { count: 'exact', head: true });
        if (clientError) console.error('Error fetching clients:', clientError.message);
        else console.log(`Clients found: ${count}`);
    } catch (e) {
        console.error('Exception fetching clients:', e.message);
    }

    // 4. Check Invoices
    try {
        const { count, error: invError } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
        if (invError) console.error('Error fetching invoices:', invError.message);
        else console.log(`Invoices found: ${count}`);
    } catch (e) {
        console.error('Exception fetching invoices:', e.message);
    }

    // 5. Check Client Services
    try {
        const { count, error: svcError } = await supabase.from('client_services').select('*', { count: 'exact', head: true });
        if (svcError) console.error('Error fetching client services:', svcError.message);
        else console.log(`Client Services found: ${count}`);
    } catch (e) {
        console.error('Exception fetching client services:', e.message);
    }
}

verify();
