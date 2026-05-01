const crypto = require('crypto');
const fs = require('fs');
const supabase = require('./src/db');
const { projectAccountingEvent } = require('./src/services/postingRulesService');
const { getJournalLinesForPeriod } = require('./src/services/reportingService');

fs.writeFileSync('test_results.txt', '');
function log(msg) {
    fs.appendFileSync('test_results.txt', msg + '\n');
}

async function getCompanyId() {
    const { data: company } = await supabase.from('companies').select('id').limit(1).single();
    if (!company) throw new Error("No company found to run tests against.");
    return company.id;
}

async function runTests() {
    try {
        log("Starting Accounting V2 Verification Tests...");
        const companyId = await getCompanyId();
        log(`Testing against company_id: ${companyId}`);

        // Test 1: Journal Balancing Invariant Test
        log("\n--- Test 1: Journal Balancing Invariant ---");
        const lines = await getJournalLinesForPeriod(companyId, '2000-01-01', '2099-12-31');
        let totalDebits = 0;
        let totalCredits = 0;
        lines.forEach(l => {
            totalDebits += Number(l.debit || 0);
            totalCredits += Number(l.credit || 0);
        });

        totalDebits = Math.round(totalDebits * 100) / 100;
        totalCredits = Math.round(totalCredits * 100) / 100;

        if (totalDebits === totalCredits) {
            log(`✅ PASS: Ledger is perfectly balanced. Total Debits: ${totalDebits} | Total Credits: ${totalCredits}`);
        } else {
            log(`❌ FAIL: Ledger is out of balance! Debits: ${totalDebits} | Credits: ${totalCredits}`);
        }

        // Test 2: Idempotency Test
        log("\n--- Test 2: Idempotency Test ---");
        const mockEventId = crypto.randomUUID();
        const mockInvoiceId = crypto.randomUUID();

        const testEvent = {
            id: mockEventId,
            company_id: companyId,
            source_id: mockInvoiceId,
            source_type: 'INVOICE',
            event_type: 'INVOICE_CREATED',
            event_version: 1,
            idempotency_key: mockEventId,
            payload: {
                id: mockInvoiceId,
                total_amount: 50000,
                gct_amount: 7500,
                currency: 'JMD',
                client_id: "test-client",
                client_name: "Test Client LLC",
                created_at: new Date().toISOString()
            }
        };

        log(`Publishing event ${mockEventId} for the FIRST time...`);
        const res1 = await projectAccountingEvent(testEvent);
        log(`First Process Result: ${res1 ? 'Processed' : 'Ignored'}`);

        log(`Publishing the EXACT SAME event ${mockEventId} again (Simulation 10x delivery)...`);
        let duplicateSuccessCount = 0;
        for (let i = 0; i < 5; i++) {
            try {
                const resDuplicate = await projectAccountingEvent(testEvent);
                if (resDuplicate === null) {
                    duplicateSuccessCount++;
                }
            } catch (e) {
                log("Duplicate error: " + e.message);
            }
        }

        if (duplicateSuccessCount === 5) {
            log(`✅ PASS: Idempotency confirmed. 5 duplicate deliveries were successfully deduplicated.`);
        } else {
            log(`❌ FAIL: Idempotency failed. Duplicate events were processed!`);
        }

        // Test 3: Reversal Test (Version Increment)
        log("\n--- Test 3: Reversal & Replacement Test ---");
        const updateEventId = crypto.randomUUID();

        const updateEvent = {
            id: updateEventId,
            company_id: companyId,
            source_id: mockInvoiceId,
            source_type: 'INVOICE',
            event_type: 'INVOICE_UPDATED',
            event_version: 2,
            idempotency_key: updateEventId,
            payload: {
                id: mockInvoiceId,
                total_amount: 60000,
                gct_amount: 9000,
                currency: 'JMD',
                client_id: "test-client",
                client_name: "Test Client LLC",
                updated_at: new Date().toISOString()
            }
        };

        log(`Publishing UPDATE event with version 2...`);
        const resUpdate = await projectAccountingEvent(updateEvent);

        if (resUpdate && resUpdate.id) {
            log(`✅ PASS: Update successfully processed and posted entry ${resUpdate.id}.`);
        } else {
            log(`❌ FAIL: Update failed or was ignored.`);
        }

        const { data: v1Journal, error: v1Err } = await supabase
            .from('journals')
            .select('*')
            .eq('source_id', mockInvoiceId)
            .eq('source_event_version', 1)
            .is('reversal_of_journal_id', null)
            .single();

        if (v1Err) log("Error finding v1Journal: " + v1Err.message);

        if (v1Journal && v1Journal.status === 'reversed') {
            log(`✅ PASS: Original Journal for v1 correctly marked as reversed.`);
        } else {
            log(`❌ FAIL: Original Journal missing or not reversed.`);
        }

        log("\nTest Suite Completed.");
    } catch (err) {
        log("Test Suite crashed: " + err.message);
    }
}

runTests();
