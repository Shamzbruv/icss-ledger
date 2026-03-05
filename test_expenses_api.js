require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function testApi() {
    try {
        console.log('Fetching company...');
        const { data: comps } = await supabase.from('companies').select('id').limit(1);
        const cid = comps[0].id;

        console.log('Testing GET expenses...');
        const res = await fetch(`http://localhost:3000/api/accounting/expenses?company_id=${cid}`);
        if (!res.ok) throw new Error('Failed GET ' + await res.text());
        console.log('GET ok');

        console.log('Testing POST new expense...');
        const postRes = await fetch(`http://localhost:3000/api/accounting/expenses?company_id=${cid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                expense_type: 'cash',
                expense_date: '2025-01-01',
                vendor: 'Test API Vendor',
                description: 'Test API Desc',
                coa_account_code: '5000',
                currency: 'JMD',
                total_amount: 100,
                gct_amount: 0
            })
        });
        if (!postRes.ok) throw new Error('Failed POST ' + await postRes.text());
        const created = (await postRes.json()).expense;
        console.log('POST ok, id:', created.id);

        console.log('Testing PUT edit expense...');
        const putRes = await fetch(`http://localhost:3000/api/accounting/expenses/${created.id}?company_id=${cid}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...created,
                total_amount: 150,
                vendor: 'Tested vendor'
            })
        });
        if (!putRes.ok) throw new Error('Failed PUT ' + await putRes.text());
        console.log('PUT ok');

        console.log('Testing DELETE expense...');
        const delRes = await fetch(`http://localhost:3000/api/accounting/expenses/${created.id}?company_id=${cid}`, {
            method: 'DELETE'
        });
        if (!delRes.ok) throw new Error('Failed DELETE ' + await delRes.text());
        console.log('DELETE ok');

        console.log('All tests passed natively via API!');
    } catch (err) {
        console.error('Test failed:', err);
    }
}
testApi();
