const fs = require('fs');
const pool = require('./src/db');
const path = require('path');

async function run() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'schema_leads.sql'), 'utf8');
        console.log('Running migration...');
        await pool.query(sql);
        console.log('Migration successful.');
        process.exit(0);
    } catch (e) {
        console.error('Migration failed:', e);
        process.exit(1);
    }
}
run();
