const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const supabase = require('../src/db');

async function inspectTable() {
    console.log('Inspecting clients table...');
    const { data, error } = await supabase
        .from('clients')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching clients:', error);
    } else {
        if (data.length > 0) {
            console.log('Columns:', Object.keys(data[0]));
            // Also list all emails to see duplicates
            const { data: allClients } = await supabase.from('clients').select('id, name, email');

            const emailMap = {};
            const dupes = [];
            allClients.forEach(c => {
                const e = c.email.trim().toLowerCase();
                if (emailMap[e]) dupes.push(e);
                emailMap[e] = true;
            });
            console.log('Duplicate Emails Found:', dupes);
        } else {
            console.log('Table is empty.');
        }
    }
}

inspectTable();
