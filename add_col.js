require('dotenv').config();
const supabase = require('./src/db');

async function addColumn() {
    const { data, error } = await supabase.rpc('execute_sql', { sql: 'ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_notification_sent BOOLEAN DEFAULT false;' });
    if (error) {
        console.error("Error with rpc, falling back to direct query or ignoring:", error);
    } else {
        console.log("Column added successfully!");
    }
}
addColumn();
