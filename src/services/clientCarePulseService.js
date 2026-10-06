const supabase = require('../db');
const { sendInvoiceEmail, sendEmail } = require('./emailService'); // Reusing the transport logic
const networkChecks = require('./checks/networkChecks');
const appChecks = require('./checks/appChecks');
const analyticsChecks = require('./checks/analyticsChecks');
const siteChecks = require('./checks/siteChecks');
const domainChecks = require('./checks/domainChecks');
const pagespeed = require('./checks/pagespeedCheck');
const { normalizePublicDomain } = require('./checks/targetSafety');
const { calculateNextRun: calculateScheduledRun } = require('./scheduleTimeService');
const { resolveTier } = require('./care/carePlans');
const { buildWeeklyReport, buildMonthlyReport, isComparable } = require('./care/careReport');
const { renderWeeklyHtml, renderWeeklyText, renderMonthlyHtml, renderMonthlyText, renderAdminAlert } = require('./care/careReportEmail');
const { friendlyName } = require('./care/careExplainers');

const CHECK_TIMEOUT_MS = 45000;
const RUN_TIMEOUT_MS = 150000;
const CHECK_CONCURRENCY = 5;
const GA_ALERT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_URL = `${process.env.PUBLIC_BASE_URL || 'https://icreatesolutionsandservices.com'}/client-care-pulse`;

// -----------------------------------------------------------------------------
// Check registry
//   target: what the check needs from the service's saved settings
//     site    - website_url          domain - domain (or the website's host)
//     ga      - ga_property_id       api    - api_urls / api_url        webhook - webhook_url
// -----------------------------------------------------------------------------
const siteCheck = fn => ({ target: 'site', run: (target, c) => fn(target, c.ctx) });
const domainCheck = fn => ({ target: 'domain', run: target => fn(target) });

const CHECKS = {
    UPTIME: { label: 'Website Uptime', ...siteCheck(siteChecks.uptimeCheck) },
    PERF_LIGHT: { label: 'Website Performance', ...siteCheck(siteChecks.performanceCheck) },
    PAGESPEED: { label: 'Google PageSpeed', ...siteCheck(pagespeed.pagespeedCheck), enabled: pagespeed.isConfigured },
    SSL: { label: 'SSL Certificate', ...domainCheck(networkChecks.sslExpiryCheck) },
    DNS: { label: 'Domain & DNS', ...domainCheck(domainChecks.dnsHealthCheck) },
    HTTPS_REDIRECT: { label: 'Secure Redirect', ...domainCheck(siteChecks.httpsRedirectCheck) },
    DOMAIN_EXPIRY: { label: 'Domain Renewal', ...domainCheck(domainChecks.domainExpiryCheck) },
    EMAIL_DNS: { label: 'Business Email Setup', ...domainCheck(domainChecks.emailDnsCheck) },
    MOBILE_READY: { label: 'Mobile Friendly', ...siteCheck(siteChecks.mobileReadyCheck) },
    SECURITY_HEADERS: { label: 'Security Settings', ...siteCheck(siteChecks.securityHeadersCheck) },
    MIXED_CONTENT: { label: 'Insecure Page Items', ...siteCheck(siteChecks.mixedContentCheck) },
    IMAGES_ALT: { label: 'Picture Descriptions', ...siteCheck(siteChecks.imagesAltCheck) },
    ANALYTICS_TAG: { label: 'Visitor Counting Code', ...siteCheck(siteChecks.analyticsTagCheck) },
    BROKEN_LINKS: { label: 'Broken Links', ...siteCheck(siteChecks.brokenLinksCheck) },
    SITEMAP_ROBOTS: { label: 'Sitemap & Search Access', ...siteCheck(siteChecks.sitemapRobotsCheck) },
    SEO_BASICS: { label: 'Search Basics', ...siteCheck(siteChecks.seoBasicsCheck) },
    CMS_DETECT: { label: 'Website Software', ...siteCheck(siteChecks.cmsDetectCheck) },
    PLUGIN_UPDATES: { label: 'Plugin Updates', ...siteCheck(siteChecks.pluginUpdatesCheck) },
    CONTENT_PAGES: { label: 'Page Review', ...siteCheck(siteChecks.contentPagesCheck) },
    PAGE_PROFILE: { label: 'Homepage Snapshot', ...siteCheck(siteChecks.pageProfileCheck) },
    GA_TRAFFIC: { label: 'Google Analytics Traffic Analysis', target: 'ga', run: (target, c) => analyticsChecks.googleAnalyticsTrafficCheck(target, c.gaCtx) },
    API_HEALTH: { label: 'API Health', target: 'api', run: target => appChecks.apiHealthCheck(target) },
    WEBHOOK: { label: 'Webhook', target: 'webhook', run: target => appChecks.webhookHealthCheck(target) }
};
// Older templates and runs used this code for the secure-redirect check.
const CODE_ALIASES = { REDIRECT: 'HTTPS_REDIRECT' };

