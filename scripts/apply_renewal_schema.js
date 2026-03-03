const fs = require('fs');
const supabase = require('../src/db'); // fixed path

async function run() {
    try {
        const sql = fs.readFileSync('./schema_subscription_renewals.sql', 'utf8');
        console.log('Running SQL...');

        const { Pool } = require('pg');
        require('dotenv').config();

        if (!process.env.DATABASE_URL) {
            console.error('DATABASE_URL is missing in .env');
            // Try to construct it from SUPABASE_URL if possible, or we could just use an RPC if available.
        } else {
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false }
            });
            const client = await pool.connect();
            await client.query(sql);
            client.release();
            console.log('SQL executed successfully via pg.');
            process.exit(0);
        }
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
