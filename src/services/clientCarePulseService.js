const supabase = require('../db');
const { getClientCarePulseEmailContent, getMonthlySummaryEmailContent } = require('./emailTemplates');
const { sendInvoiceEmail } = require('./emailService'); // Reusing the transport logic
const networkChecks = require('./checks/networkChecks');
const appChecks = require('./checks/appChecks');
const analyticsChecks = require('./checks/analyticsChecks');
const { calculateNextRun: calculateScheduledRun } = require('./scheduleTimeService');

// Map check codes to actual functions
const CHECK_REGISTRY = {
    'UPTIME': networkChecks.uptimeCheck,
    'SSL': networkChecks.sslExpiryCheck,
    'DNS': networkChecks.dnsCheck,
    'REDIRECT': networkChecks.redirectCheck,
    'PERF_LIGHT': appChecks.performanceLightCheck,
    'API_HEALTH': appChecks.apiHealthCheck,
    'WEBHOOK': appChecks.webhookHealthCheck,
    'GA_TRAFFIC': analyticsChecks.googleAnalyticsTrafficCheck
};

const WEBSITE_PLAN_NAMES = new Set(['Hosting Only', 'Hosting + Domain Management', 'Professional Hosting', 'Hosting + Domain', 'Web Maintenance', 'Content Refresh', 'Website Content Refresh']);
const DEFAULT_WEBSITE_CHECKS = [
    { code: 'UPTIME', label: 'Website Uptime' },
    { code: 'SSL', label: 'SSL Certificate' },
    { code: 'DNS', label: 'Domain & DNS' },
    { code: 'REDIRECT', label: 'Secure Redirect' },
    { code: 'PERF_LIGHT', label: 'Website Performance' },
    { code: 'GA_TRAFFIC', label: 'Google Analytics Traffic Analysis' }
];

function isWebsiteService(service) {
    return ['HOST_PRO', 'HOST_DOM', 'MAINT', 'REFRESH'].includes(service.service_meta_json?.plan_code)
        || WEBSITE_PLAN_NAMES.has(service.service_plans?.name);
}

/**
 * Main Entry Point: Runs all due checks
 */
async function runDueClientCarePulses() {
    console.log('Starting Client Care Pulse Run...');
    try {
        // 1. Fetch Active Services
        const { data: services, error: serviceError } = await supabase
            .from('client_services')
            .select(`
                *,
                clients (id, name, email),
                service_plans (id, name, default_frequency)
            `)
            .eq('status', 'active');

        if (serviceError) throw serviceError;

        console.log(`Found ${services.length} active services. Checking schedules...`);

        // 2. Process Each Service
        for (const service of services) {
            let isDue = false;
            let nextRun = service.next_run_at ? new Date(service.next_run_at) : null;
            const now = new Date();

            // Handle missing next_run_at (First run or migration)
            if (!nextRun) {
                console.log(`Service ${service.id} has no next_run_at. Calculating...`);
                nextRun = calculateNextRun(service);
                // Save it immediately
                await supabase
                    .from('client_services')
                    .update({ next_run_at: nextRun })
                    .eq('id', service.id);
            }

            if (nextRun <= now) {
                isDue = true;
            }

            if (isDue) {
                const result = await processService(service);
                const newNextRun = result?.success
                    ? calculateNextRun(service)
                    : new Date(Date.now() + 60 * 60 * 1000);
                console.log(`${result?.success ? 'Rescheduling' : 'Retrying'} Service ${service.id} at ${newNextRun}`);

                await supabase
                    .from('client_services')
                    .update({ next_run_at: newNextRun })
                    .eq('id', service.id);
            }
        }

        console.log('Client Care Pulse Run Completed.');

        // 3. New: Check if we need to generate Monthly Summaries (e.g. if today is 1st of month)
        // This is usually triggered by a separate cron, but we can do a quick check safely here
        // or expose a separate function. For now, we'll leave it to the explicit API call or separate job.

    } catch (err) {
        console.error('CRITICAL ERROR in Client Care Pulse:', err);
    }
}

