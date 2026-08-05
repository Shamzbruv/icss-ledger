const { Client } = require('pg');
require('dotenv').config();

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) {
    console.error('Set SUPABASE_DB_URL or DATABASE_URL before running this diagnostic.');
    process.exit(1);
}

const shouldApply = process.argv.includes('--apply');
const client = new Client({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false }
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
        FROM information_schema.table_constraints AS tc
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

    console.log('Checking whether invoices.client_id is nullable...');
    const columns = await client.query(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'invoices'
          AND column_name = 'client_id';
    `);
    console.table(columns.rows);

    if (columns.rows[0]?.is_nullable === 'NO' && shouldApply) {
        console.log('Altering invoices.client_id to be nullable...');
        await client.query('ALTER TABLE invoices ALTER COLUMN client_id DROP NOT NULL;');
        console.log('Altered invoices.client_id successfully.');
    } else if (columns.rows[0]?.is_nullable === 'NO') {
        console.log('No change made. Re-run with --apply to make invoices.client_id nullable.');
    }

    const clientServicesFk = fks.rows.find(row => row.table_name === 'client_services');
    if (clientServicesFk && clientServicesFk.delete_rule !== 'CASCADE') {
        console.log('client_services does not currently cascade client deletion.');
    }

    await client.end();
    console.log('Done.');
}

run().catch(async err => {
    console.error(err.message || err);
    await client.end().catch(() => {});
    process.exit(1);
});
