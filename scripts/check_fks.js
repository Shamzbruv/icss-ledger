const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgresql://postgres.bfhyuohoukpqvyfhqugm:Shambizonly1%40@aws-1-us-east-1.pooler.supabase.com:6543/postgres'
});

async function run() {
    await client.connect();

    console.log('Checking foreign key constraints on clients table...');
    const fks = await client.query(`
        SELECT
            tc.table_name, 
            kcu.column_name, 
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            rc.update_rule,
            rc.delete_rule
        FROM 
            information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints AS rc
              ON rc.constraint_name = tc.constraint_name
        WHERE ccu.table_name = 'clients';
    `);
    
    console.table(fks.rows);
    
    console.log('Checking if invoices.client_id is nullable...');
    const columns = await client.query(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'invoices' AND column_name = 'client_id';
    `);
    console.table(columns.rows);
    
    // If client_id is not nullable, we should alter it
    if (columns.rows[0].is_nullable === 'NO') {
        console.log('Altering invoices.client_id to be NULLABLE...');
        await client.query(`ALTER TABLE invoices ALTER COLUMN client_id DROP NOT NULL;`);
        console.log('Altered invoices.client_id successfully.');
    }
    
    // Also check client_services delete rule
    const clientServicesFk = fks.rows.find(row => row.table_name === 'client_services');
    if (clientServicesFk && clientServicesFk.delete_rule !== 'CASCADE') {
        console.log('Client services delete rule is not CASCADE. Need to update it, or we will have to set it to NULL/delete manually.');
    }
    
    await client.end();
    console.log('Done.');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
