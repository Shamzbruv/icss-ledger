// scripts/backfill_invoices.js
require('dotenv').config();
const supabase = require('../src/db');
const { handleInvoiceEvent } = require('../src/services/postingRulesService');

async function runBackfill() {
    console.log('--- STARTING INVOICE BACKFILL ---');

    try {
        // Get the default company
        const { data: comp } = await supabase.from('companies').select('id, name').limit(1).single();
        if (!comp) throw new Error("No default company found");
        console.log(`Backfilling for company: ${comp.name} (${comp.id})`);

        // Fetch all invoices
        const { data: invoices, error } = await supabase.from('invoices').select(`
            *,
            clients ( name )
        `);
        if (error) throw error;

        console.log(`Found ${invoices.length} invoices to process.`);

        let successCount = 0;
        let skipCount = 0;

        for (const inv of invoices) {
            try {
                // Determine 'client_name' needed by the projector
                const payload = {
                    ...inv,
                    client_name: inv.clients?.name || 'Unknown Client',
                    payment_method: inv.payment_method || 'bank'
                };

                // Emit INVOICE_CREATED
                console.log(`Processing Invoice ${inv.reference_code}: INVOICE_CREATED`);
                await handleInvoiceEvent(comp.id, payload, 'INVOICE_CREATED');

                // If paid, emit PAYMENT_APPLIED
                if (inv.status === 'paid') {
                    console.log(`Processing Invoice ${inv.reference_code}: PAYMENT_APPLIED`);
                    // We bump the event_version virtually by 1 to ensure uniqueness in idempotent log
                    // The handleInvoiceEvent uses the invoice's updated_at or hardcoded logic,
                    // but for backfill we might need to simulate versions or rely on the projector handling.
                    // Actually, handleInvoiceEvent manages versions by looking at current state.
                    await handleInvoiceEvent(comp.id, payload, 'PAYMENT_APPLIED');
                } else if (inv.status === 'partial') {
                    console.log(`Processing Invoice ${inv.reference_code}: DEPOSIT_PRE_SERVICE`);
                    await handleInvoiceEvent(comp.id, payload, 'DEPOSIT_PRE_SERVICE');
                }

                successCount++;
            } catch (err) {
                // If it's an idempotency skip, that's fine
                if (err.message.includes('already processed')) {
                    console.log(`  Skipped Invoice ${inv.reference_code}: Already processed.`);
                    skipCount++;
                } else {
                    console.error(`  Error processing Invoice ${inv.reference_code}:`, err.message);
                }
            }
        }

        console.log('\n--- BACKFILL COMPLETE ---');
        console.log(`Successfully processed: ${successCount} invoices.`);
        console.log(`Skipped (already in ledger): ${skipCount} invoices.`);

    } catch (e) {
        console.error('Backfill failed:', e);
    }
}

runBackfill();
