const test = require('node:test');
const assert = require('node:assert/strict');

// Billing helpers share a module with the Supabase-backed invoice routines.
// These inert local values let the pure date helper load without contacting a
// database when the test suite runs outside Railway.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const { calculateNextRunIso } = require('../src/services/scheduleTimeService');
const { getPlanByPayPalId, findCatalogPlan } = require('../src/services/subscriptionCatalog');
const { computeInvoiceState, validateInvoiceState } = require('../src/services/invoiceStateService');
const { addBillingPeriod, syncServiceActivation, generateSubscriptionInvoice, processRecurringBilling, isSubscriptionPaymentContext } = require('../src/services/subscriptionBillingService');
const { getSubscriptionBillingCycle, getSubscriptionRenewalTemplate, getInvoiceOutstandingBalance, getInvoiceDelinquencyTemplate } = require('../src/services/emailTemplates');
const { isRenewalEligibleEvent, isSubscriptionFailureEvent } = require('../src/services/paypalEventGateService');
const { convertInvoiceAmountToJmd } = require('../src/services/postingRulesService');
const { calculateNextEventVersion, MAX_POSTGRES_INTEGER } = require('../src/services/outboxEventService');

test('website plans map exact PayPal IDs and settled totals', () => {
    const refresh = getPlanByPayPalId('P-00F6350522773701SNECR4RI');
    assert.equal(refresh.code, 'REFRESH');
    assert.equal(refresh.name, 'Content Refresh');
    assert.equal(refresh.billingCycle, 'monthly');
    assert.match(refresh.features.join(' '), /Unlimited edits/i);
    assert.equal(findCatalogPlan({ amount: 34.5 }).code, 'HOST_PRO');
});

test('weekly Client Care schedules respect Jamaica and New York timezones', () => {
    const now = new Date('2026-08-05T12:00:00.000Z');
    assert.equal(calculateNextRunIso({
        frequency: 'weekly', sendDayOfWeek: 1, sendTime: '09:00',
        timeZone: 'America/Jamaica', now
    }), '2026-08-10T14:00:00.000Z');
    assert.equal(calculateNextRunIso({
        frequency: 'weekly', sendDayOfWeek: 1, sendTime: '09:00',
        timeZone: 'America/New_York', now
    }), '2026-08-10T13:00:00.000Z');
});

test('monthly and yearly renewals clamp safely at month and leap-year boundaries', () => {
    assert.equal(
        addBillingPeriod(new Date('2026-01-31T09:00:00.000Z'), 'monthly').toISOString(),
        '2026-02-28T09:00:00.000Z'
    );
    assert.equal(
        addBillingPeriod(new Date('2024-02-29T09:00:00.000Z'), 'yearly').toISOString(),
        '2025-02-28T09:00:00.000Z'
    );
});

test('subscription workflows never create invoices', async () => {
    assert.equal(await syncServiceActivation('service-test'), null);
    assert.equal(await generateSubscriptionInvoice({ id: 'service-test' }), null);
    assert.deepEqual(await processRecurringBilling(), { processed: 0, disabled: true });
});

test('subscription automation requires the correct verified PayPal event', () => {
    assert.equal(isRenewalEligibleEvent('PAYMENT.SALE.COMPLETED'), true);
    assert.equal(isRenewalEligibleEvent('BILLING.SUBSCRIPTION.ACTIVATED'), true);
    assert.equal(isRenewalEligibleEvent('BILLING.SUBSCRIPTION.PAYMENT.FAILED'), false);
    assert.equal(isRenewalEligibleEvent('BILLING.SUBSCRIPTION.CREATED'), false);
    assert.equal(isSubscriptionFailureEvent('BILLING.SUBSCRIPTION.PAYMENT.FAILED'), true);
    assert.equal(isSubscriptionFailureEvent('PAYMENT.SALE.COMPLETED'), false);
});

test('Client Care cadence never leaks into subscription billing cadence', () => {
    const service = {
        frequency: 'weekly',
        next_renewal_date: '2026-08-28',
        service_meta_json: {},
        clients: { name: 'Test Client' },
        service_plans: { name: 'Hosting + Domain Management', price: 38, billing_cycle: 'monthly' }
    };
    assert.equal(getSubscriptionBillingCycle(service, service.service_plans), 'Monthly');
    const renewalHtml = getSubscriptionRenewalTemplate(service);
    assert.match(renewalHtml, /Billing Cycle<\/td>[\s\S]*Monthly/);
    assert.doesNotMatch(renewalHtml, /\$38\.00\/weekly/i);
});