const DEFAULT_WEBSITE_CHECKS = ['UPTIME', 'SSL', 'DNS', 'HTTPS_REDIRECT', 'PERF_LIGHT', 'GA_TRAFFIC'];

// Failures that warrant telling the iCreate team immediately.
const CRITICAL_CODES = new Set(['UPTIME', 'SSL', 'DOMAIN_EXPIRY', 'DNS', 'API_HEALTH', 'WEBHOOK', 'SITEMAP_ROBOTS']);

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`timed out after ${Math.round(ms / 1000)} seconds`), { code: 'CHECK_TIMEOUT' })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function hostnameOf(value) {
    try { return normalizePublicDomain(value); } catch (_) { return null; }
}

function isPlaceholderUrl(url) {
    return /[{}]/.test(String(url || '')) || /\$\{|<[^>]+>/.test(String(url || ''));
}

/** Which checks run for this service, in order. Website tiers use their profile; other plans use their template. */
function planChecksFor(service, tier, template) {
    let codes;
    if (tier) {
        codes = [...tier.checks];
    } else {
        const fromTemplate = Array.isArray(template?.items_json) && template.items_json.length ? template.items_json.map(i => i.code) : DEFAULT_WEBSITE_CHECKS;
        codes = fromTemplate;
    }
    const seen = new Set();
    const out = [];
    for (const raw of codes) {
        const code = CODE_ALIASES[raw] || raw;
        const def = CHECKS[code];
        if (!def || seen.has(code)) continue;
        if (def.enabled && !def.enabled()) continue;
        seen.add(code);
        out.push({ code, label: def.label });
    }
    return out;
}

/** The addresses a check should be pointed at, or a reason it can't run. */
function targetsFor(def, config) {
    switch (def.target) {
        case 'site': return config.website_url ? [{ target: config.website_url }] : null;
        case 'domain': {
            const domain = config.domain || (config.website_url ? hostnameOf(config.website_url) : null);
            return domain ? [{ target: domain }] : null;
        }
        case 'ga': return [{ target: config.ga_property_id || '' }];
        case 'api': {
            const urls = Array.isArray(config.api_urls) && config.api_urls.length ? config.api_urls : (config.api_url ? [config.api_url] : []);
            return urls.length ? urls.map(url => ({ target: url, label: `API (${url})`, placeholder: isPlaceholderUrl(url) })) : null;
        }
        case 'webhook': return config.webhook_url ? [{ target: config.webhook_url }] : null;
        default: return null;
    }
}

async function executeCheck(code, label, def, entry, runtime) {
    const startedAt = Date.now();
    let result;
    if (entry.placeholder) {
        result = { status: 'skip', details: 'The saved address is a template, not a real address, so it was not tested', evidence: { reason: 'placeholder' } };
    } else {
        try {
            result = await withTimeout(Promise.resolve(def.run(entry.target, runtime)), CHECK_TIMEOUT_MS);
        } catch (error) {
            console.warn(`[CLIENT CARE] ${code} could not complete: ${error.message}`);
            result = { status: 'skip', details: `Check could not complete (${error.message})`, evidence: { reason: error.code === 'CHECK_TIMEOUT' ? 'timeout' : 'error', error: error.message } };
        }
    }
    // `engine` marks results produced by the current check suite, so reports only compare
    // like-for-like with earlier runs (older runs used a different, much smaller set of checks).
    result = { ...result, item_code: code, label: entry.label || label, duration_ms: Date.now() - startedAt, engine: 2 };
    return result;
}

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await fn(items[index], index);
        }
    }));
    return results;
}

