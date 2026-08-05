const { Client } = require('pg');
require('dotenv').config();

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!dbUrl) {
    console.error('Set SUPABASE_DB_URL or DATABASE_URL before running this migration.');
    process.exit(1);
}
if (!process.argv.includes('--apply')) {
    console.error('No changes made. Re-run with --apply after reviewing this script.');
    process.exit(1);
}

const client = new Client({
    connectionString: dbUrl,
    ssl: /localhost|127\.0\.0\.1/.test(dbUrl) ? false : { rejectUnauthorized: false }
});

async function runSQL() {
    try {
        await client.connect();
        await client.query('BEGIN');
        await client.query('ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_billing_date DATE;');
        await client.query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL;');
        await client.query('COMMIT');
        console.log('Migration completed successfully.');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Migration failed:', err.message || err);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
}

runSQL();
