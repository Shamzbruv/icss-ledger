const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const supabase = require('./src/db');
const { verifySupabaseJwt } = require('./src/services/authService');

const app = express();
const PORT = process.env.PORT || 3000;

// BASE PATH LOGIC
// APP_BASE_PATH is generally not needed for Render root deployments, but kept for flexibility.
const APP_BASE_PATH = process.env.APP_BASE_PATH || '';
const BASE_PATH = APP_BASE_PATH;

// Trust Proxy for Render/Cloud Load Balancers
app.set('trust proxy', 1);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// CORS Policy
// Allow Netlify Frontend AND Localhost for testing
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3002',
    process.env.CLIENT_URL, // e.g. https://your-app.netlify.app
    'https://icss-command-center.netlify.app',
    'https://icss-ledger.onrender.com',
    'https://icss-ledger-production.up.railway.app'
].filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost:')) {
            return callback(null, true);
        } else {
            console.warn(`CORS Blocked Origin: ${origin}`);
            return callback(new Error(`CORS blocked: ${origin}`), false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));
// Handle Preflight for all routes explicitly
app.options('*', cors(corsOptions));


// SCHEMA VALIDATION & MAINTENANCE MODE
let isSchemaValid = false;
let schemaErrors = [];

const checkSchema = async () => {
    // We check for a few critical columns to ensure migration ran
    // Check Invoices: payment_status, company_id
    // Check Services: next_run_at
    try {
        const { error: invoiceError } = await supabase.from('invoices').select('payment_status, company_id').limit(1);
        if (invoiceError && invoiceError.message.includes('does not exist')) {
            throw new Error(`Missing columns in 'invoices': ${invoiceError.message}`);
        }

        const { error: serviceError } = await supabase.from('client_services').select('next_run_at').limit(1);
        if (serviceError && serviceError.message.includes('does not exist')) {
            throw new Error(`Missing columns in 'client_services': ${serviceError.message}`);
        }

        // If simple selects work, we assume schema is okay
        isSchemaValid = true;
        console.log('✅ Database Schema Check Passed');
    } catch (err) {
        console.error('❌ CRITICAL: Unknown Schema Error or Migration Missing');
        console.error(err.message);
        schemaErrors.push(err.message);
        isSchemaValid = false;
    }
};

// Run check on startup
checkSchema();

// ─── Startup Security Warnings ───────────────────────────────────────────────
const _isLocalEnv = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
if (!_isLocalEnv && !process.env.CRON_SECRET) {
    console.warn('[SECURITY] CRON_SECRET is not set. The /api/jobs/run-due-pulses route will be BLOCKED in production until it is configured.');
}
if (!_isLocalEnv && !process.env.SESSION_SECRET) {
    console.warn('[SECURITY] SESSION_SECRET is not set. Using insecure default — set this env var before deploying.');
}
if (!process.env.EMAIL_AUDIT_BCC) {
    console.warn('[CONFIG] EMAIL_AUDIT_BCC is not set. Outgoing emails will have no BCC.');
}
// ─────────────────────────────────────────────────────────────────────────────

// Authentication Middleware
// Strategy: JWT-first (Supabase Bearer token), session fallback, then 401.
// - PayPal webhook path is always open (signature verified inside the handler).
// - Static files and HTML pages are always open (client-side auth handles redirects).
const checkAuth = async (req, res, next) => {
    // Maintenance Mode Check
    if (!isSchemaValid) {
        if (!req.path.startsWith('/css') && !req.path.startsWith('/js')) {
            return res.status(503).send(`
                <h1>503 Service Unavailable</h1>
                <p>The application database is not ready.</p>
                <p><strong>Error:</strong> ${schemaErrors.join(', ') || 'Schema validation failed'}</p>
                <p>Please run <code>SUPABASE_FINAL_MIGRATION.sql</code> in your connection settings.</p>
            `);
        }
    }

    const currentPath = req.path;

    // Always pass through non-API routes (HTML pages, assets)
    if (!currentPath.startsWith('/api')) {
        return next();
    }

    // PayPal webhook must stay open; its own handler verifies the signature
    // Jobs/Cron endpoints are protected by CRON_SECRET inside their specific handlers
    const openApiPaths = ['/api/paypal/webhook', '/api/jobs/'];
    if (openApiPaths.some(p => currentPath.startsWith(p))) {
        return next();
    }

    // --- JWT verification (primary path) ---
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const user = await verifySupabaseJwt(token);
        if (user) {
            req.user = user;
            return next();
        }
        // Token was present but invalid — do not fall through to session,
        // as this suggests a deliberately forged or expired credential.
        console.warn(`[AUTH] Invalid JWT for ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }

    // --- Neither passed — block ---
    console.warn(`[AUTH] Rejected unauthenticated API request: ${req.method} ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized' });
};



// Create a router for the app
// This router will be mounted at APP_BASE_PATH
const router = express.Router();

// Serve Static Files -> Public folder
router.use(express.static(path.join(__dirname, 'public')));

// Apply Auth Middleware
router.use(checkAuth);

// Root Route - Serve Login Page
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});



// --- ROUTES IMPORTS ---
const { generateInvoicePDF } = require('./src/services/pdfService');
const { sendInvoiceEmail } = require('./src/services/emailService');
const { generateReferenceCode } = require('./src/services/referenceService');
const { getInvoiceEmailContent } = require('./src/services/emailTemplates');
const { sendPaymentReceipt } = require('./src/services/automationService');
const { computeInvoiceState, validateInvoiceState } = require('./src/services/invoiceStateService');

// --- ACCOUNTING MODULE IMPORTS ---
const {
    getChartOfAccounts, getTrialBalance, getJournalEntries,
    lockPeriod, getClosedPeriods, getAccountingSettings, upsertAccountingSettings
} = require('./src/services/accountingCoreService');
const { handleInvoiceEvent } = require('./src/services/postingRulesService');
const { startPolling } = require('./src/services/outboxPublisher');
const {
    computeSoleTraderContributions, estimateAnnualIncome, getComplianceCalendar,
    getAllPoliciesAsOf, computeBlendedThreshold
} = require('./src/services/taxEngineService');
const { checkGCTThreshold, computeForm4A, getGCTConfig, upsertGCTConfig, generateForm4APDF } = require('./src/services/gctService');
const {
    addAsset, getAssets, disposeAsset, getAssetRegisterReport,
    postDepreciationJournalEntries, getCapitalAllowanceReport
} = require('./src/services/assetRegisterService');
const { getProfitAndLoss, getBalanceSheet, getCashFlowSummary, getARAgingReport, getRevenueReconciliation } = require('./src/services/reportingService');
const { generateAndSendOwnerPack, generateOwnerPackPDF } = require('./src/services/ownerPackService');
const { exportAuditBundle, buildS04Workpaper, buildS04AWorkpaper } = require('./src/services/taxFormService');

// --- SHARED UTILITY FUNCTIONS ---

/**
 * Adds one billing cycle to a date based on frequency.
 * @param {Date} base - The base date
 * @param {string} freq - 'monthly' | 'yearly'
 * @returns {Date} - New date advanced by one cycle
 */
function addCycleDate(base, freq) {
    const d = new Date(base);
    if (freq === 'yearly') {
        d.setFullYear(d.getFullYear() + 1);
    } else {
        d.setMonth(d.getMonth() + 1);
    }
    return d;
}

// --- APP ROUTES ---

