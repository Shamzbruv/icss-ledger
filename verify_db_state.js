require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);

async function verify() {
    console.log('Verifying Database State...');

    // 1. Check Companies
    try {
        const { data: companies, error: compError } = await supabase.from('companies').select('*');
        if (compError) console.error('Error fetching companies:', compError.message);
        else console.log(`Companies found: ${companies.length}`, companies);
    } catch (e) { console.error('Exception fetching companies:', e.message); }

    // 2. Check Clients
    try {
        const { data: clients, error: clientError } = await supabase.from('clients').select('*');
        if (clientError) console.error('Error fetching clients:', clientError.message);
        else console.log(`Clients found: ${clients.length}`, clients);
    } catch (e) { console.error('Exception fetching clients:', e.message); }

    // 3. Check Invoices
    try {
        const { data: invoices, error: invError } = await supabase.from('invoices').select('*');
        if (invError) console.error('Error fetching invoices:', invError.message);
        else console.log(`Invoices found: ${invoices.length}`);
    } catch (e) { console.error('Exception fetching invoices:', e.message); }
}

verify();
