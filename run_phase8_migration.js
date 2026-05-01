require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

async function runMigration() {
    try {
        console.log('Running Phase 8 Migration...');
        // Supabase JS doesn't natively run multiple raw DDL statements easily via the standard REST API
        // But we can try using RPC if a generic 'exec_sql' exists, or we can just try invoking the REST endpoints.
        // Actually, let's just use the pg module if it's installed.
        // Is pg installed? The package.json didn't list 'pg'.
        // We'll see if we can do it with RPC or just tell the user.

        // Actually, we ONLY need 2 simple ALTER TABLE commands. Let's try RPC if available:
        const { error } = await supabase.rpc('exec_sql', {
            query: `
                ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_billing_date DATE;
                ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL;
            `
        });

        if (error) {
            console.log('RPC failed (expected if generic exec_sql not installed):', error.message);
            console.log('\n--- PLEASE RUN THIS MANUALLY IN SUPABASE SQL EDITOR ---\n');
            console.log(fs.readFileSync('schema_accounting_phase8.sql', 'utf8'));
        } else {
            console.log('Migration successful via RPC!');
        }
    } catch (e) {
        console.error(e);
    }
}

runMigration();
