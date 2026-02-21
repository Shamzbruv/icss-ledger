const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const supabase = require('../src/db');

async function cleanDuplicates() {
    console.log('Cleaning up duplicate clients...');
    const { data: clients, error } = await supabase
        .from('clients')
        .select('*'); // No order by created_at since it's missing

    if (error) {
        console.error('Error fetching clients:', error);
        return;
    }

    const emailMap = {};
    const toRemove = [];

    // Simple strategy: Keep the one with the most fields filled, or if equal, just the first one encountered (which is arbitrary without created_at, but sufficient for cleaning)
    // Actually, UUIDs might be roughly sequential if v1, but generic v4 are random.
    // If we can't determine age, we should check which one has invoices?

    // Let's fetch invoice counts for each client
    const clientUsage = {};

    console.log('Fetching invoice usage...');
    const { data: invoices } = await supabase.from('invoices').select('client_id');
    invoices.forEach(inv => {
        clientUsage[inv.client_id] = (clientUsage[inv.client_id] || 0) + 1;
    });

    clients.forEach(c => {
        const e = c.email.trim().toLowerCase();
        if (emailMap[e]) {
            // Compare usage
            const currentUsage = clientUsage[c.id] || 0;
            const existingUsage = clientUsage[emailMap[e].id] || 0;

            if (currentUsage > existingUsage) {
                // New one has more usage, keep new, mark old for removal
                toRemove.push(emailMap[e]);
                emailMap[e] = c;
            } else {
                // Keep existing, mark new for removal
                toRemove.push(c);
            }
        } else {
            emailMap[e] = c;
        }
    });

    if (toRemove.length > 0) {
        console.log(`Found ${toRemove.length} duplicates to remove.`);

        for (const client of toRemove) {
            console.log(`Removing client: ${client.name} (${client.email}) ID: ${client.id}`);
            // Check if it has ANY invoices
            const usage = clientUsage[client.id] || 0;
            if (usage > 0) {
                console.log(`WARNING: Client has ${usage} invoices. Reassigning them to the kept client...`);
                const keptClient = emailMap[client.email.trim().toLowerCase()];
                if (keptClient) {
                    const { error: updateError } = await supabase
                        .from('invoices')
                        .update({ client_id: keptClient.id })
                        .eq('client_id', client.id);

                    if (updateError) console.error('Error reassigning invoices:', updateError);
                    else console.log(`Reassigned invoices to ${keptClient.id}`);
                }
            }

            const { error: delError } = await supabase.from('clients').delete().eq('id', client.id);
            if (delError) console.error('Error deleting:', delError);
            else console.log('Deleted.');
        }
    } else {
        console.log('No duplicates found.');
    }
}

cleanDuplicates();