/** Merges new values into a service's saved settings (re-reads first so a concurrent edit isn't overwritten). */
async function mergeServiceMeta(serviceId, patch) {
    const { data: row, error } = await supabase.from('client_services').select('service_meta_json').eq('id', serviceId).single();
    if (error) throw error;
    const merged = { ...(row?.service_meta_json || {}), ...patch };
    const { error: updateError } = await supabase.from('client_services').update({ service_meta_json: merged }).eq('id', serviceId);
    if (updateError) throw updateError;
    return merged;
}

/**
 * Runs every check in a service's plan against its live website. No database writes except
 * (when persist is true) saving an automatically corrected Google Analytics Property ID.
 */
async function runChecksForService(service, { persist = true, template = null } = {}) {
    const config = { ...(service.service_meta_json || {}) };
    const tier = resolveTier(service);
    const planned = planChecksFor(service, tier, template);

    const { createCheckContext } = siteChecks;
    const ctx = createCheckContext(config);
    const gaCtx = {
        websiteUrl: config.website_url,
        domain: config.domain,
        getMeasurementIds: async () => (await ctx.getAnalysis().catch(() => null))?.tracking?.gaIds || [],
        onHealed: async (newId, info) => {
            if (!persist) return;
            await mergeServiceMeta(service.id, {
                ga_property_id: newId,
                ga_property_id_previous: info.from || null,
                ga_auto_corrected_at: new Date().toISOString(),
                ga_auto_corrected_reason: info.reason
            });
            config.ga_property_id = newId;
            console.log(`[CLIENT CARE] Google Analytics Property ID corrected for service ${service.id} (${info.from || 'none'} -> ${newId}, matched by ${info.reason})`);
        }
    };
    const runtime = { ctx, gaCtx };

    // Jobs: one per (check, target).
    const jobs = [];
    const results = [];
    for (const { code, label } of planned) {
        const def = CHECKS[code];
        const targets = targetsFor(def, config);
        if (!targets) {
            results.push({ item_code: code, label, status: 'skip', details: 'Not checked: the required address is not saved for this service', evidence: { reason: 'no-config', needs: def.target } });
            continue;
        }
        targets.forEach(entry => jobs.push({ code, label, def, entry }));
    }

    // The availability check goes first: it settles the shared homepage download (with its one
    // retry) before the other checks read from it.
    const firstJob = jobs.findIndex(j => j.code === 'UPTIME');
    const ordered = firstJob > 0 ? [jobs[firstJob], ...jobs.filter((_, i) => i !== firstJob)] : jobs;
    const head = ordered.length && ordered[0].code === 'UPTIME' ? ordered.shift() : null;
    const done = [];
    if (head) done.push(await executeCheck(head.code, head.label, head.def, head.entry, runtime));
    const rest = await mapLimit(ordered, CHECK_CONCURRENCY, job => executeCheck(job.code, job.label, job.def, job.entry, runtime));
    done.push(...rest);

    // Keep the order of the plan.
    const position = new Map(planned.map((p, i) => [p.code, i]));
    const all = [...results, ...done].sort((a, b) => (position.get(a.item_code) ?? 99) - (position.get(b.item_code) ?? 99));
    return { results: all, tier, config, planned };
}

/** The service's most recent runs, newest first (used for "what changed" and the track record). */
async function getRecentRuns(serviceId, limit = 8) {
    const { data } = await supabase.from('checklist_runs')
        .select('score, results_json, created_at')
        .eq('client_service_id', serviceId)
        .order('created_at', { ascending: false })
        .limit(limit);
    return (data || []).map(row => ({ score: row.score, created_at: row.created_at, results: Array.isArray(row.results_json) ? row.results_json : [] }));
}

async function getTemplate(service) {
    const { data, error } = await supabase.from('checklist_templates').select('*').eq('plan_id', service.plan_id).limit(1).maybeSingle();
    if (error) console.warn(`Template lookup failed for plan ${service.plan_id}: ${error.message}`);
    return data || null;
}

// -----------------------------------------------------------------------------
// Alerts to the iCreate team
// -----------------------------------------------------------------------------
// Same admin address the rest of the app notifies (see routes/infoRequests.js).
function alertRecipient() {
    return process.env.CARE_ALERT_EMAIL || process.env.ADMIN_EMAIL || 'Shamzbiz1@gmail.com';
}

