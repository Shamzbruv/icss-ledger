const fs = require('fs');
const originalError = console.error;
console.error = function(...args) {
    fs.appendFileSync('test_out_native.txt', args.map(a => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : a)).join(' ') + '\n');
    originalError.apply(console, args);
};

const { sendPaymentReceipt } = require('./src/services/automationService');
const supabase = require('./src/db');

async function testResend() {
    const { data: invoices } = await supabase.from('invoices').select('id, client_id').eq('invoice_number', 'INV-ICSS-001').limit(1);
    if (!invoices || invoices.length === 0) return;
    const invoiceId = invoices[0].id;
    console.log('Testing resend for', invoiceId);
    await sendPaymentReceipt(invoiceId);
}
testResend();
