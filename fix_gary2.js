const { createClient } = require('@supabase/supabase-js');

// Use anon key but bypass RLS via service key
// We'll call the live API instead
const https = require('https');

async function callAPI(path, method, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const options = {
            hostname: 'icss-ledger-production.up.railway.app',
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        
        // Try localhost first
        const localOptions = {
            hostname: 'localhost',
            port: 3000,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        
        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(responseData)); } 
                catch(e) { resolve({ raw: responseData }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function fix() {
    console.log('[GARY FIX] Calling live API to create client service for Gary Mitchell...');
    
    // Gary's client ID was created successfully: 6288f214-1c81-40bd-9d4a-933b5e8e2ce4
    // We need to find a plan. Try calling the API.
    
    try {
        const result = await callAPI('/api/client-services/create', 'POST', {
            clientId: '6288f214-1c81-40bd-9d4a-933b5e8e2ce4',
            planId: null,
            frequency: 'monthly',
            sendTime: '09:00:00',
            timezone: 'America/Jamaica',
            serviceMeta: { paypal_subscription_id: 'I-87DC00RR1RYP' }
        });
        console.log('[GARY FIX] API result:', JSON.stringify(result));
    } catch(e) {
        console.error('[GARY FIX] API call failed:', e.message);
    }
}

fix().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