/** Works out what the team needs to hear about for this run. */
function collectAlertReasons({ service, results, config }) {
    const reasons = [];
    for (const r of results) {
        if (r.status === 'fail' && CRITICAL_CODES.has(r.item_code)) {
            reasons.push({ level: 'critical', code: r.item_code, title: `${friendlyName(r.item_code)} failed`, body: r.details });
        }
    }
    const ga = results.find(r => r.item_code === 'GA_TRAFFIC');
    const diagnosis = ga?.evidence?.diagnosis;
    if (diagnosis && ga.evidence.configIssue) {
        const tag = results.find(r => r.item_code === 'ANALYTICS_TAG');
        const quiet = ['QUOTA', 'NETWORK', 'UNKNOWN'].includes(diagnosis.code) || (diagnosis.code === 'NOT_CONFIGURED' && tag?.status !== 'pass');
        const last = config.ga_alert_at ? new Date(config.ga_alert_at).getTime() : 0;
        if (!quiet && Date.now() - last >= GA_ALERT_INTERVAL_MS) {
            reasons.push({ level: 'action', code: 'GA_TRAFFIC', title: `Google Analytics: ${diagnosis.title}`, body: diagnosis.plain, steps: diagnosis.steps, serviceAccountEmail: diagnosis.serviceAccountEmail, isGa: true });
        }
    }
    return reasons;
}

async function sendAdminAlert({ service, client, tier, reasons, config }) {
    if (!reasons.length) return { sent: false };
    const mail = renderAdminAlert({ clientName: client?.name || 'Client', planName: service.service_plans?.name || tier?.name, host: hostnameOf(config.website_url || config.domain || '') || '', reasons, adminUrl: ADMIN_URL });
    const ok = await sendEmail(alertRecipient(), mail.subject, mail.html);
    if (!ok) console.warn(`[CLIENT CARE] Could not send admin alert for service ${service.id}`);
    return { sent: ok };
}

// -----------------------------------------------------------------------------
// Building a report (shared by the real run, the admin preview and test sends)
// -----------------------------------------------------------------------------
function renderReport(model) {
    return { subject: model.subject, html: renderWeeklyHtml(model), text: renderWeeklyText(model) };
}

async function loadService(serviceId) {
    const { data: service, error } = await supabase
        .from('client_services')
        .select('*, clients (id, name, email), service_plans (id, name, default_frequency)')
        .eq('id', serviceId)
        .single();
    if (error || !service) throw new Error('Service not found');
    return service;
}

/** Runs the checks and builds the finished report without saving or emailing anything. */
async function previewReport(serviceId, { audience = 'admin' } = {}) {
    const service = await loadService(serviceId);
    const tier = resolveTier(service);
    const template = tier ? null : await getTemplate(service);
    const [{ results, config }, recent] = await Promise.all([
        runChecksForService(service, { persist: false, template }),
        getRecentRuns(service.id)
    ]);
    const now = new Date();
    const periodStart = new Date(now.getTime() - (service.frequency === 'monthly' ? 30 : 7) * 86400000);
    const model = buildWeeklyReport({ service, client: service.clients, tier, results, previous: recent[0] || null, history: recent, alerted: true, now, audience, periodStart, periodEnd: now });
    return { ...renderReport(model), model, results, score: model.health.score, recipients: { to: config.report_email || service.clients?.email || null, cc: config.cc_emails || null } };
}

/**
 * Re-creates a report that was already sent, from the results stored with that run, so the team can
 * see what a client received. (It is rebuilt with today's wording; it is not a saved copy of the email.)
 */
async function renderStoredReport(runId) {
    const { data: run, error } = await supabase
        .from('checklist_runs')
        .select('*, client_services (*, clients (id, name, email), service_plans (id, name, default_frequency))')
        .eq('id', runId)
        .single();
    if (error || !run || !run.client_services) throw new Error('Report not found');
    const service = run.client_services;
    const { data: earlier } = await supabase.from('checklist_runs')
        .select('score, results_json, created_at')
        .eq('client_service_id', run.client_service_id)
        .lt('created_at', run.created_at)
        .order('created_at', { ascending: false })
        .limit(8);
    const recent = (earlier || []).map(row => ({ score: row.score, created_at: row.created_at, results: Array.isArray(row.results_json) ? row.results_json : [] }));
    const results = Array.isArray(run.results_json) ? run.results_json : [];
    const tier = resolveTier(service);
    const model = buildWeeklyReport({
        service, client: service.clients, tier, results, previous: recent[0] || null, history: recent, alerted: true,
        now: new Date(run.created_at), audience: 'client', periodStart: run.period_start, periodEnd: run.period_end
    });
    return {
        ...renderReport(model),
        score: run.score,
        sentAt: run.emailed_at,
        createdAt: run.created_at,
        currentEngine: results.some(r => r.engine === 2),
        clientName: service.clients?.name || ''
    };
}

