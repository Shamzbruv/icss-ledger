const Imap = require('imap');
const { simpleParser } = require('mailparser');
const supabase = require('../db');
const { parseReferenceCode } = require('./referenceService'); // Potentially unused
const { sendPaymentReceipt } = require('./automationService');

const imapConfig = {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_APP_PASSWORD,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
};

function checkEmailsForPayments() {
    console.log('Checking emails for payments...');
    const imap = new Imap(imapConfig);

    imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, box) => {
            if (err) {
                console.error('Error opening inbox:', err);
                return imap.end();
            }

            // Search for Unseen emails
            imap.search(['UNSEEN'], (err, results) => {
                if (err) {
                    console.error('Error searching emails:', err);
                    return imap.end();
                }

                if (!results || results.length === 0) {
                    console.log('No new emails found.');
                    return imap.end();
                }

                const fetcher = imap.fetch(results, { bodies: '' });

                fetcher.on('message', (msg, seqno) => {
                    msg.on('body', (stream, info) => {
                        simpleParser(stream, async (err, mail) => {
                            if (err) return console.error('Error parsing mail:', err);

                            const text = mail.text || '';
                            const subject = mail.subject || '';
                            const fromEmail = mail.from.value[0].address;

                            console.log(`Processing email from: ${fromEmail}, Subject: ${subject}`);

                            let invoiceIdToProcess = null;
                            let paymentAmount = 0;
                            let paymentMethod = 'BankTransfer'; // Default

                            // --- STRATEGY 1: Smart Reference Code ---
                            const refRegex = /[A-Z]{3,4}-[A-Z]{3}-\d+-[A-Z0-9]+-\d+P/g;
                            const matches = text.match(refRegex) || subject.match(refRegex);

                            if (matches && matches.length > 0) {
                                const refCode = matches[0];
                                console.log(`Found Reference Code: ${refCode}`);

                                const { data: invoice } = await supabase
                                    .from('invoices')
                                    .select('*')
                                    .eq('reference_code', refCode)
                                    .single();

                                if (invoice) {
                                    invoiceIdToProcess = invoice.id;
                                    // Default expected amount if not parsed
                                    paymentAmount = (invoice.total_amount * invoice.payment_expected_percentage) / 100;
                                }
                            }

                            // --- STRATEGY 2: Match Client by Email (Fallback) ---
                            if (!invoiceIdToProcess) {
                                console.log('No reference code found. Trying to match client by email...');
                                const { data: client } = await supabase
                                    .from('clients')
                                    .select('id')
                                    .ilike('email', fromEmail)
                                    .single();

                                if (client) {
                                    // Find oldest unpaid invoice
                                    const { data: invoice } = await supabase
                                        .from('invoices')
                                        .select('*')
                                        .eq('client_id', client.id)
                                        .neq('status', 'paid')
                                        .order('issue_date', { ascending: true })
                                        .limit(1)
                                        .single();

                                    if (invoice) {
                                        console.log(`Matched Client ${fromEmail} to Invoice #${invoice.invoice_number}`);
                                        invoiceIdToProcess = invoice.id;
                                        paymentAmount = (invoice.total_amount * invoice.payment_expected_percentage) / 100;
                                    }
                                }
                            }

                            // --- AMOUNT PARSING (Refinement) ---
                            // Try to find currency pattern like $123.45 or 123.45 USD
                            const amountRegex = /(\$|USD\s?)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i;
                            const amountMatch = text.match(amountRegex) || subject.match(amountRegex);
                            if (amountMatch) {
                                const rawAmount = amountMatch[2].replace(/,/g, '');
                                const parsedAmount = parseFloat(rawAmount);
                                if (!isNaN(parsedAmount) && parsedAmount > 0) {
                                    console.log(`Parsed Amount from email: $${parsedAmount}`);
                                    paymentAmount = parsedAmount;
                                }
                            }

                            // --- EXECUTION ---
                            if (invoiceIdToProcess && paymentAmount > 0) {
                                await processFoundPayment(invoiceIdToProcess, paymentAmount, paymentMethod, `Email: ${subject}`);
                            } else {
                                console.log('Could not match this email to any invoice or valid payment amount.');
                            }

                        });
                    });

                    msg.once('attributes', (attrs) => {
                        imap.addFlags(attrs.uid, ['\\Seen'], (err) => {
                            if (err) console.error('Error marking as seen:', err);
                        });
                    });
                });

                fetcher.once('end', () => {
                    console.log('Done fetching emails.');
                    imap.end();
                });
            });
        });
    });

    imap.once('error', (err) => {
        console.error('IMAP Error:', err);
    });

    imap.once('end', () => {
        console.log('IMAP connection ended.');
    });

    imap.connect();
}

/**
 * Helper to update DB and Trigger Automation
 */
async function processFoundPayment(invoiceId, amount, method, refId) {
    try {
        // 1. Fetch Invoice
        const { data: invoice } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
        if (!invoice) return;

        // 2. Determine Status
        let newRemaining = Number(invoice.remaining_amount) - amount;
        let newStatus = invoice.status;
        if (newRemaining <= 0.05) { // Small buffer for float math
            newRemaining = 0;
            newStatus = 'paid';
        } else {
            newStatus = 'partial';
        }

        // 3. Update Invoice
        await supabase
            .from('invoices')
            .update({ status: newStatus, remaining_amount: newRemaining })
            .eq('id', invoiceId);

        // 4. Record Payment
        await supabase.from('payments').insert({
            invoice_id: invoiceId,
            amount: amount,
            method: method,
            reference_id: refId,
            payment_date: new Date().toISOString()
        });

        console.log(`Recorded payment of $${amount} for Invoice #${invoice.invoice_number}`);

        // 5. Trigger Receipt Automation
        await sendPaymentReceipt(invoiceId);

    } catch (err) {
        console.error('Error processing found payment:', err);
    }
}

module.exports = { checkEmailsForPayments };