// isServiceDue is deprecated/integrated into main loop

/**
 * Processes a single client service
 */
async function processService(service) {
    console.log(`Processing service ${service.id} for ${service.clients.name}...`);

    // Wrap entire process in a timeout (e.g., 90 seconds) to prevent Render 504s
    const processPromise = async () => {
        try {
            // 1. Get Checklist Template
            const { data: template, error: templateError } = await supabase
                .from('checklist_templates')
                .select('*')
                .eq('plan_id', service.plan_id)
                .single();

            if (templateError && templateError.code !== 'PGRST116') console.warn(`Template lookup failed for plan ${service.plan_id}: ${templateError.message}`);
            if (!template && !isWebsiteService(service)) return { success: false, error: `No checklist template found for plan ${service.plan_id}` };

            // 2. Run Checks
            const results = [];
            let totalScore = 0;
            let maxScore = 0;

            const config = service.service_meta_json || {};
            const items = Array.isArray(template?.items_json) && template.items_json.length
                ? [...template.items_json]
                : [...DEFAULT_WEBSITE_CHECKS];
            if (isWebsiteService(service) && !items.some(item => item.code === 'GA_TRAFFIC')) {
                items.push({ code: 'GA_TRAFFIC', label: 'Google Analytics Traffic Analysis' });
            }

            for (const item of items) {
                const checkFn = CHECK_REGISTRY[item.code];
                if (checkFn) {
                    // Determine target (URL/Domain)
                    let targets = [];

                    if (item.code === 'UPTIME' || item.code === 'PERF_LIGHT' || item.code === 'REDIRECT') {
                        if (config.website_url) targets.push({ url: config.website_url, label: null });
                    }
                    else if (item.code === 'SSL' || item.code === 'DNS') {
                        if (config.domain) targets.push({ url: config.domain, label: null });
                    }
                    else if (item.code === 'API_HEALTH') {
                        // Support multiple API URLs
                        if (Array.isArray(config.api_urls) && config.api_urls.length > 0) {
                            config.api_urls.forEach(url => targets.push({ url: url, label: `API (${url})` }));
                        } else if (config.api_url) {
                            // Fallback for legacy single URL
                            targets.push({ url: config.api_url, label: 'API Health' });
                        }
                    }
                    else if (item.code === 'WEBHOOK') {
                        if (config.webhook_url) targets.push({ url: config.webhook_url, label: null });
                    }
                    else if (item.code === 'GA_TRAFFIC') {
                        targets.push({ url: config.ga_property_id || '', label: item.label || 'Google Analytics Traffic Analysis' });
                    }

                    if (targets.length > 0) {
                        for (const targetObj of targets) {
                            const result = await checkFn(targetObj.url);
                            // Add label from template if not in result, or append specific label
                            result.label = targetObj.label || item.label || item.code;
                            result.item_code = item.code;
                            results.push(result);

                            // Scoring
                            maxScore += 10;
                            if (result.status === 'pass') totalScore += 10;
                            else if (result.status === 'warn') totalScore += 5;
                        }
                    } else {
                        // Only warn if NO targets found for this check type
                        results.push({
                            item_code: item.code,
                            label: item.label,
                            status: 'warn',
                            details: 'Configuration missing (URL/Domain not set)',
                            evidence: {}
                        });
                        maxScore += 10;
                    }
                } else {
                    // Manual/Unknown Check
                    results.push({
                        item_code: item.code,
                        label: item.label,
                        status: 'pass', // Auto-pass manual items for now or handle differently
                        details: 'Manual check passed (Auto)',
                        evidence: {}
                    });
                    maxScore += 10;
                    totalScore += 10;
                }
            }

            const finalScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
            const periodStart = new Date();
            periodStart.setDate(periodStart.getDate() - (service.frequency === 'weekly' ? 7 : 30));

            // 3. Save Run to DB
            const { data: run, error: runError } = await supabase
                .from('checklist_runs')
                .insert({
                    client_service_id: service.id,
                    period_start: periodStart,
                    period_end: new Date(),
                    run_status: 'completed',
                    score: finalScore,
                    results_json: results,
                    emailed_at: null
                })
                .select()
                .single();

            if (runError) throw runError;

            // 4. Save Run Items
            const runItemsData = results.map(r => ({
                checklist_run_id: run.id,
                item_code: r.item_code,
                label: r.label,
                status: r.status,
                details: r.details,
                evidence_json: r.evidence
            }));

            await supabase.from('checklist_run_items').insert(runItemsData);


            // 5. Send Email
            const emailContent = getClientCarePulseEmailContent(run, service.clients, service.service_plans, results);

            // Customer onboarding can choose a primary report recipient and CCs.
            const reportEmail = service.service_meta_json?.report_email || service.clients.email;
            const ccEmails = service.service_meta_json?.cc_emails || null;

            await sendInvoiceEmail(
                reportEmail,
                emailContent.subject,
                emailContent.text,
                emailContent.html,
                null, // No PDF attachment for now
                null,
                null, // BCC defaults to EMAIL_AUDIT_BCC inside emailService
                ccEmails // CC
            );

            // 6. Log Report to DB
            await supabase.from('client_care_reports').insert({
                checklist_run_id: run.id,
                client_service_id: service.id,
                recipient_email: reportEmail,
                email_subject: emailContent.subject,
                status: 'sent',
                sent_at: new Date()
            });

            // 7. Update Service Last Emailed
            await supabase
                .from('client_services')
                .update({ last_emailed_at: new Date() })
                .eq('id', service.id);
            await supabase.from('checklist_runs').update({ emailed_at: new Date() }).eq('id', run.id);

            console.log(`Report sent to ${reportEmail}`);

            return {
                success: true,
                score: finalScore,
                status: 'completed',
                checks_run: results.length,
                recipient: reportEmail
            };

        } catch (err) {
            console.error(`Error processing service ${service.id}:`, err);
            return { success: false, error: err.message };
        }
    };

    // Race against timeout
    return Promise.race([
        processPromise(),
        new Promise(resolve => setTimeout(() => resolve({ success: false, error: 'Check execution timed out (90s)' }), 90000))
    ]);
}