/** Sends a preview of a client's report to the iCreate team only. */
async function sendTestReport(serviceId, toEmail) {
    if (!toEmail) throw new Error('No test recipient email address was provided');
    const preview = await previewReport(serviceId, { audience: 'admin' });
    await sendInvoiceEmail(toEmail, `[TEST — not sent to the client] ${preview.subject}`, preview.text, preview.html, null, null, null, null);
    return { success: true, sentTo: toEmail, subject: preview.subject, score: preview.score };
}

/** "Test Google Analytics" in the admin screen: explains in plain English what is (not) working. */
async function testGaConnection({ serviceId, propertyId, websiteUrl, domain } = {}) {
    let config = {};
    if (serviceId) config = (await loadService(serviceId)).service_meta_json || {};
    const site = websiteUrl || config.website_url || '';
    const prop = propertyId !== undefined && propertyId !== null && propertyId !== '' ? propertyId : config.ga_property_id;
    let measurementIds = [];
    if (site) {
        const ctx = siteChecks.createCheckContext({ website_url: site });
        measurementIds = (await ctx.getAnalysis().catch(() => null))?.tracking?.gaIds || [];
    }
    const result = await analyticsChecks.diagnoseGaConnection({ propertyId: prop, websiteUrl: site, domain: domain || config.domain, measurementIds });
    return { ...result, measurementIds, siteHasTag: measurementIds.length > 0 };
}

/**
 * Main Entry Point: Runs all due checks
 */
let dueRunInProgress = false;
async function runDueClientCarePulses() {
    if (dueRunInProgress) {
        console.log('Client Care Pulse Run already in progress. Skipping this tick.');
        return;
    }
    dueRunInProgress = true;
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
            let nextRun = service.next_run_at ? new Date(service.next_run_at) : null;
            const now = new Date();

            // Handle missing next_run_at (First run or migration)
            if (!nextRun) {
                console.log(`Service ${service.id} has no next_run_at. Calculating...`);
                nextRun = calculateNextRun(service);
                await supabase.from('client_services').update({ next_run_at: nextRun }).eq('id', service.id);
            }

            if (nextRun <= now) {
                const result = await processService(service);
                // Permanent problems (nothing to check) are not retried hourly; real failures are.
                const newNextRun = result?.success || result?.permanent
                    ? calculateNextRun(service)
                    : new Date(Date.now() + 60 * 60 * 1000);
                console.log(`${result?.success || result?.permanent ? 'Rescheduling' : 'Retrying'} Service ${service.id} at ${newNextRun}`);

                await supabase.from('client_services').update({ next_run_at: newNextRun }).eq('id', service.id);
            }
        }

        console.log('Client Care Pulse Run Completed.');
    } catch (err) {
        console.error('CRITICAL ERROR in Client Care Pulse:', err);
    } finally {
        dueRunInProgress = false;
    }
}

/**
 * Processes a single client service: runs the checks for its plan, saves the run, tells the
 * iCreate team about anything serious and emails the client their report.
 */
