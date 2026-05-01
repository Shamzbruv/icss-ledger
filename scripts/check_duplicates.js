const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const supabase = require('../src/db');

async function findDuplicates() {
    console.log('Checking for duplicate clients...');
    const { data: clients, error } = await supabase
        .from('clients')
        .select('id, name, email, created_at')
        .order('created_at', { ascending: true }); // Oldest first

    if (error) {
        console.error('Error fetching clients:', error);
        return;
    }

    const emailMap = {};
    const duplicates = [];

    clients.forEach(c => {
        const email = c.email ? c.email.toLowerCase().trim() : 'no-email-' + c.id;
        if (emailMap[email]) {
            // Found a duplicate (since we ordered by created_at, this is the newer one)
            duplicates.push({
                email: email,
                keep: emailMap[email],
                remove: c
            });
        } else {
            emailMap[email] = c;
        }
    });

    if (duplicates.length === 0) {
        console.log('No duplicates found.');
    } else {
        console.log(`Found ${duplicates.length} duplicates to clean up:`);
        duplicates.forEach(d => {
            console.log(`- Keep: ${d.keep.name} (${d.keep.id}) | Remove: ${d.remove.name} (${d.remove.id})`);
        });
    }
}

findDuplicates();