test('verified subscription payments bypass invoice processing', () => {
    assert.equal(isSubscriptionPaymentContext({ clientServiceId: 'service-1', captureHasSubscriptionIdentity: true }), true);
    assert.equal(isSubscriptionPaymentContext({ invoice: { is_subscription: true } }), true);
    assert.equal(isSubscriptionPaymentContext({ clientServiceId: 'service-1', captureHasSubscriptionIdentity: false }), false);
    assert.equal(isSubscriptionPaymentContext({ invoice: { is_subscription: false } }), false);
});

test('ordinary invoice alerts report the remaining balance without claiming a decline', () => {
    const invoice = {
        invoice_number: 'INV-ICSS-001', service_code: 'WEB', currency: 'JMD',
        total_amount: 180000, amount_paid: 70000, remaining_amount: 110000, balance_due: 110000,
        due_date: '2026-05-30'
    };
    assert.equal(getInvoiceOutstandingBalance(invoice), 110000);
    assert.equal(getInvoiceOutstandingBalance({ payment_status: 'PAID', total_amount: 7000, remaining_amount: 7000, balance_due: 0 }), 0);
    const notice = getInvoiceDelinquencyTemplate(invoice, { name: 'Test Client' });
    assert.match(notice.subject, /URGENT: Outstanding Balance Requires Attention/);
    assert.match(notice.text, /URGENT — OUTSTANDING BALANCE REQUIRES ATTENTION/);
    assert.match(notice.text, /JMD\s*110,000\.00/);
    assert.doesNotMatch(notice.text, /payment (?:was )?declined|unable to process/i);
});

test('invoice accounting event versions stay monotonic and inside PostgreSQL integer range', () => {
    assert.equal(calculateNextEventVersion(), 1);
    assert.equal(calculateNextEventVersion(1, 4, 2), 5);
    assert.equal(calculateNextEventVersion([7, 3], 6), 8);
    assert.throws(() => calculateNextEventVersion(MAX_POSTGRES_INTEGER), /version limit/i);
    assert.throws(() => calculateNextEventVersion(1787336046025), /version limit/i);
});

test('invoice preview states enforce paid, partial, deposit, and unpaid contracts', () => {
    const client = { name: 'Preview Client' };
    const cases = [
        { payment_status: 'PAID', total_amount: 34.5, amount_paid: 34.5, paid_at: '2026-08-01T12:00:00Z', due_date: '2026-08-15', expectedBalance: 0 },
        { payment_status: 'PARTIAL', total_amount: 100, amount_paid: 35, due_date: '2026-08-15', expectedBalance: 65 },
        { payment_status: 'DEPOSIT', total_amount: 100, amount_paid: 0, deposit_percent: 25, due_date: '2026-08-15', expectedBalance: 75 },
        { payment_status: 'UNPAID', total_amount: 100, amount_paid: 0, due_date: '2026-08-15', expectedBalance: 100 }
    ];

    for (const [index, invoice] of cases.entries()) {
        const state = computeInvoiceState({ invoice_number: `INV-TEST-${index}`, ...invoice }, client);
        assert.equal(state.balanceDue, invoice.expectedBalance);
        assert.equal(validateInvoiceState(state), true);
    }
});

test('invoice ledger conversion respects the invoice currency', () => {
    assert.equal(convertInvoiceAmountToJmd(462494.51, 'JMD', 158), 462494.51);
    assert.equal(convertInvoiceAmountToJmd(100, 'USD', 158), 15800);
    assert.equal(computeInvoiceState({ invoice_number: 'INV-JMD', total_amount: 100, currency: 'JMD' }, { name: 'Client' }).currency, 'JMD');
});

