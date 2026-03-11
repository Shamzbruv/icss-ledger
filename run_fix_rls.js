require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);

async function runFixRLS() {
    try {
        console.log('Attempting to apply RLS fix...');

        const sqlQuery = fs.readFileSync('fix_rls.sql', 'utf8');

        // Attempt to use a generic 'exec_sql' RPC if available
        const { error } = await supabase.rpc('exec_sql', { query: sqlQuery });

        if (error) {
            console.log('RPC failed (expected if generic exec_sql not installed):', error.message);
            console.log('\n======================================================');
            console.log(' PLEASE RUN THIS MANUALLY IN SUPABASE SQL EDITOR      ');
            console.log('======================================================\n');
            console.log(sqlQuery);
            console.log('\n======================================================');
            console.log(' Copy and paste the above SQL into the Supabase Dashboard -> SQL Editor and click Run.');
            console.log(' This will secure your database and resolve the 12 security errors.');
            console.log('======================================================\n');
        } else {
            console.log('Successfully enabled RLS via RPC!');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

runFixRLS();
