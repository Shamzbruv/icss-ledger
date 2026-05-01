const supabase = require('./src/db');
const fs = require('fs');

async function test() {
    // Look for other tables that might exist
    const { data: logs } = await supabase.from('email_logs').select('*').limit(1);
    const { data: svcLogs } = await supabase.from('service_logs').select('*').limit(1);

    // Also look at client_services again
    const { data: c } = await supabase.from('client_services').select('*').limit(5);

    const result = {
        email_logs: logs && logs.length > 0 ? Object.keys(logs[0]) : 'None',
        service_logs: svcLogs && svcLogs.length > 0 ? Object.keys(svcLogs[0]) : 'None',
        client_services_sample: c
    };

    fs.writeFileSync('probe_recent_result2.json', JSON.stringify(result, null, 2));
}
test();