async function processService(service) {
    console.log(`Processing service ${service.id} for ${service.clients?.name}...`);

    // If the overall time limit passes, anything still in flight must not email the client:
    // the caller will have already scheduled a retry.
    const state = { timedOut: false };

    const work = async () => {
        try {
            const tier = resolveTier(service);
            const template = tier ? null : await getTemplate(service);
            if (!tier && !template) return { success: false, permanent: true, error: `No checklist template found for plan ${service.plan_id}` };

            // 1. Run Checks
            const { results, config } = await runChecksForService(service, { persist: true, template });
            if (!results.some(r => ['pass', 'warn', 'fail'].includes(r.status))) {
                return { success: false, permanent: true, error: 'Nothing could be checked. Add the website address (or the service address) on this service.' };
            }

            // 2. Tell the iCreate team about anything serious (so "our team has been alerted" is true)
            const recent = await getRecentRuns(service.id);
            const reasons = collectAlertReasons({ service, results, config });
            let alerted = true;
            if (reasons.length) {
                const outcome = await sendAdminAlert({ service, client: service.clients, tier, reasons, config });
                alerted = reasons.some(r => r.level === 'critical') ? outcome.sent : true;
                if (outcome.sent && reasons.some(r => r.isGa)) {
                    await mergeServiceMeta(service.id, { ga_alert_at: new Date().toISOString() }).catch(error => console.warn(`ga_alert_at not saved: ${error.message}`));
                }
            }
            if (state.timedOut) return { success: false, error: 'Aborted after time limit' };

            // 3. Build the client's report
            const now = new Date();
            const periodStart = new Date(now.getTime() - (service.frequency === 'monthly' ? 30 : 7) * 86400000);
            const model = buildWeeklyReport({ service, client: service.clients, tier, results, previous: recent[0] || null, history: recent, alerted, now, audience: 'client', periodStart, periodEnd: now });
            const emailContent = renderReport(model);

            // 4. Save Run to DB
            const { data: run, error: runError } = await supabase
                .from('checklist_runs')
                .insert({
                    client_service_id: service.id,
                    period_start: periodStart,
                    period_end: now,
                    run_status: 'completed',
                    score: model.health.score,
                    results_json: results,
                    emailed_at: null
                })
                .select()
                .single();
            if (runError) throw runError;

            const runItemsData = results.map(r => ({
                checklist_run_id: run.id,
                item_code: r.item_code,
                label: r.label,
                status: r.status,
                details: r.details,
                evidence_json: r.evidence
            }));
            const { error: itemsError } = await supabase.from('checklist_run_items').insert(runItemsData);
            if (itemsError) console.warn(`[CLIENT CARE] Run items not saved for run ${run.id}: ${itemsError.message}`);

            if (state.timedOut) return { success: false, error: 'Aborted after time limit' };

            // 5. Send Email
            // Customer onboarding can choose a primary report recipient and CCs.
            const reportEmail = config.report_email || service.clients.email;
            const ccEmails = config.cc_emails || null;

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
            await supabase.from('client_services').update({ last_emailed_at: new Date() }).eq('id', service.id);
            await supabase.from('checklist_runs').update({ emailed_at: new Date() }).eq('id', run.id);

            console.log(`Report sent to ${reportEmail}`);

            return {
                success: true,
                score: model.health.score,
                status: 'completed',
                checks_run: results.length,
                recipient: reportEmail,
                alerted_team: reasons.length > 0
            };
        } catch (err) {
            console.error(`Error processing service ${service.id}:`, err);
            return { success: false, error: err.message };
        }
    };

    let timer;
    const timeout = new Promise(resolve => {
        timer = setTimeout(() => { state.timedOut = true; resolve({ success: false, error: `Check execution timed out (${RUN_TIMEOUT_MS / 1000}s)` }); }, RUN_TIMEOUT_MS);
    });
    try {
        return await Promise.race([work(), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Runs a specific service immediately (for "Run Now" button)
 */
async function runImmediateCheck(serviceId) {
    const service = await loadService(serviceId);
    const result = await processService(service);

    // Reset next_run_at to the NEXT cycle from NOW so the client is not emailed twice.
    if (result.success) {
        const nextRun = calculateNextRun(service);
        await supabase.from('client_services').update({ next_run_at: nextRun }).eq('id', serviceId);
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

    // A weekly report counts as "failed" if any scored check failed, "warning" if any warned.
    // Ideas (info) and checks that could not run (skip) never count against a month, and a
    // Google Analytics set-up problem is ours to fix, not the client's website's fault.
    let pass = 0, warn = 0, fail = 0;
    const issues = {};

    runs.forEach(run => {
        const results = (Array.isArray(run.results_json) ? run.results_json : []).filter(r => r.item_code !== 'GA_TRAFFIC' && isComparable(r));
        const hasFail = results.some(r => r.status === 'fail');
        const hasWarn = results.some(r => r.status === 'warn');

        if (hasFail) fail++;
        else if (hasWarn) warn++;
        else pass++;

        results.filter(r => r.status === 'warn' || r.status === 'fail').forEach(r => {
            const key = friendlyName(r.item_code);
            issues[key] = (issues[key] || 0) + 1;
        });
    });

    const topIssues = Object.entries(issues)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => ({ issue: k, count: v }));

    let overall = 'Mostly Healthy';
    if (fail > 0 || warn > runs.length / 2) overall = 'Needs Attention';
    if (fail > 2 || (fail / runs.length > 0.3)) overall = 'Critical Issues';

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
            recommendations_text: fail > 0 ? 'Review failed checks.' : 'Great job!'
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
        const { data: client, error } = await supabase.from('clients').select('*').eq('id', summary.client_id).single();
        if (error || !client) throw new Error('Client not found for summary');

        const { data: services } = await supabase.from('client_services')
            .select('*, service_plans (id, name, default_frequency)')
            .eq('client_id', client.id).eq('status', 'active')
            .order('created_at', { ascending: false });
        const list = services || [];
        // Report on the biggest website plan; fall back to the newest service.
        const primary = [...list].sort((a, b) => (resolveTier(b)?.rank || 0) - (resolveTier(a)?.rank || 0))[0] || null;
        const primaryRecipient = primary?.service_meta_json?.report_email || client.email;
        const ccRecipients = primary?.service_meta_json?.cc_emails || null;

        // The month's weekly runs for that service (all of the client's runs if it had none).
        const [yyyy, mm] = String(summary.month).split('-').map(Number);
        const from = new Date(Date.UTC(yyyy, mm - 1, 1));
        const to = new Date(Date.UTC(yyyy, mm, 1));
        let runQuery = supabase.from('checklist_runs').select('*').gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).order('created_at', { ascending: true });
        let runs = [];
        if (primary) {
            const { data } = await runQuery.eq('client_service_id', primary.id);
            runs = data || [];
        }
        if (!runs.length) {
            const { data } = await supabase.from('checklist_runs').select('*, client_services!inner(client_id)').eq('client_services.client_id', client.id)
                .gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).order('created_at', { ascending: true });
            runs = data || [];
        }

        const model = buildMonthlyReport({ monthStr: summary.month, runs, summary, client, service: primary || {}, tier: primary ? resolveTier(primary) : null });
        const html = renderMonthlyHtml(model);
        const text = renderMonthlyText(model);

        await sendInvoiceEmail(primaryRecipient, model.subject, text, html, null, null, null, ccRecipients);

        await supabase.from('monthly_pulse_summaries').update({ emailed_at: new Date() }).eq('id', summary.id);

        console.log(`Monthly Summary sent to ${primaryRecipient}`);
        return { success: true };

    } catch (err) {
        console.error('Error sending monthly summary:', err);
        return { success: false, error: err.message };
    }
}

/**
 * DAILY CHECK: Runs every day to see if previous month's summaries need generating.
 * It looks during the first days of a month (already-sent summaries are skipped), so a server
 * restart or outage on the 1st no longer means a month is silently missed.
 */
async function runMonthlySummaryChecks() {
    const today = new Date();
    if (today.getDate() > 5) {
        console.log('Not the start of the month. Skipping monthly summary generation.');
        return;
    }

    console.log('It is the start of the month. Starting Monthly Summary Generation...');

    // Calculate previous month string (YYYY-MM)
    const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    try {
        const { data: activeClients, error } = await supabase.from('client_services').select('client_id').eq('status', 'active');
        if (error) throw error;

        const clientIds = [...new Set(activeClients.map(s => s.client_id))];
        console.log(`Found ${clientIds.length} potential clients for summaries.`);

        for (const clientId of clientIds) {
            try {
                const { data: existing } = await supabase
                    .from('monthly_pulse_summaries')
                    .select('id, emailed_at')
                    .eq('client_id', clientId)
                    .eq('month', monthStr)
                    .maybeSingle();

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
        const { error } = await supabase.from('client_services').delete().eq('id', serviceId);
        if (error) throw error;

        console.log(`Service ${serviceId} deleted successfully.`);
        return { success: true };
    } catch (err) {
        console.error(`Error deleting service ${serviceId}:`, err);
        throw err;
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
    runMonthlySummaryChecks,
    previewReport,
    renderStoredReport,
    sendTestReport,
    testGaConnection,
    // exported for tests
    processService,
    runChecksForService,
    planChecksFor,
    targetsFor,
    collectAlertReasons,
    CHECKS
};
