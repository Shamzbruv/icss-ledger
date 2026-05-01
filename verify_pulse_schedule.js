
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function runVerification() {
    console.log('--- Starting Verification for Client Care Pulse Scheduling ---');

    // 1. Create a Test Client (or use existing)
    const testEmail = 'test_schedule_verify@example.com';
    let clientId;

    const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('email', testEmail)
        .single();

    if (existingClient) {
        clientId = existingClient.id;
        console.log(`Using existing test client: ${clientId}`);
    } else {
        const { data: newClient, error } = await supabase
            .from('clients')
            .insert({ name: 'Test Schedule Verify', email: testEmail })
            .select()
            .single();
        if (error) {
            console.error('Error creating client:', error);
            return;
        }
        clientId = newClient.id;
        console.log(`Created test client: ${clientId}`);
    }

    // 2. Create a Scheduled Service (Weekly, Monday 9am)
    console.log('Creating scheduled service...');
    // We need a valid plan ID. Fetch one.
    const { data: plans } = await supabase.from('service_plans').select('id').limit(1);
    const planId = plans[0].id;

    // Setup schedule: Weekly on Monday (1)
    const { data: service, error: serviceError } = await supabase
        .from('client_services')
        .insert({
            client_id: clientId,
            plan_id: planId,
            frequency: 'weekly',
            send_day_of_week: 1, // Monday
            send_time: '09:00:00',
            timezone: 'America/Jamaica', // UTC-5
            status: 'active'
        })
        .select()
        .single();

    if (serviceError) {
        console.error('Error creating service:', serviceError);
        return;
    }

    console.log(`Service created: ${service.id}`);

    // 3. Verify `next_run_at`
    // Importing the calculation logic to check against DB
    // Since we can't import easily if not exported properly, let's just check if it's NOT NULL for now
    // and ideally reasonably in the future.
    // Wait, the INSERT above did NOT calculate next_run_at because database trigger doesn't exist for it,
    // and I manually called `calculateNextRun` in the API endpoint `server.js`.
    // Since this script is bypassing the API and using Supabase directly, `next_run_at` might be null unless I calculate it here.
    // BUT, the purpose of this script is to verify the SYSTEM. So I should call the API if possible, OR I should use the `clientCarePulseService.js` function.

    // Let's use the actual service function to calculate and update, simulating the API behavior.
    const { calculateNextRun } = require('./src/services/clientCarePulseService');
    const nextRun = calculateNextRun(service);
    console.log(`Calculated next run: ${nextRun}`);

    await supabase
        .from('client_services')
        .update({ next_run_at: nextRun })
        .eq('id', service.id);

    console.log('Updated service with next_run_at.');

    // 4. Verify Summary Generation
    console.log('Generating monthly summary...');
    const { generateMonthlySummary } = require('./src/services/clientCarePulseService');
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    // Create a dummy checklist run to ensure summary has data
    await supabase.from('checklist_runs').insert({
        service_id: service.id,
        score: 85,
        results_json: [
            { label: 'Test Check 1', status: 'pass' },
            { label: 'Test Check 2', status: 'warn' },
            { label: 'Test Check 3', status: 'fail' }
        ],
        status: 'completed'
    });

    const summary = await generateMonthlySummary(clientId, currentMonth);
    console.log('Summary generated:', summary);

    if (summary.total_reports_sent > 0 && summary.fail_count > 0) {
        console.log('✅ Verification SUCCEEDED: Summary contains expected data.');
    } else {
        console.error('❌ Verification FAILED: Summary data mismatch.');
    }

    // Cleanup
    await supabase.from('client_services').delete().eq('id', service.id);
    await supabase.from('clients').delete().eq('id', clientId);
    // Runs and summaries will cascade if setup correctly, or might remain. 
    // Pulse summaries cascade on client delete.
    console.log('Cleanup completed.');
}

runVerification().catch(console.error);