/**
 * Runs a specific service immediately (for "Run Now" button)
 */
async function runImmediateCheck(serviceId) {
    const { data: service, error } = await supabase
        .from('client_services')
        .select(`
            *,
            clients (id, name, email),
            service_plans (id, name, default_frequency)
        `)
        .eq('id', serviceId)
        .single();

    if (error || !service) throw new Error('Service not found');

    const result = await processService(service);

    // If successful, we should probably push the next run out to avoid double emailing
    // e.g. if run manually today, don't run automatically tomorrow?
    // User requirement: "If the user changes scheduling... immediately recalculate".
    // "Run Now" is separate. 
    // Optimization: Reset next_run_at to the NEXT cycle from NOW.
    if (result.success) {
        const nextRun = calculateNextRun(service);
        await supabase
            .from('client_services')
            .update({ next_run_at: nextRun })
            .eq('id', serviceId);
    }

    return result;
}

/**
 * Generates and saves a Monthly Summary for a client
 */
async function generateMonthlySummary(clientId, monthStr) {
    // 1. Fetch Runs for this Client in the Month
    const [year, month] = monthStr.split('-');
    const startDate = new Date(`${monthStr}-01T00:00:00Z`);
    const endDate = new Date(year, month, 0, 23, 59, 59); // Last day of month

    const { data: runs, error } = await supabase
        .from('checklist_runs')
        .select(`
            *,
            client_services!inner(client_id)
        `)
        .eq('client_services.client_id', clientId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

    if (error) throw error;
    if (!runs || runs.length === 0) return { skipped: true, reason: 'No runs found' };

    let pass = 0, warn = 0, fail = 0;
    let issues = {};

    runs.forEach(run => {
        // Parse results_json to count aggregated stats
        // Note: run.results_json is array of checks
        const results = run.results_json || [];
        // Simple heuristic: if any fail -> fail run? 
        // Or just count total checks? User says "Total number of pulse emails sent".
        // pass/warn/fail counts refer to "Breakdown". Determining if it refers to RUNS or CHECKS.
        // "Total number of pulse emails sent" = runs.length.
        // "Breakdown: Passed, Warning, Failed" likely refers to the RUN level status?
        // Let's assume Run Level. 
        // But the Run only has 'score'. We need to define what is a "Failed Run".
        // Let's look at results.
        const hasFail = results.some(r => r.status === 'fail');
        const hasWarn = results.some(r => r.status === 'warn');

        if (hasFail) fail++;
        else if (hasWarn) warn++;
        else pass++;

        // Collect issues
        results.filter(r => r.status !== 'pass').forEach(r => {
            const key = r.label || r.item_code;
            issues[key] = (issues[key] || 0) + 1;
        });
    });

    // Sort Top Issues
    const topIssues = Object.entries(issues)
        .sort((a, b) => b[1] - a[1]) // Descending count
        .slice(0, 5)
        .map(([k, v]) => ({ issue: k, count: v }));

    // Overall Status
    let overall = 'Mostly Healthy';
    if (fail > 0) overall = 'Needs Attention';
    if (fail > 2 || (fail / runs.length > 0.3)) overall = 'Critical Issues'; // Example logic

    // Save to DB
    const { data: summary, error: saveError } = await supabase
        .from('monthly_pulse_summaries')
        .upsert({
            client_id: clientId,
            month: monthStr,
            total_reports_sent: runs.length,
            pass_count: pass,
            warn_count: warn,
            fail_count: fail,
            overall_status: overall,
            top_issues_json: topIssues,
            recommendations_text: fail > 0 ? "Review failed checks." : "Great job!"
        }, { onConflict: 'client_id, month' })
        .select()
        .single();

    if (saveError) throw saveError;
    return summary;
}

/**
 * Sends the Monthly Summary Email
 */
async function sendMonthlySummaryEmail(summary) {
    try {
        // Fetch Client details
        const { data: client, error } = await supabase
            .from('clients')
            .select('*')
            .eq('id', summary.client_id)
            .single();

        if (error || !client) throw new Error('Client not found for summary');

        const { data: reportService } = await supabase.from('client_services')
            .select('service_meta_json').eq('client_id', client.id).eq('status', 'active')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const primaryRecipient = reportService?.service_meta_json?.report_email || client.email;
        const ccRecipients = reportService?.service_meta_json?.cc_emails || null;

        const emailContent = getMonthlySummaryEmailContent(summary, client);

        await sendInvoiceEmail(
            primaryRecipient,
            emailContent.subject,
            emailContent.text,
            emailContent.html,
            null,
            null,
            null, // BCC defaults to EMAIL_AUDIT_BCC inside emailService
            ccRecipients
        );

        // Update emailed_at
        await supabase
            .from('monthly_pulse_summaries')
            .update({ emailed_at: new Date() })
            .eq('id', summary.id);

        console.log(`Monthly Summary sent to ${primaryRecipient}`);
        return { success: true };

    } catch (err) {
        console.error('Error sending monthly summary:', err);
        return { success: false, error: err.message };
    }
}

/**
 * DAILY CHECK: Runs every day to see if previous month's summaries need generating
 * Should be called by a daily cron (e.g. 00:00 or 08:00)
 */
async function runMonthlySummaryChecks() {
    const today = new Date();
    // Check if it is the 1st of the month
    if (today.getDate() !== 1) {
        console.log('Not the 1st of the month. Skipping monthly summary generation.');
        return;
    }

    console.log('It is the 1st of the month. Starting Monthly Summary Generation...');

    // Calculate previous month string (YYYY-MM)
    const prevDate = new Date();
    prevDate.setMonth(prevDate.getMonth() - 1);
    const year = prevDate.getFullYear();
    const month = String(prevDate.getMonth() + 1).padStart(2, '0');
    const monthStr = `${year}-${month}`;

    try {
        // Get all active clients with services
        // Efficient way: Get distinct client_ids from active services
        const { data: activeClients, error } = await supabase
            .from('client_services')
            .select('client_id')
            .eq('status', 'active');

        if (error) throw error;

        // Dedup clients
        const clientIds = [...new Set(activeClients.map(s => s.client_id))];
        console.log(`Found ${clientIds.length} potential clients for summaries.`);

        for (const clientId of clientIds) {
            try {
                // Check if summary already exists/sent
                const { data: existing } = await supabase
                    .from('monthly_pulse_summaries')
                    .select('id, emailed_at')
                    .eq('client_id', clientId)
                    .eq('month', monthStr)
                    .single();

                if (existing && existing.emailed_at) {
                    console.log(`Summary for client ${clientId} (${monthStr}) already sent.`);
                    continue;
                }

                console.log(`Generating summary for client ${clientId}...`);
                const summary = await generateMonthlySummary(clientId, monthStr);

                if (summary && !summary.skipped) {
                    await sendMonthlySummaryEmail(summary);
                } else {
                    console.log(`Skipped summary for client ${clientId} (No data).`);
                }

            } catch (innerErr) {
                console.error(`Failed to process summary for client ${clientId}:`, innerErr);
            }
        }
    } catch (err) {
        console.error('Error in runMonthlySummaryChecks:', err);
    }
}

module.exports = {
    runDueClientCarePulses,
    runImmediateCheck,
    getReportHistory,
    deleteClientService,
    calculateNextRun,
    generateMonthlySummary,
    sendMonthlySummaryEmail,
    runMonthlySummaryChecks
};

/**
 * Calculates the next run date based on schedule configuration
 * @param {Object} service - Service object with schedule fields
 * @returns {Date} - The next run date
 */
function calculateNextRun(service) {
    try {
        return calculateScheduledRun({
            frequency: ['daily', 'weekly', 'monthly'].includes(service.frequency) ? service.frequency : 'weekly',
            sendDayOfWeek: service.send_day_of_week,
            sendDayOfMonth: service.send_day_of_month,
            sendTime: service.send_time,
            timeZone: service.timezone,
            from: new Date()
        });
    } catch (e) {
        console.error('Error calculating next run:', e);
        return new Date(Date.now() + 60 * 60 * 1000);
    }
}

/**
 * Fetch report history
 */
async function getReportHistory(limit = 50) {
    const { data, error } = await supabase
        .from('client_care_reports')
        .select(`
            *,
            checklist_runs (score),
            client_services (
                clients (name, email)
            )
        `)
        .order('sent_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data;
}

/**
 * Deletes a client service and all associated checklist runs/items
 * Note: client_care_reports are set to NULL via FK constraint, preserving history
 */
async function deleteClientService(serviceId) {
    console.log(`Deleting service ${serviceId}...`);

    try {
        // With ON DELETE CASCADE in the database, we only need to delete the service.
        // The DB will automatically remove related checklist_runs and checklist_run_items.
        const { error } = await supabase
            .from('client_services')
            .delete()
            .eq('id', serviceId);

        if (error) throw error;

        console.log(`Service ${serviceId} deleted successfully.`);
        return { success: true };
    } catch (err) {
        console.error(`Error deleting service ${serviceId}:`, err);
        throw err;
    }
}
