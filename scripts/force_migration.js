const { Client } = require('pg');
require('dotenv').config();

// The Supabase URL is usually something like https://xxxxx.supabase.co
// Connection string format for Postgres: postgresql://postgres.[project-ref]:[db-password]@aws-0-[region].pooler.supabase.com:5432/postgres

// Because we don't have the direct DB password in env (only service role keys usually),
// I will check if DATABASE_URL or something similar exists in .env
console.log('Env variables available:', Object.keys(process.env));

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!dbUrl) {
    console.error('Cannot run raw DDL because no DATABASE_URL connection string found in .env. We only have SUPABASE_URL which is the REST API.');
    process.exit(1);
}

const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
});

async function runSQL() {
    try {
        await client.connect();
        console.log('Connected to DB...');
        const result = await client.query(`
            ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_billing_date DATE;
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL;
        `);
        console.log('Migration successful:', result);
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.end();
    }
}

runSQL();