// SaaS: Companies List
router.get('/api/companies', async (req, res) => {
    const { data, error } = await supabase.from('companies').select('id, name, prefix');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// PREVIEW ENDPOINT
router.post('/api/invoices/preview-state', (req, res) => {

    try {
        const { invoice, client } = req.body;
        // Compute state
        const state = computeInvoiceState(invoice, client);

        // Return state
        res.json(state);
    } catch (error) {
        console.error('Preview Calculation Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to list clients for dropdown
router.get('/api/clients', async (req, res) => {
    const { data, error } = await supabase.from('clients').select('id, name, email').order('name');
    if (error) {
        console.error('Error fetching clients:', error);
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

// Endpoint to create a new client
router.post('/api/clients/create', async (req, res) => {
    try {
        const { name, email, address } = req.body;
        if (!name || !email) {
            return res.status(400).json({ error: 'Name and Email are required' });
        }

        // Check if email exists
        const { data: existing } = await supabase.from('clients').select('id').eq('email', email).single();
        if (existing) {
            return res.status(400).json({ error: 'Client with this email already exists' });
        }

        // Fetch Default Company if not provided
        // In a real multi-tenant app, we'd require a company ID or infer it from the user/subdomain.
        // For now, we default to the first one (likely ICSS) to ensure the foreign key constraint is met.
        const { data: defaultComp } = await supabase.from('companies').select('id').limit(1).single();
        const defaultCompanyId = defaultComp ? defaultComp.id : null;

        const { data, error } = await supabase
            .from('clients')
            .insert({
                name,
                email,
                address,
                company_id: defaultCompanyId // Fix: Use singular company_id
            })
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, client: data });

    } catch (err) {
        console.error('Error creating client:', err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint to delete a client
router.delete('/api/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: 'Client ID is required' });

        // Check if client exists (optional, but good for specific error messages)
        // With CASCADE delete, we can just delete. 
        // Note: The schema has ON DELETE CASCADE for invoices, client_services, etc.

        const { error } = await supabase
            .from('clients')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true, message: 'Client deleted successfully' });
    } catch (err) {
        console.error('Error deleting client:', err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint to list invoices for dashboard
router.get('/api/invoices', async (req, res) => {
    const { data, error } = await supabase
        .from('invoices')
        .select('*, clients(name)')
        .order('issue_date', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error fetching invoices:', error);
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

// Endpoint to fetch recent activity for the dashboard from multiple sources
router.get('/api/dashboard/recent-activity', async (req, res) => {
    try {
        // Fetch top 5 invoices
        const { data: invoices } = await supabase
            .from('invoices')
            .select('id, invoice_number, total_amount, issue_date, payment_status, status, clients(name)')
            .order('issue_date', { ascending: false })
            .limit(5);

        // Fetch top 5 journal entries
        let journalEntries = [];
        const { data: journals } = await supabase
            .from('journal_entries')
            .select('id, entry_number, description, total_amount, date')
            .order('date', { ascending: false })
            .limit(5);
        if (journals) journalEntries = journals;

        // Fetch top 5 client services by created_at
        const { data: clientServicesC } = await supabase
            .from('client_services')
            .select('id, status, created_at, last_emailed_at, clients(name)')
            .order('created_at', { ascending: false })
            .limit(5);

        // Fetch top 5 client services that have been emailed
        const { data: clientServicesE } = await supabase
            .from('client_services')
            .select('id, status, created_at, last_emailed_at, clients(name)')
            .not('last_emailed_at', 'is', null)
            .order('last_emailed_at', { ascending: false })
            .limit(5);

        // Combine and deduplicate
        const servicesMap = new Map();
        if (clientServicesC) clientServicesC.forEach(s => servicesMap.set(s.id, s));
        if (clientServicesE) clientServicesE.forEach(s => servicesMap.set(s.id, s));
        const services = Array.from(servicesMap.values());

        // Normalize data
        let activities = [];

        if (invoices) {
            invoices.forEach(inv => {
                activities.push({
                    type: 'invoice',
                    id: inv.id,
                    title: `Invoice ${inv.invoice_number}`,
                    description: `Client: ${inv.clients ? inv.clients.name : 'Unknown'}`,
                    amount: inv.total_amount,
                    status: inv.payment_status || (inv.status === 'paid' ? 'PAID' : 'UNPAID'),
                    date: inv.issue_date
                });
            });
        }

        journalEntries.forEach(jn => {
            activities.push({
                type: 'accounting',
                id: jn.id,
                title: `Journal ${jn.entry_number || 'Entry'}`,
                description: jn.description || 'Accounting Entry',
                amount: jn.total_amount,
                status: 'POSTED',
                date: jn.date
            });
        });

        services.forEach(cs => {
            const hasSentEmail = cs.last_emailed_at && new Date(cs.last_emailed_at) > new Date(cs.created_at);
            activities.push({
                type: 'client_care',
                id: cs.id,
                title: hasSentEmail ? `Client Care Email Sent` : `Client Care Pulse Configured`,
                description: `Client: ${cs.clients ? cs.clients.name : 'Unknown'}`,
                amount: null,
                status: cs.status || 'ACTIVE',
                date: hasSentEmail ? cs.last_emailed_at : cs.created_at
            });
        });

        // Sort combined list by date descending and take top 5
        activities.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(activities.slice(0, 5));
    } catch (err) {
        console.error('Error fetching recent activity:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/invoices/create', async (req, res) => {
    try {
        const {
            companyId,
            clientId,
            newClientDetails,
            dueDate,
            notes,
            items,
            serviceCode,
            paymentType,
            paymentPercentage, // Optional
            isSubscription, // Boolean
            isRenewal, // Boolean
            planName,
            billingCycle,
            renewalDate,
            paymentStatus,
            depositPercent,
            amountPaid,
            paidAt
        } = req.body;

        if (!clientId || !items || items.length === 0) {
            return res.status(400).json({ error: 'Missing client ID or items' });
        }

        // 0. SaaS: Validate Company
        let companyPrefix = 'ICSS';
        let targetCompanyId = (companyId && companyId.trim() !== '') ? companyId : null;

        // SINGLE TENANT FALLBACK: If no companyId is sent, use the first one in the DB (or a specific default)
        if (!targetCompanyId) {
            const { data: defaultComp } = await supabase.from('companies').select('id, prefix').limit(1).single();
            if (defaultComp) {
                targetCompanyId = defaultComp.id;
                companyPrefix = defaultComp.prefix;
            }
        } else {
            // Validate provided ID
            const { data: comp } = await supabase.from('companies').select('prefix').eq('id', targetCompanyId).single();
            if (comp) companyPrefix = comp.prefix;
        }

        // 1. Handle Client (Existing or New)
        let finalClientId = clientId;

        if (clientId === 'NEW' && newClientDetails) {
            // Check if client exists first
            const { data: existingClient } = await supabase
                .from('clients')
                .select('id')
                .eq('email', newClientDetails.email)
                .single();

            if (existingClient) {
                console.log('Client already exists, using existing ID:', existingClient.id);
                finalClientId = existingClient.id;
            } else {
                // Create new client
                console.log('Creating new client:', newClientDetails.email);
                const { data: createdClient, error: createError } = await supabase
                    .from('clients')
                    .insert({
                        name: newClientDetails.name,
                        email: newClientDetails.email,
                        address: newClientDetails.address || '',
                        company_id: targetCompanyId
                    })
                    .select()
                    .single();

                if (createError || !createdClient) {
                    console.error('Error creating client:', createError);
                    return res.status(500).json({ error: 'Failed to create new client: ' + createError.message });
                }
                finalClientId = createdClient.id;
            }
        }

        // 1.5 Fetch Client Details (if we didn't just create them, we need to fetch. If we did, we have it)
        const { data: client, error: clientError } = await supabase
            .from('clients')
            .select('*')
            .eq('id', finalClientId)
            .single();

        if (clientError || !client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // 2. Calculate Total
        let totalAmount = 0;
        items.forEach(item => {
            totalAmount += (item.quantity * item.price);
        });

        // 2.5 Determine Remaining Amount and Percentage
        const pct = parseInt(paymentPercentage || 100);
        const remaining = totalAmount; // Initially full amount is remaining (pending)

        // 2.6 Generate Sequential Invoice Number (INV-ICSS-XXX)
        // Find ALL invoices that match the pattern to find the absolute max
        const { data: allInvoices, error: lastInvError } = await supabase
            .from('invoices')
            .select('invoice_number')
            .ilike('invoice_number', 'INV-ICSS-%');

        if (lastInvError) {
            console.error('Error fetching invoices for numbering:', lastInvError);
        }

        let maxSeq = 0;
        if (allInvoices && allInvoices.length > 0) {
            allInvoices.forEach(inv => {
                const parts = inv.invoice_number.split('-');
                for (const part of parts) {
                    // Stricter check: must be purely numeric characters
                    if (/^\d+$/.test(part)) {
                        const num = parseInt(part);
                        if (num > maxSeq) {
                            maxSeq = num;
                        }
                    }
                }
            });
        }

        const nextSeq = maxSeq + 1;
        // Format: INV-ICSS-001
        const invoiceNumber = `INV-ICSS-${String(nextSeq).padStart(3, '0')}`;
        console.log('Generated Invoice Number:', invoiceNumber);

        // 3. Create Invoice Record
        const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
                invoice_number: invoiceNumber, // Explicitly set it
                company_id: targetCompanyId, // SaaS
                client_id: finalClientId,
                due_date: dueDate, // valid date string
                notes: notes,
                total_amount: totalAmount,
                service_code: serviceCode || 'CUST',
                payment_expected_type: paymentType || 'FULL',
                payment_expected_percentage: pct,
                remaining_amount: remaining,
                // New Fields
                is_subscription: isSubscription || false,
                is_renewal: isRenewal || false,
                renewal_date: renewalDate,
                // New Status Fields
                payment_status: paymentStatus || 'UNPAID',
                deposit_percent: depositPercent ? parseFloat(depositPercent) : null,
                amount_paid: paymentStatus === 'DEPOSIT' && depositPercent ? (parseFloat(depositPercent) / 100) * totalAmount : (amountPaid ? parseFloat(amountPaid) : (paymentStatus === 'PAID' ? totalAmount : 0)),
                balance_due: paymentStatus === 'PAID' ? 0 : (paymentStatus === 'DEPOSIT' && depositPercent ? totalAmount - ((parseFloat(depositPercent) / 100) * totalAmount) : (amountPaid ? totalAmount - parseFloat(amountPaid) : totalAmount)),
                paid_at: paymentStatus === 'PAID' ? (paidAt ? new Date(paidAt).toISOString() : new Date().toISOString()) : null
            })
            .select()
            .single();

        if (invoiceError) {
            console.error(invoiceError);
            return res.status(500).json({ error: 'Failed to create invoice record' });
        }

        // Step 3b: Generate Reference (SaaS: Use dynamic prefix)
        // Step 3b: Generate Reference
        // Fix: Removed companyPrefix as per function definition in referenceService.js
        const refCode = generateReferenceCode(client.name, invoice.invoice_number, serviceCode, pct);

        // Step 3c: Update Invoice with Ref Code
        await supabase
            .from('invoices')
            .update({ reference_code: refCode })
            .eq('id', invoice.id);

        // Attach refCode for PDF usage
        invoice.reference_code = refCode;
        invoice.payment_expected_percentage = pct;
        invoice.plan_name = planName; // Pass for PDF
        invoice.billing_cycle = billingCycle; // Pass for PDF

        // 4. Create Invoice Items
        const invoiceItemsData = items.map(item => ({
            invoice_id: invoice.id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.price
        }));

        const { error: itemsError } = await supabase
            .from('invoice_items')
            .insert(invoiceItemsData);

        if (itemsError) {
            console.error(itemsError);
            return res.status(500).json({ error: 'Failed to create invoice items' });
        }

        // 5. Generate State and Validate (Fail Fast)
        const state = computeInvoiceState(invoice, client);
        try {
            validateInvoiceState(state);
        } catch (vErr) {
            console.error('Validation Mismatch Detected:', vErr.message);
            return res.status(500).json({ error: 'Mismatch detected: ' + vErr.message + '. Please check your inputs.' });
        }

        const pdfItems = items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: item.price
        }));

        const pdfBuffer = await generateInvoicePDF(invoice, client, pdfItems);

        // 6. Send Email (Using Template Engine)
        const emailContent = getInvoiceEmailContent(invoice, client);

        // BCC handled via EMAIL_AUDIT_BCC centrally
        const bccEmail = null;

        // Reverting to Blocking Wait to catch errors in UI
        console.log('Sending email to:', client.email, '(BCC handled by service)');
        await sendInvoiceEmail(
            client.email,
            emailContent.subject,
            emailContent.text,
            emailContent.html,
            pdfBuffer,
            invoice.invoice_number, // bare name; sendInvoiceEmail appends .pdf
            bccEmail
        );

        // ✅ ACCOUNTING INTEGRATION: Emit transactional outbox event for journal posting
        try {
            const defaultComp = await supabase.from('companies').select('id').limit(1).single();
            if (defaultComp.data) {
                // Construct the canonical payload
                const eventPayload = {
                    ...invoice,
                    client_name: client.name,
                    payment_method: 'bank'
                };

                // Write to outbox_events instead of calling the projector directly
                // We use event_version = 1 for creation
                const { error: outboxError } = await supabase
                    .from('outbox_events')
                    .insert({
                        company_id: defaultComp.data.id,
                        aggregate_type: 'invoice',
                        aggregate_id: invoice.id,
                        event_version: 1,
                        event_type: 'INVOICE_CREATED',
                        idempotency_key: `${invoice.id}-1-INVOICE_CREATED`,
                        payload_jsonb: eventPayload,
                        publish_status: 'pending'
                    });

                if (outboxError) throw outboxError;
                console.log(`[OUTBOX] Published INVOICE_CREATED for invoice ${invoice.id}`);
            }
        } catch (accErr) {
            console.error('Accounting outbox event failed:', accErr.message);
            // In a strict environment, we might fail the whole request. For now, we log it.
        }

        res.json({ success: true, message: 'Invoice created and sent', invoiceId: invoice.id });

    } catch (err) {
        console.error('SERVER ERROR:', err);
        // Return the actual error to the frontend for debugging
        res.status(500).json({ error: 'Server Error: ' + err.message });
    }
});

// PayPal Webhook/IPN Handler
const { verifyPayPalWebhookSignature } = require('./src/services/paypalService');

router.post('/api/paypal/webhook', async (req, res) => {
    let webhookRow = null;
    try {
        const body = req.body;
        console.log('Received PayPal Webhook:', JSON.stringify(body, null, 2));

        // 0. Verify PayPal Signature
        let isValid = false;
        try {
            isValid = await verifyPayPalWebhookSignature(req.headers, req.body);
        } catch (verifyErr) {
            console.error('PayPal Signature Verification Error:', verifyErr.message);
        }
        
        if (!isValid) {
            console.warn('PayPal Webhook verification failed! Invalid signature.');
            return res.status(401).send('Unauthorized Webhook');
        }

        // Support standard captures, legacy recurring sales, and modern subscription payments
        const successEvents = new Set(['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.SALE.COMPLETED', 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED']);
        const failureEvents = new Set(['PAYMENT.CAPTURE.DECLINED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.SALE.REVERSED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED']);
        const terminalEvents = new Set(['BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.EXPIRED']);

        const resource = body.resource || {};
        let customId = resource.custom_id || resource.custom; // Invoice ID or Client Service ID

        if (!customId) {
            const payerEmail = resource.subscriber?.email_address || resource.payer?.email_address;
            console.warn(`[PAYPAL] Warning: custom_id missing from webhook payload. Attempting email fallback for: ${payerEmail}`);
            if (payerEmail) {
                const { data: client } = await supabase.from('clients').select('id').eq('email', payerEmail).single();
                if (client) {
                    const { data: svc } = await supabase.from('client_services').select('id').eq('client_id', client.id).eq('status', 'active').limit(1).single();
                    if (svc) {
                        customId = svc.id;
                        console.log(`[PAYPAL] Fallback matched client service: ${customId}`);
                    } else {
                        const { data: inv } = await supabase.from('invoices').select('id').eq('client_id', client.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).single();
                        if (inv) {
                            customId = inv.id;
                            console.log(`[PAYPAL] Fallback matched invoice: ${customId}`);
                        }
                    }
                }
            }
            if (!customId) {
                console.error('[PAYPAL] CRITICAL: Webhook missing custom_id and email fallback failed. Ensure PayPal buttons pass custom_id (client_service_id or invoice_id).');
                throw new Error("Missing custom_id and unable to map to a client.");
            }
        }

        // Phase 1: Idempotency Check
        
        // Check if event exists first
        const { data: existingEvent } = await supabase
            .from('paypal_webhook_events')
            .select('id, status')
            .eq('paypal_event_id', body.id)
            .single();

        if (existingEvent) {
            if (existingEvent.status === 'processed') {
                console.log(`[PAYPAL] Event ${body.id} already processed. Skipping.`);
                return res.status(200).send('Already processed');
            }
            // If received or failed, we allow it to retry
            console.log(`[PAYPAL] Event ${body.id} exists with status '${existingEvent.status}'. Retrying...`);
            webhookRow = existingEvent;
        } else {
            // Insert as received
            const { data: newEvent, error: insertErr } = await supabase
                .from('paypal_webhook_events')
                .insert({
                    paypal_event_id: body.id,
                    event_type: body.event_type,
                    resource_id: resource.id || null,
                    custom_id: customId || null,
                    payload_jsonb: body,
                    status: 'received'
                })
                .select('id')
                .single();

            if (insertErr && String(insertErr.code) === '23505') {
                // Highly unlikely race condition where another process just inserted it
                return res.status(200).send('Already processed');
            } else if (insertErr) {
                console.error('Failed to insert webhook event:', insertErr);
                throw insertErr;
            }
            webhookRow = newEvent;
        }


        if (successEvents.has(body.event_type)) {

            if (customId) {
                let targetInvoice = null;
                let clientServiceId = null;

                // 1. Try to fetch as an exact Invoice ID first
                const { data: exactInvoice } = await supabase
                    .from('invoices')
                    .select('*')
                    .eq('id', customId)
                    .single();

                if (exactInvoice) {
                    targetInvoice = exactInvoice;
                    clientServiceId = exactInvoice.client_service_id;
                } else {
                    // 2. Try fetching as a Client Service ID (Modern Subscription Engine)
                    const { data: service } = await supabase
                        .from('client_services')
                        .select('*')
                        .eq('id', customId)
                        .single();

                    if (service) {
                        clientServiceId = service.id;
                    }
                }

                // If this is a subscription, PayPal can charge *before* our cron job generates the invoice.
                if (!targetInvoice && body.event_type !== 'PAYMENT.CAPTURE.COMPLETED' && clientServiceId) {
                    // Look for the most recent pending invoice for this service
                    const { data: latestUnpaid } = await supabase
                        .from('invoices')
                        .select('*')
                        .eq('client_service_id', clientServiceId)
                        .eq('status', 'pending')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (latestUnpaid) {
                        targetInvoice = latestUnpaid;
                    } else {
                        console.log(`[BILLING] PayPal charged before cron. Auto-generating invoice for service ${clientServiceId}`);
                        const { syncServiceActivation } = require('./src/services/subscriptionBillingService');
                        await syncServiceActivation(clientServiceId);
                        
                        // Fetch the newly created invoice to attach payment to
                        const { data: newlyCreated } = await supabase
                            .from('invoices')
                            .select('*')
                            .eq('client_service_id', clientServiceId)
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .single();
                            
                        targetInvoice = newlyCreated;
                    }
                }

                if (!targetInvoice) {
                    console.error('No invoice or subscription could be resolved for customId:', customId);
                    return res.status(404).send('Invoice not found');
                }

                // Map targetInvoice to local variables so legacy code below doesn't break
                const invoice = targetInvoice;
                const actualInvoiceId = targetInvoice.id;

                // 2. Update Invoice Status to Paid
                const { error } = await supabase
                    .from('invoices')
                    .update({ status: 'paid', remaining_amount: 0, payment_status: 'PAID' })
                    .eq('id', actualInvoiceId);

                if (error) {
                    console.error('Error updating invoice:', error);
                    throw error;
                }

                // 3. Record Payment
                const paymentAmount = resource.amount ? resource.amount.value || resource.amount.total : targetInvoice.total_amount;
                const { error: paymentError } = await supabase.from('payments').insert({
                    invoice_id: actualInvoiceId,
                    amount: paymentAmount,
                    method: 'PayPal',
                    reference_id: resource.id,
                    payment_date: new Date().toISOString()
                });

                if (paymentError) {
                    console.error('Error inserting payment:', paymentError);
                    throw paymentError;
                }

                // ✅ ACCOUNTING INTEGRATION: Emit transactional outbox event for payment
                try {
                    // Refetch with client to get full payload for projector
                    const { data: fullInvoice } = await supabase
                        .from('invoices')
                        .select('*, clients(*)')
                        .eq('id', actualInvoiceId)
                        .single();

                    if (fullInvoice) {
                        const eventPayload = {
                            ...fullInvoice,
                            client_name: fullInvoice.clients ? fullInvoice.clients.name : 'Unknown',
                            payment_method: 'PayPal'
                        };

                        await supabase.from('outbox_events').insert({
                            company_id: fullInvoice.company_id,
                            aggregate_type: 'invoice',
                            aggregate_id: fullInvoice.id,
                            event_version: Date.now(), // High resolution timestamp as version for updates
                            event_type: 'PAYMENT_APPLIED',
                            idempotency_key: `${actualInvoiceId}-${body.id}-PAYMENT_APPLIED`,
                            payload_jsonb: eventPayload,
                            publish_status: 'pending'
                        });
                    }
                } catch (accErr) {
                    console.error('Accounting outbox event failed (PayPal):', accErr.message);
                }

                // 3.5 Automated Receipt (PDF & Email)
                const emailSuccess = await sendPaymentReceipt(actualInvoiceId);
                if (!emailSuccess) {
                    throw new Error("Payment receipt email failed. Aborting webhook processing to allow retry.");
                }

                // 4. Handle Subscription Renewal Logic
                if (invoice.is_subscription && invoice.billing_cycle) {
                    if (invoice.client_service_id) {
                        console.log(`[BILLING] Skipping legacy invoice clone. Subscription is managed by client_services (ID: ${invoice.client_service_id}).`);
                    } else {
                        // Calculate next renewal date
                        let nextDate = new Date();
                        let nextDueDate = new Date(); // Next invoice due date

                    // If renewal_date exists on the invoice, base it off that, otherwise base off today
                    const baseDate = invoice.renewal_date ? new Date(invoice.renewal_date) : new Date();

                    if (invoice.billing_cycle.toLowerCase() === 'monthly') {
                        nextDate.setMonth(baseDate.getMonth() + 1);
                        nextDueDate.setMonth(baseDate.getMonth() + 1);
                    } else if (invoice.billing_cycle.toLowerCase() === 'yearly') {
                        nextDate.setFullYear(baseDate.getFullYear() + 1);
                        nextDueDate.setFullYear(baseDate.getFullYear() + 1);
                    }

                    // Create NEXT Invoice (Automation)
                    // We clone the current invoice details but with new dates and status 'pending'
                    const { data: newInvoice, error: newInvoiceError } = await supabase
                        .from('invoices')
                        .insert({
                            company_id: invoice.company_id,
                            client_id: invoice.client_id,
                            due_date: nextDueDate,
                            status: 'pending',
                            total_amount: invoice.total_amount,
                            notes: 'Auto-generated renewal invoice',
                            service_code: invoice.service_code,
                            is_subscription: true,
                            billing_cycle: invoice.billing_cycle,
                            plan_name: invoice.plan_name,
                            renewal_date: nextDate, // The renewal AFTER this new one
                            issue_date: new Date() // Created now
                        })
                        .select()
                        .single();

                    if (newInvoiceError) {
                        console.error('Failed to auto-generate renewal invoice:', newInvoiceError);
                    } else {
                        console.log('Auto-generated renewal invoice:', newInvoice.id);

                        // Clone items for the new invoice
                        const { data: items } = await supabase
                            .from('invoice_items')
                            .select('*')
                            .eq('invoice_id', invoice.id);

                        if (items) {
                            const newItems = items.map(item => ({
                                invoice_id: newInvoice.id,
                                description: item.description,
                                quantity: item.quantity,
                                unit_price: item.unit_price
                            }));

                            await supabase.from('invoice_items').insert(newItems);
                        }

                        // ✅ ACCOUNTING INTEGRATION: Emit outbox event for renewal invoice
                        try {
                            const eventPayload = {
                                ...newInvoice,
                                client_name: 'Unknown (Renewal)', // Projector typically uses existing ar_documents info if client is missing
                                payment_method: 'bank'
                            };

                            await supabase.from('outbox_events').insert({
                                company_id: newInvoice.company_id,
                                aggregate_type: 'invoice',
                                aggregate_id: newInvoice.id,
                                event_version: 1,
                                event_type: 'INVOICE_CREATED',
                                idempotency_key: `${newInvoice.id}-1-INVOICE_CREATED`,
                                payload_jsonb: eventPayload,
                                publish_status: 'pending'
                            });
                        } catch (accErr) {
                            console.error('Accounting outbox event failed (Renewal):', accErr.message);
                        }
                    }
                    } // Ends else block for legacy cloning
                }
            }
        } else if (failureEvents.has(body.event_type)) {
            if (customId) {
                // Find target invoice
                let targetInvoice = null;
                const { data: exactInvoice } = await supabase.from('invoices').select('*').eq('id', customId).single();
                if (exactInvoice) {
                    targetInvoice = exactInvoice;
                } else {
                    const { data: service } = await supabase.from('client_services').select('*').eq('id', customId).single();
                    if (service) {
                        const { data: latestUnpaid } = await supabase.from('invoices').select('*').eq('client_service_id', service.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).single();
                        if (latestUnpaid) targetInvoice = latestUnpaid;
                    }
                }

                if (targetInvoice) {
                    await supabase.from('invoices').update({ payment_status: 'FAILED' }).eq('id', targetInvoice.id);
                    const { data: client } = await supabase.from('clients').select('*').eq('id', targetInvoice.client_id).single();
                    if (client) {
                        targetInvoice.clients = client;
                        const { getPaymentDeclinedTemplate } = require('./src/services/emailTemplates');
                        const emailContent = getPaymentDeclinedTemplate(targetInvoice, client);
                        const emailService = require('./src/services/emailService');
                        const emailSent = await emailService.sendEmail(
                            client.email,
                            emailContent.subject,
                            emailContent.html,
                            'iCreate Solutions <support@icreatesolutionsandservices.com>',
                            null
                        );
                        if (!emailSent) {
                            throw new Error("Payment declined email failed. Aborting webhook processing to allow retry.");
                        }
                    }
                }
            }
        } else if (terminalEvents.has(body.event_type)) {
            if (customId) {
                // Find service to deactivate
                let serviceId = null;
                const { data: exactService } = await supabase.from('client_services').select('id').eq('id', customId).single();
                if (exactService) {
                    serviceId = exactService.id;
                } else {
                    const { data: invoice } = await supabase.from('invoices').select('client_service_id').eq('id', customId).single();
                    if (invoice) serviceId = invoice.client_service_id;
                }
                if (serviceId) {
                    await supabase.from('client_services').update({ status: 'inactive' }).eq('id', serviceId);
                    console.log(`[PAYPAL] Marked subscription ${serviceId} inactive due to terminal event ${body.event_type}.`);
                }
            }
        }

        // Phase 2: Mark as fully processed
        if (webhookRow) {
            await supabase
                .from('paypal_webhook_events')
                .update({ status: 'processed', processed_at: new Date().toISOString() })
                .eq('id', webhookRow.id);
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error('PayPal Webhook Error:', err);
        const errMessage = err && err.message ? err.message : String(err);
        if (webhookRow) {
            await supabase.from('paypal_webhook_events').update({ status: 'failed', last_error: errMessage }).eq('id', webhookRow.id);
        }
        res.status(500).send('Error');
    }
});

// DEBUG: Test Email Connection Endpoint
// ... (existing code)

// ==========================================
// ACCOUNTING DASHBOARD API
// ==========================================
const { getDashboardWidgets } = require('./src/services/reportingService');

router.get('/api/accounting/dashboard/widgets', async (req, res) => {
    try {
        const { company_id } = req.query;
        if (!company_id) return res.status(400).json({ error: 'Missing company_id' });
        const widgets = await getDashboardWidgets(company_id);
        res.json(widgets);
    } catch (err) {
        console.error('Widget error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/accounting/tax/estimate', async (req, res) => {
    try {
        const { year, company_id } = req.query;
        // Basic mock of tax reserve estimate until full YTD computation is requested
        res.json({ contributions: { totalContributions: 0 } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/accounting/tax/compliance-calendar', async (req, res) => {
    try {
        const { year, company_id } = req.query;
        const events = await getComplianceCalendar(Number(year) || new Date().getFullYear(), company_id);
        res.json(events || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- CLIENT CARE PULSE API ---


// Create a new Client Service (Subscription to a Plan)
router.post('/api/client-services/create', async (req, res) => {
    try {
        const {
            clientId, planId,
            frequency, sendDay, // Legacy
            sendTime, timezone, sendDayOfWeek, sendDayOfMonth, sendWeekOfMonth, // New
            serviceMeta
        } = req.body;

        const { data: service, error } = await supabase
            .from('client_services')
            .insert({
                client_id: clientId,
                plan_id: planId,
                frequency: frequency || 'monthly',
                // Set next_renewal_date on creation so the reminder engine has a target.
                // next_billing_date is intentionally left to syncServiceActivation below
                // to avoid double-billing on the same day.
                next_renewal_date: addCycleDate(new Date(), frequency || 'monthly')
                    .toISOString().split('T')[0],
                // Map legacy to new if needed, or just save new
                send_time: sendTime || '09:00:00',
                timezone: timezone || 'America/Jamaica',
                send_day_of_week: sendDayOfWeek !== undefined ? sendDayOfWeek : (sendDay || null),
                send_day_of_month: sendDayOfMonth || null,
                send_week_of_month: sendWeekOfMonth || null,
                service_meta_json: serviceMeta || {},
                status: 'active'
            })
            .select()
            .single();

        if (error) throw error;

        // Calculate initial next_run_at
        const nextRun = calculateNextRun(service);
        await supabase
            .from('client_services')
            .update({ next_run_at: nextRun })
            .eq('id', service.id);

        // [BILLING INTEGRATION] Trigger initial invoice generation
        try {
            const { syncServiceActivation } = require('./src/services/subscriptionBillingService');
            await syncServiceActivation(service.id);
        } catch (syncErr) {
            console.error('Failed to sync billing on insert:', syncErr);
        }

        res.json({ success: true, service: { ...service, next_run_at: nextRun } });
    } catch (err) {
        console.error('Error creating client service:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get Services for a Client
router.get('/api/client-services/:clientId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('client_services')
            .select('*, service_plans(name)')
            .eq('client_id', req.params.clientId);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Schedule Endpoint
router.post('/api/client-care-pulse/schedule/update/:serviceId', async (req, res) => {
    try {
        const { frequency, sendTime, timezone, sendDayOfWeek, sendDayOfMonth, sendWeekOfMonth } = req.body;

        // 1. Update columns
        const { data: service, error } = await supabase
            .from('client_services')
            .update({
                frequency,
                send_time: sendTime,
                timezone,
                send_day_of_week: sendDayOfWeek,
                send_day_of_month: sendDayOfMonth,
                send_week_of_month: sendWeekOfMonth
            })
            .eq('id', req.params.serviceId)
            .select()
            .single();

        if (error) throw error;

        // 2. Recalculate Next Run
        const nextRun = calculateNextRun(service);
        await supabase
            .from('client_services')
            .update({ next_run_at: nextRun })
            .eq('id', req.params.serviceId);

        res.json({ success: true, next_run_at: nextRun });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Trigger a Run Manually
router.post('/api/client-care-pulse/run-now/:id', async (req, res) => {
    try {
        const result = await runImmediateCheck(req.params.id);
        res.json({ success: true, message: 'Check run completed', result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Report History
router.get('/api/client-care-pulse/reports', async (req, res) => {
    try {
        const history = await getReportHistory();
        res.json(history);
    } catch (err) {
        console.error('Error fetching report history:', err);
        res.status(500).json({ error: err.message });
    }
});

// Monthly Summaries Endpoints
const { runImmediateCheck, runDueClientCarePulses, getReportHistory, deleteClientService, calculateNextRun, generateMonthlySummary, runMonthlySummaryChecks } = require('./src/services/clientCarePulseService');

router.get('/api/client-care-pulse/monthly-summaries/:clientId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('monthly_pulse_summaries')
            .select('*, clients(name)')
            .eq('client_id', req.params.clientId)
            .order('month', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/client-care-pulse/monthly-summary/generate', async (req, res) => {
    try {
        const { clientId, month } = req.body; // month = 'YYYY-MM'
        if (!clientId || !month) return res.status(400).json({ error: 'Missing clientId or month' });

        const summary = await generateMonthlySummary(clientId, month);
        res.json({ success: true, summary });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Delete a Client Service
router.delete('/api/client-services/delete/:id', async (req, res) => {
    try {
        const serviceId = req.params.id;

        // [BILLING INTEGRATION] Cancel ongoing billing and void unpaid invoices
        try {
            const { cancelServiceBilling } = require('./src/services/subscriptionBillingService');
            await cancelServiceBilling(serviceId);
        } catch (syncErr) {
            console.error('Failed to cancel billing on delete:', syncErr);
        }

        const result = await deleteClientService(serviceId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ... (existing code)

// Trigger Batch Run (Protected by secret in production, open for now)
router.post('/api/jobs/run-due-pulses', async (req, res) => {
    try {
        // Production: Require CRON_SECRET unconditionally in non-local envs.
        // If the secret is missing in production, block the route entirely.
        const secret = req.headers['x-cron-secret'];
        const isLocal = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
        if (!isLocal && (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)) {
            return res.status(401).json({ error: 'Unauthorized: CRON_SECRET required in production' });
        }

        runDueClientCarePulses(); // Async, don't wait

        try {
            const { processRecurringBilling } = require('./src/services/subscriptionBillingService');
            processRecurringBilling(); // Async, don't wait
        } catch (syncErr) {
            console.error('Failed to trigger recurring billing cron:', syncErr);
        }

        try {
            const { processSubscriptionReminders, autoAdvanceRenewalDates } = require('./src/services/subscriptionReminderService');
            processSubscriptionReminders(7); // Check 7 days in advance
            autoAdvanceRenewalDates(); // Auto-advance past dates
        } catch (err) {
            console.error('Failed to trigger subscription reminders or advancement:', err);
        }

        res.json({ success: true, message: 'Batch run started' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PAYMENT NUDGE — Send payment reminder for a subscription
router.post('/api/client-services/payment-nudge', async (req, res) => {
    try {
        const { serviceId } = req.body;
        if (!serviceId) return res.status(400).json({ error: 'serviceId is required' });

        // Fetch the subscription with client + plan details
        const { data: service, error } = await supabase
            .from('client_services')
            .select(`*, clients(*), service_plans(*)`)
            .eq('id', serviceId)
            .single();

        if (error || !service) return res.status(404).json({ error: 'Subscription not found' });
        if (!service.clients?.email) return res.status(400).json({ error: 'Client has no email address' });

        const { getPaymentNudgeTemplate } = require('./src/services/emailTemplates');
        const emailContent = getPaymentNudgeTemplate(service, service.clients, service.service_plans);

        const emailService = require('./src/services/emailService');

        await emailService.sendEmail(
            service.clients.email,
            emailContent.subject,
            emailContent.html,
            'iCreate Solutions <support@icreatesolutionsandservices.com>',
            null  // BCC defaults to EMAIL_AUDIT_BCC
        );

        console.log(`💳 Payment nudge sent to ${service.clients.email}`);
        res.json({ success: true, message: `Payment nudge sent to ${service.clients.name}` });
    } catch (err) {
        console.error('Payment nudge error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ADMIN: List All Active Services
router.get('/api/admin/client-services', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('client_services')
            .select(`
                *,
                clients (name, email),
                service_plans (name, price)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Subscription Renewal Date Endpoint
router.put('/api/client-services/:id/renewal', async (req, res) => {
    try {
        const { id } = req.params;
        const { next_renewal_date } = req.body;

        const { data, error } = await supabase
            .from('client_services')
            .update({ next_renewal_date })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, service: data });
    } catch (err) {
        console.error('Error updating renewal date:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Update Subscription Schedule Endpoint
router.put('/api/client-services/:id/schedule', async (req, res) => {
    try {
        const { id } = req.params;
        const { frequency, send_day_of_week, send_day_of_month } = req.body;

        // Fetch existing first to recalculate next run
        const { data: service, error: fetchErr } = await supabase
            .from('client_services')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr) throw fetchErr;

        // Update fields locally
        service.frequency = frequency;
        service.send_day_of_week = send_day_of_week !== null && send_day_of_week !== '' ? parseInt(send_day_of_week) : null;
        service.send_day_of_month = send_day_of_month !== null && send_day_of_month !== '' ? parseInt(send_day_of_month) : null;
        
        // Reset the pattern field if we are explicitly taking over
        service.send_week_of_month = null; 

        // Important: Recalculate the next run date based on the new cadence
        const { calculateNextRun } = require('./src/services/clientCarePulseService');
        const next_run_at = calculateNextRun(service);

        const { data, error } = await supabase
            .from('client_services')
            .update({ 
                frequency: service.frequency,
                send_day_of_week: service.send_day_of_week,
                send_day_of_month: service.send_day_of_month,
                send_week_of_month: null, // Clear out pattern if present
                next_run_at 
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, service: data });
    } catch (err) {
        console.error('Error updating schedule:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Trigger Reminder Checks Manually
router.post('/api/admin/check-renewals', async (req, res) => {
    try {
        const { processSubscriptionReminders, autoAdvanceRenewalDates } = require('./src/services/subscriptionReminderService');
        const remindersResult = await processSubscriptionReminders();
        const advanceResult = await autoAdvanceRenewalDates();

        res.json({ reminders: remindersResult, advancements: advanceResult });
    } catch (err) {
        console.error('Error checking renewals:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Trigger Payment Declined Email
router.post('/api/invoices/payment-declined', async (req, res) => {
    try {
        const { invoiceId } = req.body;
        if (!invoiceId) return res.status(400).json({ error: 'Invoice ID required' });

        // 1. Fetch current invoice to get client details
        const { data: invoice, error: fetchError } = await supabase
            .from('invoices')
            .select(`
                *,
                clients (*)
            `)
            .eq('id', invoiceId)
            .single();

        if (fetchError || !invoice) return res.status(404).json({ error: 'Invoice not found' });
        if (!invoice.clients) return res.status(404).json({ error: 'Client details missing for this invoice' });

        // 2. Generate beautiful email content
        const { getPaymentDeclinedTemplate } = require('./src/services/emailTemplates');
        const emailContent = getPaymentDeclinedTemplate(invoice, invoice.clients);

        // 3. Send Email — correct argument order: (to, subject, html, from, bcc)
        const emailService = require('./src/services/emailService');
        const sent = await emailService.sendEmail(
            invoice.clients.email,
            emailContent.subject,
            emailContent.html,
            'iCreate Solutions <support@icreatesolutionsandservices.com>',
            null  // DEFAULT_BCC applied from EMAIL_AUDIT_BCC inside sendEmail
        );
        if (!sent) throw new Error('sendEmail returned false for Payment Declined email');

        // 4. Mark invoice as failed/declined in DB
        await supabase
            .from('invoices')
            .update({ payment_status: 'FAILED' })
            .eq('id', invoiceId);

        res.json({ success: true, message: 'Payment Declined email sent' });
    } catch (err) {
        console.error('Error sending Payment Declined email:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Resend Updated Status / Update Status
router.post('/api/invoices/resend', async (req, res) => {
    try {
        const { invoiceId, paymentStatus, depositPercent, amountPaid, paidAt } = req.body;

        if (!invoiceId) return res.status(400).json({ error: 'Invoice ID required' });

        // 1. Fetch current invoice to get totals and client
        const { data: invoice, error: fetchError } = await supabase
            .from('invoices')
            .select(`
                *,
                clients (*),
                invoice_items (*)
            `)
            .eq('id', invoiceId)
            .single();

        if (fetchError || !invoice) return res.status(404).json({ error: 'Invoice not found' });

        const totalAmount = parseFloat(invoice.total_amount);

        // 2. Determine updated amounts based on new status
        let updatedFields = {
            payment_status: paymentStatus || invoice.payment_status
            // updated_at column missing in DB
        };

        if (paymentStatus) {
            updatedFields.deposit_percent = paymentStatus === 'DEPOSIT' ? (depositPercent ? parseFloat(depositPercent) : invoice.deposit_percent) : null;

            updatedFields.amount_paid = paymentStatus === 'DEPOSIT'
                ? (parseFloat(updatedFields.deposit_percent || 0) / 100) * totalAmount
                : (paymentStatus === 'PARTIAL' ? parseFloat(amountPaid || invoice.amount_paid || 0) : (paymentStatus === 'PAID' ? totalAmount : 0));

            updatedFields.balance_due = paymentStatus === 'PAID'
                ? 0
                : totalAmount - updatedFields.amount_paid;

            updatedFields.paid_at = paymentStatus === 'PAID'
                ? (paidAt ? new Date(paidAt).toISOString() : (invoice.paid_at || new Date().toISOString()))
                : null;

            // Sync with old status field for backward compatibility
            updatedFields.status = paymentStatus === 'PAID' ? 'paid' : 'pending';
        }

        // 3. Update DB
        const { error: updateError } = await supabase
            .from('invoices')
            .update(updatedFields)
            .eq('id', invoiceId);

        if (updateError) throw updateError;

        // ✅ ACCOUNTING INTEGRATION: Emit transactional outbox event
        try {
            const eventPayload = {
                ...invoice,
                ...updatedFields,
                client_name: invoice.clients ? invoice.clients.name : 'Unknown',
                payment_method: 'bank'
            };

            let eventType = 'INVOICE_UPDATED';
            if (paymentStatus === 'DEPOSIT') eventType = 'DEPOSIT_PRE_SERVICE';
            else if (paymentStatus === 'PARTIAL' || paymentStatus === 'PAID') eventType = 'PAYMENT_APPLIED';

            await supabase.from('outbox_events').insert({
                company_id: invoice.company_id,
                aggregate_type: 'invoice',
                aggregate_id: invoice.id,
                event_version: Date.now(), // High resolution timestamp as version
                event_type: eventType,
                idempotency_key: `${invoice.id}-${Date.now()}-${eventType}`,
                payload_jsonb: eventPayload,
                publish_status: 'pending'
            });
        } catch (accErr) {
            console.error('Accounting outbox event failed (Resend/Payment):', accErr.message);
        }

        // 4. Regenerate PDF and Resend Email
        const { sendPaymentReceipt } = require('./src/services/automationService');
        const success = await sendPaymentReceipt(invoiceId);

        if (success) {
            res.json({ message: 'Invoice status updated and email resent successfully', updatedFields });
        } else {
            res.status(500).json({ error: 'Failed to resend email, but database was updated.' });
        }

    } catch (err) {
        console.error('RESEND ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

// Resend Email ONLY (No status update)
router.post('/api/invoices/resend-email-only', async (req, res) => {
    try {
        const { invoiceId } = req.body;
        if (!invoiceId) return res.status(400).json({ error: 'Invoice ID required' });

        const { sendPaymentReceipt } = require('./src/services/automationService');
        const success = await sendPaymentReceipt(invoiceId);

        if (success) {
            res.json({ message: 'Invoice email resent successfully' });
        } else {
            res.status(500).json({ error: 'Failed to resend email' });
        }
    } catch (err) {
        console.error('RESEND EMAIL ONLY ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

// Preview State Endpoint (Live Pre-flight Check)
router.post('/api/invoices/preview-state', (req, res) => {
    try {
        const {
            invoice, // Partial invoice object from frontend
            client   // Client object
        } = req.body;

        if (!invoice || !client) {
            return res.status(400).json({ error: 'Missing invoice or client data' });
        }

        // 1. Compute State using the Single Source of Truth
        const state = computeInvoiceState(invoice, client);

        // 2. Return Computed State
        res.json(state);

    } catch (err) {
        console.error('PREVIEW ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

// List Plans
// ... (existing code)
router.get('/api/service-plans', async (req, res) => {
    const { data, error } = await supabase.from('service_plans').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ... (existing code)


// --- Authentication Routes ---

router.get('/login', (req, res) => {
    if (req.session.isAuthenticated) {
        return res.redirect(`${BASE_PATH}/dashboard`);
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

router.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Try to sign in with Supabase Auth
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            console.error('Supabase Auth Login Error:', error.message);

            // Fallback: Check against .env credentials (ADMIN_USER) strictly as a backup or for "root" access
            // This allows the original admin to still login if needed, or we can remove it if we want purely Supabase
            const validUser = process.env.ADMIN_USER;
            const storedHash = process.env.ADMIN_PASS_HASH;

            if (validUser && storedHash && email === validUser) {
                const match = await bcrypt.compare(password, storedHash);
                if (match) {
                    req.session.isAuthenticated = true;
                    req.session.user = { email: validUser, role: 'admin' };
                    return res.json({ success: true, redirect: `${BASE_PATH}/dashboard` });
                }
            }

            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (data.user) {
            // Login Successful via Supabase
            req.session.isAuthenticated = true;
            req.session.user = {
                id: data.user.id,
                email: data.user.email,
                role: 'user' // You could fetch more role info if needed
            };

            // Force save session before response
            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            return res.json({ success: true, redirect: `${BASE_PATH}/dashboard` });
        }

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

router.post('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.clearCookie('connect.sid'); // Check express-session documentation for exact cookie name if changed
        res.json({ success: true, redirect: `${BASE_PATH}/login` });
    });
});

// Debug Endpoint to check session status
router.get('/auth/check', (req, res) => {
    console.log('[DEBUG] /auth/check hit. Session:', req.session);
    if (req.session.isAuthenticated) {
        res.json({
            authenticated: true,
            user: req.session.user,
            sessionID: req.sessionID
        });
    } else {
        res.json({
            authenticated: false,
            message: 'No active session found',
            sessionID: req.sessionID
        });
    }
});

// =============================================================================
// --- ACCOUNTING MODULE API ROUTES ---
// =============================================================================

// Helper: get company_id from request or default
async function resolveCompanyId(req) {
    const cid = req.query.company_id;
    // Basic regex to check if the string resembles a UUID to prevent DB query casting errors
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (cid && isUUID.test(cid)) {
        return cid;
    }

    const { data } = await supabase.from('companies').select('id').limit(1).single();
    return data ? data.id : null;
}

// GET /api/accounting/settings
router.get('/api/accounting/settings', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const settings = await getAccountingSettings(companyId);
        res.json(settings || {});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/accounting/settings
router.put('/api/accounting/settings', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const updated = await upsertAccountingSettings(companyId, req.body);
        res.json({ success: true, settings: updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/coa
router.get('/api/accounting/coa', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const accounts = await getChartOfAccounts(companyId);
        res.json(accounts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/journal
router.get('/api/accounting/journal', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { periodStart, periodEnd, sourceType, page, pageSize } = req.query;
        const result = await getJournalEntries(companyId, {
            periodStart, periodEnd, sourceType,
            page: page ? parseInt(page) : 1,
            pageSize: pageSize ? parseInt(pageSize) : 50
        });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/accounting/journal (Manual Journal Entry)
router.post('/api/accounting/journal', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { journal_date, description, lines } = req.body;

        if (!lines || lines.length < 2) {
            return res.status(400).json({ error: 'Journal must have at least 2 lines' });
        }

        // Map UI lines to postJournalEntry expected format
        const formattedLines = lines.map(l => ({
            accountCode: l.account_code,
            debitAmount: parseFloat(l.debit) || 0,
            creditAmount: parseFloat(l.credit) || 0,
            memo: l.description || description || 'Manual Entry'
        }));

        const { postJournalEntry } = require('./src/services/accountingCoreService');
        
        const journal = await postJournalEntry({
            companyId,
            entryDate: journal_date,
            description: description || 'Manual Journal Entry',
            sourceType: 'manual',
            lines: formattedLines
        });

        res.json({ success: true, journal });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/trial-balance
router.get('/api/accounting/trial-balance', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { start, end } = req.query;
        const tb = await getTrialBalance(companyId, start || `${new Date().getFullYear()}-01-01`, end || new Date().toISOString().split('T')[0]);
        res.json(tb);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/pnl
router.get('/api/accounting/reports/pnl', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { start, end, basis, ytdStart } = req.query;
        const pnl = await getProfitAndLoss(companyId, start, end, basis || 'accrual', ytdStart);
        res.json(pnl);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/balance-sheet
router.get('/api/accounting/reports/balance-sheet', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { asOf } = req.query;
        const bs = await getBalanceSheet(companyId, asOf || new Date().toISOString().split('T')[0]);
        res.json(bs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/cash-flow
router.get('/api/accounting/reports/cash-flow', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { start, end } = req.query;
        const cf = await getCashFlowSummary(companyId, start, end);
        res.json(cf);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/ar-aging
router.get('/api/accounting/reports/ar-aging', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const aging = await getARAgingReport(companyId);
        res.json(aging);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/reconciliation
router.get('/api/accounting/reports/reconciliation', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { start, end } = req.query;
        const rec = await getRevenueReconciliation(companyId, start || `${new Date().getFullYear()}-01-01`, end || new Date().toISOString().split('T')[0]);
        res.json(rec);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/pnl
router.get('/api/accounting/reports/pnl', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { start, end, basis } = req.query;
        const yearStart = `${new Date().getFullYear()}-01-01`;
        const today = new Date().toISOString().split('T')[0];
        const data = await getProfitAndLoss(companyId, start || yearStart, end || today, basis || 'accrual');
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/balance-sheet
router.get('/api/accounting/reports/balance-sheet', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const asOf = req.query.asOf || new Date().toISOString().split('T')[0];
        const data = await getBalanceSheet(companyId, asOf);
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/cash-flow
router.get('/api/accounting/reports/cash-flow', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { start, end } = req.query;
        const yearStart = `${new Date().getFullYear()}-01-01`;
        const today = new Date().toISOString().split('T')[0];
        const data = await getCashFlowSummary(companyId, start || yearStart, end || today);
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/dashboard/widgets
router.get('/api/accounting/dashboard/widgets', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { getDashboardWidgets } = require('./src/services/reportingService');
        const widgets = await getDashboardWidgets(companyId);
        res.json(widgets);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/tax/estimate
router.get('/api/accounting/tax/estimate', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const settings = await getAccountingSettings(companyId);
        const start = `${year}-01-01`;
        const today = new Date().toISOString().split('T')[0];
        const pnl = await getProfitAndLoss(companyId, start, today, 'accrual');
        const incomeEst = estimateAnnualIncome(pnl.summary.grossRevenue, pnl.summary.totalExpenses, new Date(), year);
        const contributions = await computeSoleTraderContributions(
            incomeEst.projectedRevenue, incomeEst.projectedExpenses, year, settings || { nht_category: 'cat1_5' }
        );
        res.json({ incomeEstimate: incomeEst, contributions });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/tax/compliance-calendar
router.get('/api/accounting/tax/compliance-calendar', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const settings = await getAccountingSettings(companyId);
        const calendar = getComplianceCalendar(settings?.business_type || 'sole_trader', year);
        res.json(calendar);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/tax/gct-status
router.get('/api/accounting/tax/gct-status', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { checkGCTThreshold } = require('./src/services/gctService');
        const gctStatus = await checkGCTThreshold(companyId);
        res.json(gctStatus);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/tax/policies
router.get('/api/accounting/tax/policies', async (req, res) => {
    try {
        const { asOf } = req.query;
        const policies = await getAllPoliciesAsOf('JM', asOf || new Date().toISOString().split('T')[0]);
        res.json(policies);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET/POST /api/accounting/expenses
router.get('/api/accounting/expenses', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { limit = 50, offset = 0 } = req.query;
        const { data, error } = await supabase
            .from('expense_records')
            .select('*')
            .eq('company_id', companyId)
            .order('expense_date', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/accounting/expenses', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const body = req.body;
        const { data: expense, error } = await supabase
            .from('expense_records')
            .insert({ company_id: companyId, ...body })
            .select()
            .single();
        if (error) throw error;

        // Emit accounting event
        const { emitAccountingEvent, projectAccountingEvent } = require('./src/services/postingRulesService');
        const event = await emitAccountingEvent({
            companyId, sourceId: expense.id, sourceType: 'EXPENSE',
            eventType: expense.expense_type === 'bill' ? 'EXPENSE_BILL_CREATED' : 'EXPENSE_CASH',
            eventVersion: 1, payload: expense
        });
        await projectAccountingEvent(event);

        res.json({ success: true, expense });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Helper to safely locate and delete an underlying journal entry for an expense
async function deleteExpenseJournal(companyId, expense) {
    // 1. Try to find a direct UI-created journal entry
    const { data: uiJournals } = await supabase.from('journals')
        .select('id')
        .eq('company_id', companyId)
        .eq('source_type', 'EXPENSE')
        .eq('source_id', expense.id);

    if (uiJournals && uiJournals.length > 0) {
        for (const j of uiJournals) {
            await supabase.from('journals').delete().eq('id', j.id);
        }
        return;
    }

    // 2. If no UI journal exists, it might be a backfilled bulk import. Try matching by date and description pattern.
    const { data: bulkJournals } = await supabase.from('journals')
        .select('id')
        .eq('company_id', companyId)
        .eq('source_type', 'bulk_import_line')
        .eq('journal_date', expense.expense_date)
        .ilike('description', `%${expense.description}%`);

    if (bulkJournals && bulkJournals.length > 0) {
        // Delete the first match to be safe
        await supabase.from('journals').delete().eq('id', bulkJournals[0].id);
    }
}

router.put('/api/accounting/expenses/:id', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const expenseId = req.params.id;
        const body = req.body;

        // Fetch old expense
        const { data: oldExpense } = await supabase.from('expense_records').select('*').eq('id', expenseId).eq('company_id', companyId).single();
        if (!oldExpense) throw new Error('Expense not found');

        // Hard delete old journal entry from ledger
        await deleteExpenseJournal(companyId, oldExpense);

        // Update the expense record
        const { data: newExpense, error } = await supabase
            .from('expense_records')
            .update(body)
            .eq('id', expenseId)
            .eq('company_id', companyId)
            .select()
            .single();
        if (error) throw error;

        // Issue a completely new journal entry mapping to this expense ID
        const { emitAccountingEvent, projectAccountingEvent, getLatestEventVersion } = require('./src/services/postingRulesService');
        const v = (await getLatestEventVersion(companyId, newExpense.id, 'EXPENSE')) + 1;

        const event = await emitAccountingEvent({
            companyId, sourceId: newExpense.id, sourceType: 'EXPENSE',
            eventType: newExpense.expense_type === 'bill' ? 'EXPENSE_BILL_CREATED' : 'EXPENSE_CASH',
            eventVersion: v, payload: newExpense
        });
        await projectAccountingEvent(event);

        res.json({ success: true, expense: newExpense });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/accounting/expenses/:id', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const expenseId = req.params.id;

        const { data: oldExpense } = await supabase.from('expense_records').select('*').eq('id', expenseId).eq('company_id', companyId).single();
        if (!oldExpense) throw new Error('Expense not found');

        // Delete underlying ledger entries first so they don't orphan
        await deleteExpenseJournal(companyId, oldExpense);

        // Delete the UI record
        const { error } = await supabase.from('expense_records').delete().eq('id', expenseId).eq('company_id', companyId);
        if (error) throw error;

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET/POST /api/accounting/assets
router.get('/api/accounting/assets', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const assets = await getAssetRegisterReport(companyId);
        res.json(assets);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/accounting/assets', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const asset = await addAsset(companyId, req.body);
        res.json({ success: true, asset });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/accounting/assets/:id/dispose', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const result = await disposeAsset(companyId, req.params.id, req.body);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/accounting/reports/owner-pack/:month — Generate + email
router.post('/api/accounting/reports/owner-pack/:month', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { month } = req.params; // 'YYYY-MM'
        const result = await generateAndSendOwnerPack(companyId, month);
        res.json({ success: true, ...result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/reports/owner-pack/:month — Download PDF
router.get('/api/accounting/reports/owner-pack/:month', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { month } = req.params;
        const pdfBuffer = await generateOwnerPackPDF(companyId, month);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="owner_pack_${month}.pdf"`);
        res.send(pdfBuffer);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/accounting/tax/generate-pack/:year
router.post('/api/accounting/tax/generate-pack/:year', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const taxYear = parseInt(req.params.year);
        const bundle = await exportAuditBundle(companyId, taxYear);
        res.json({ success: true, ...bundle });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/tax/generate-pack/:year — Download tax pack PDF
router.get('/api/accounting/tax/generate-pack/:year', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const taxYear = parseInt(req.params.year);
        const s04 = await buildS04Workpaper(companyId, taxYear);
        const s04a = await buildS04AWorkpaper(companyId, taxYear);
        const { generateTaxPackPDF } = require('./src/services/taxFormService');
        const pdfBuffer = await generateTaxPackPDF(companyId, taxYear, s04, s04a);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="tax_pack_${taxYear}.pdf"`);
        res.send(pdfBuffer);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/gct/form4a — GCT Form 4A data + PDF download
router.get('/api/accounting/gct/form4a', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { start, end, pdf } = req.query;
        const gctConfig = await getGCTConfig(companyId);
        const form4AData = await computeForm4A(companyId, start, end, gctConfig);
        if (pdf === 'true') {
            const { data: company } = await supabase.from('companies').select('name').limit(1).single();
            const pdfBuffer = await generateForm4APDF(form4AData, company?.name || 'ICSS');
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="form4a_${start}_${end}.pdf"`);
            return res.send(pdfBuffer);
        }
        res.json(form4AData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/accounting/periods/lock
router.post('/api/accounting/periods/lock', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { period, notes } = req.body;
        await lockPeriod(companyId, period, 'owner', notes);
        res.json({ success: true, period });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/periods/closed
router.get('/api/accounting/periods/closed', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const periods = await getClosedPeriods(companyId);
        res.json(periods);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/accounting/depreciation/post/:year
router.post('/api/accounting/depreciation/post/:year', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const results = await postDepreciationJournalEntries(companyId, parseInt(req.params.year));
        res.json({ success: true, results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/capital-allowances/:year
router.get('/api/accounting/capital-allowances/:year', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const report = await getCapitalAllowanceReport(companyId, parseInt(req.params.year));
        res.json(report);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// --- BULK IMPORT ROUTES ---
// =============================================================================

const { parseBulkInput } = require('./src/services/csvParser');
const { autoCategorizeLines, confirmBatch, revertBatch } = require('./src/services/bulkImportService');

// POST /api/accounting/bulk-import/parse
router.post('/api/accounting/bulk-import/parse', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { rawText, sourceType, parseSettings } = req.body;

        // 1. Parse lines
        const parseResult = await parseBulkInput({ rawText, sourceType, parseSettings });

        // 2. Auto-categorize
        parseResult.lines = await autoCategorizeLines(companyId, parseResult.lines);

        // 3. Save draft to DB
        const { data: batch, error: batchErr } = await supabase
            .from('bulk_imports')
            .insert({
                company_id: companyId,
                source_type: sourceType,
                status: 'draft',
                parse_settings: parseSettings || {},
                created_by_user_id: req.session?.user?.id || null
            })
            .select()
            .single();

        if (batchErr) throw batchErr;

        // Save lines
        const dbLines = parseResult.lines.map((l, i) => ({
            bulk_import_id: batch.id,
            row_number: l.raw.row_number,
            raw_row_json: l.raw,
            normalized_json: l.normalized,
            parse_status: l.parse_status,
            warnings: l.warnings,
            matched_vendor_id: l.matched_vendor_id,
            suggested_account_id: l.suggested_account_id,
            suggestion_confidence: l.suggestion_confidence,
            line_fingerprint: l.line_fingerprint
        }));

        if (dbLines.length > 0) {
            const { error: linesErr } = await supabase.from('bulk_import_lines').insert(dbLines);
            if (linesErr) throw linesErr;
        }

        res.json({ success: true, batchId: batch.id, ...parseResult });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/accounting/bulk-import/:id/lines/:lineId
// Update user overrides on a specific line before confirming
router.put('/api/accounting/bulk-import/:id/lines/:lineId', async (req, res) => {
    try {
        const { user_account_id, user_vendor_id } = req.body;
        const { error } = await supabase.from('bulk_import_lines')
            .update({
                user_account_id,
                user_vendor_id,
                user_overridden: true
            })
            .eq('id', req.params.lineId)
            .eq('bulk_import_id', req.params.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/accounting/bulk-import/:id/confirm
router.post('/api/accounting/bulk-import/:id/confirm', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const batchId = req.params.id;
        const confirmPayload = req.body;
        const userId = req.session?.user?.id || null;

        const result = await confirmBatch(batchId, confirmPayload, userId, companyId);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/accounting/bulk-import/:id/revert
router.post('/api/accounting/bulk-import/:id/revert', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const batchId = req.params.id;
        const userId = req.session?.user?.id || null;

        const result = await revertBatch(batchId, userId, companyId);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/accounting/bulk-import/rules
router.get('/api/accounting/bulk-import/rules', async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const { data, error } = await supabase.from('auto_category_rules').select('*').eq('company_id', companyId);
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// --- View Routes ---
// =============================================================================

router.get('/', (req, res) => {
    if (req.session.isAuthenticated) {
        res.redirect(`${BASE_PATH}/dashboard`);
    } else {
        res.redirect(`${BASE_PATH}/login`);
    }
});

router.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

router.get('/invoices', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'invoices.html'));
});

router.get('/client-care-pulse', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'client-care.html'));
});

router.get('/accounting', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'accounting.html'));
});


// Mount the router under the base path
app.use(BASE_PATH, router);

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Start the Event Projector Outbox Polling
    if (isSchemaValid) {
        startPolling(5000); // Poll every 5 seconds
    }

    // Automation Scheduler
    // Run Check logic every 15 minutes
    setInterval(() => {
        runDueClientCarePulses().catch(err => console.error('Scheduler Error (Pulse):', err));
    }, 15 * 60 * 1000);

    // Run Monthly Summary Check every 12 hours (it only acts on the 1st)
    setInterval(() => {
        runMonthlySummaryChecks().catch(err => console.error('Scheduler Error (Summary):', err));
    }, 12 * 60 * 60 * 1000);

    // Run Subscription Reminders and Auto-Advancements every 24 hours
    setInterval(() => {
        try {
            const { processSubscriptionReminders, autoAdvanceRenewalDates } = require('./src/services/subscriptionReminderService');
            processSubscriptionReminders(7)
                .catch(err => console.error('Scheduler Error (Subscription Reminders):', err));
            autoAdvanceRenewalDates()
                .catch(err => console.error('Scheduler Error (Subscription Auto-Advance):', err));
        } catch (err) {
            console.error('Failed to trigger daily subscription routines:', err);
        }
    }, 24 * 60 * 60 * 1000);

    // Initial runs
    runDueClientCarePulses();
    runMonthlySummaryChecks();
    try {
        const { processSubscriptionReminders, autoAdvanceRenewalDates } = require('./src/services/subscriptionReminderService');
        processSubscriptionReminders(7)
            .catch(err => console.error('Initial Run Error (Subscription Reminders):', err));
        autoAdvanceRenewalDates()
            .catch(err => console.error('Initial Run Error (Subscription Auto-Advance):', err));
    } catch (err) {
        console.error('Failed to trigger initial subscription routines:', err);
    }
});
