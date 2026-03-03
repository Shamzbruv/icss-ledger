const { Resend } = require('resend');

// Initialize Resend
// It uses process.env.RESEND_API_KEY automatically if no argument is passed,
// but we will explicitly pass it to be safe.
const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key_for_local_dev');

/**
 * Sends an email using Resend API
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} text - Plain text body
 * @param {string} html - HTML body
 * @param {Buffer} pdfBuffer - Optional PDF buffer to attach
 * @param {string} invoiceNumber - Optional invoice number for the attachment name
 * @param {string} bcc - Optional BCC email address
 * @param {string|string[]} cc - Optional CC email address(es)
 * @returns {Promise<void>}
 */
async function sendInvoiceEmail(to, subject, text, html, pdfBuffer = null, invoiceNumber = null, bcc = null, cc = null) {
    try {
        const mailOptions = {
            // Must match the domain you verified in Resend (e.g. send.icreatesolutionsandservices.com or just the root)
            // It is usually best to use a subdomain like invoices@ or billing@
            from: 'iCreate Solutions <support@icreatesolutionsandservices.com>',
            to: Array.isArray(to) ? to : [to],
            // Resend allows multiple CC/BCC if provided as arrays
            subject: subject,
            text: text,
            html: html,
            // Ensure client replies go back to the primary Gmail inbox
            reply_to: process.env.EMAIL_USER || 'iCreatesolutions.ja@gmail.com',
        };

        if (pdfBuffer && invoiceNumber) {
            mailOptions.attachments = [
                {
                    filename: `${invoiceNumber}.pdf`,
                    content: pdfBuffer,
                    // Resend expects base64 or Buffer directly in 'content'
                },
            ];
        }

        if (bcc) {
            mailOptions.bcc = Array.isArray(bcc) ? bcc : [bcc];
        }

        if (cc) {
            mailOptions.cc = Array.isArray(cc) ? cc : [cc];
        }

        // Use Resend SDK to send the email
        const { data, error } = await resend.emails.send(mailOptions);

        if (error) {
            console.error('Resend API Error:', error);
            throw new Error(error.message || 'Failed to send email via Resend');
        }

        console.log('Resend Email sent successfully:', data ? data.id : 'No ID returned');
    } catch (error) {
        console.error('Error sending email via Resend:', error);
        throw error;
    }
}

/**
 * Sends a generic email using Resend API (used for notifications like renewals)
 */
async function sendEmail(to, subject, html, fromEmail = 'iCreate Solutions <no-reply@icreatesolutionsandservices.com>') {
    try {
        const mailOptions = {
            from: fromEmail,
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: html
        };

        const { data, error } = await resend.emails.send(mailOptions);

        if (error) {
            console.error('Resend Generic API Error:', error);
            return false;
        }

        console.log('Resend Generic Email sent successfully:', data ? data.id : 'No ID returned');
        return true;
    } catch (error) {
        console.error('Error sending generic email via Resend:', error);
        return false;
    }
}

module.exports = {
    sendInvoiceEmail,
    sendEmail
};
