const supabase = require('../db');
const { generateInvoicePDF } = require('./pdfService');
const { sendInvoiceEmail } = require('./emailService');
const { getInvoiceEmailContent } = require('./emailTemplates');
const { computeInvoiceState, validateInvoiceState } = require('./invoiceStateService');

/**
 * Handles the "Post-Payment" automation:
 * 1. Fetches full invoice context (Client, Items).
 * 2. Generates the PDF Invoice/Receipt.
 * 3. Sends the email to the client.
 * 
 * @param {string} invoiceId 
 */
async function sendPaymentReceipt(invoiceId) {
    console.log(`Starting automated receipt sending for Invoice ID: ${invoiceId}`);

    try {
        // 1. Fetch Invoice
        const { data: invoice, error: invError } = await supabase
            .from('invoices')
            .select('*')
            .eq('id', invoiceId)
            .single();

        if (invError || !invoice) {
            console.error('Automation Error: Invoice not found', invError);
            throw new Error('Invoice not found');
        }

        // 2. Fetch Client
        const { data: client, error: clientError } = await supabase
            .from('clients')
            .select('*')
            .eq('id', invoice.client_id)
            .single();

        if (clientError || !client) {
            console.error('Automation Error: Client not found', clientError);
            throw new Error('Client not found');
        }

        // 3. Fetch Invoice Items
        const { data: items, error: itemsError } = await supabase
            .from('invoice_items')
            .select('*')
            .eq('invoice_id', invoiceId);

        if (itemsError) {
            console.error('Automation Error: Items not found', itemsError);
            throw new Error('Invoice items not found');
        }

        // 3.5 Generate State and Validate (Fail Fast)
        const state = computeInvoiceState(invoice, client);
        try {
            validateInvoiceState(state);
        } catch (vErr) {
            console.error('Automation Validation Failed:', vErr.message);
            throw new Error('Consistency mismatch: ' + vErr.message);
        }

        // 4. Generate PDF
        console.log(`Generating PDF for Invoice #${invoice.invoice_number}...`);
        const pdfBuffer = await generateInvoicePDF(invoice, client, items);

        // 5. Prepare Email Content
        const emailContent = getInvoiceEmailContent(invoice, client);

        // 6. Send Email
        console.log(`Sending email to ${client.email}...`);
        await sendInvoiceEmail(
            client.email,
            emailContent.subject,
            emailContent.text,
            emailContent.html, // Pass HTML content
            pdfBuffer,
            `invoice_${invoice.invoice_number}.pdf`
        );

        console.log(`Successfully sent receipt for Invoice #${invoice.invoice_number}`);
        return true;

    } catch (err) {
        console.error('Failed to send payment receipt:', err);
        return false; // Don't crash the caller, just report failure
    }
}

module.exports = { sendPaymentReceipt };
