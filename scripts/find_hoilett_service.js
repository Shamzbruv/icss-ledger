const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgresql://postgres.bfhyuohoukpqvyfhqugm:Shambizonly1%40@aws-1-us-east-1.pooler.supabase.com:6543/postgres'
});

async function run() {
    await client.connect();

    console.log('Finding Mr. Hoilett...');
    const { rows: clients } = await client.query(`
        SELECT id, name FROM clients WHERE email = 'hoiletttech1@gmail.com'
    `);
    
    if (clients.length === 0) {
        console.error('Client not found!');
        process.exit(1);
    }
    
    const clientId = clients[0].id;
    
    console.log('Finding client services...');
    const { rows: services } = await client.query(`
        SELECT * 
        FROM client_services 
        WHERE client_id = $1
    `, [clientId]);
    
    console.table(services);

    if (services.length > 0) {
        const service = services[0];
        console.log('Creating invoice...');
        
        const invoiceNumber = 'INV-ICSS-' + Math.floor(1000 + Math.random() * 9000);
        
        const res = await client.query(`
            INSERT INTO invoices (
                client_id, client_service_id, invoice_number, issue_date, due_date, 
                total_amount, status, payment_status, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
            ) RETURNING id
        `, [
            clientId, 
            service.id,
            invoiceNumber,
            '2026-05-19', // The date of payment
            '2026-05-19', // Due same day
            43.70,        // Amount
            'paid',       // Status
            'PAID'        // Payment Status
        ]);
        
        console.log('Invoice created successfully! ID:', res.rows[0].id);
        console.log('Invoice Number:', invoiceNumber);
    }

    await client.end();
}

run().catch(console.error);