test('onboarding keeps phone in Client Care metadata for legacy clients schema', async () => {
    const calls = [];
    let insertedClient = null;
    let insertedService = null;
    const clientRecord = { id: 'client-1', name: 'Test Company', email: 'payer@example.com', address: null, company_id: 'company-1' };
    const planRecord = { id: 'plan-1', name: 'Hosting Only', price: 30, default_frequency: 'monthly', features_json: [] };

    function responseFor(query) {
        calls.push({ table: query.table, operation: query.operation, payload: query.payload, filters: query.filters });
        if (query.table === 'client_services' && query.operation === 'select' && query.filters.some(filter => filter.kind === 'contains')) {
            return { data: null, error: null };
        }
        if (query.table === 'clients' && query.operation === 'select') return { data: null, error: null };
        if (query.table === 'companies' && query.operation === 'select') return { data: { id: 'company-1' }, error: null };
        if (query.table === 'clients' && query.operation === 'insert') {
            insertedClient = query.payload;
            return { data: clientRecord, error: null };
        }
        if (query.table === 'service_plans' && query.operation === 'select') return { data: planRecord, error: null };
        if (query.table === 'service_plans' && query.operation === 'update') return { data: planRecord, error: null };
        if (query.table === 'checklist_templates' && query.operation === 'select') return { data: { id: 'template-1' }, error: null };
        if (query.table === 'client_services' && query.operation === 'select') return { data: [], error: null };
        if (query.table === 'client_services' && query.operation === 'insert') {
            insertedService = query.payload;
            return { data: { id: 'service-1', ...query.payload }, error: null };
        }
        throw new Error(`Unexpected mock query: ${query.operation} ${query.table}`);
    }

    function makeBuilder(table) {
        const query = { table, operation: 'select', payload: null, filters: [] };
        const builder = {
            select(columns) { query.columns = columns; return builder; },
            insert(payload) { query.operation = 'insert'; query.payload = payload; return builder; },
            update(payload) { query.operation = 'update'; query.payload = payload; return builder; },
            eq(column, value) { query.filters.push({ kind: 'eq', column, value }); return builder; },
            ilike(column, value) { query.filters.push({ kind: 'ilike', column, value }); return builder; },
            contains(column, value) { query.filters.push({ kind: 'contains', column, value }); return builder; },
            in(column, value) { query.filters.push({ kind: 'in', column, value }); return builder; },
            limit(value) { query.limit = value; return builder; },
            maybeSingle() { return Promise.resolve(responseFor(query)); },
            single() { return Promise.resolve(responseFor(query)); },
            then(resolve, reject) { return Promise.resolve(responseFor(query)).then(resolve, reject); }
        };
        return builder;
    }

    const fakeSupabase = { from: table => makeBuilder(table) };
    const dbPath = require.resolve('../src/db');
    const servicePath = require.resolve('../src/services/customerRelationsService');
    const originalDbCache = require.cache[dbPath];
    delete require.cache[servicePath];
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeSupabase };

    try {
        const { ensureSubscriptionContext } = require(servicePath);
        const result = await ensureSubscriptionContext({
            id: 'I-UNITTEST123',
            plan_id: 'P-9FL12940T1207713ENECQJ4A',
            status: 'ACTIVE',
            subscriber: { email_address: 'payer@example.com', name: { given_name: 'Test', surname: 'Owner' } },
            billing_info: { next_billing_time: '2026-09-05T12:00:00Z' }
        }, {
            fullName: 'Test Owner', businessName: 'Test Company', phone: '+1 876 555 0100',
            websiteUrl: 'https://example.com/', domainName: 'example.com', reportEmail: 'reports@example.com',
            birthdayMonth: 8, birthdayDay: 5, reportFrequency: 'weekly', sendDayOfWeek: 1,
            sendTime: '09:00', timezone: 'America/Jamaica', completed: true
        });

        assert.equal(Object.hasOwn(insertedClient, 'phone'), false);
        assert.equal(insertedService.service_meta_json.contact_phone, '+1 876 555 0100');
        assert.equal(insertedService.frequency, 'weekly');
        assert.equal(result.service.id, 'service-1');
        assert.ok(calls.some(call => call.table === 'client_services' && call.filters.some(filter => filter.kind === 'contains')));
    } finally {
        delete require.cache[servicePath];
        if (originalDbCache) require.cache[dbPath] = originalDbCache;
        else delete require.cache[dbPath];
    }
});
