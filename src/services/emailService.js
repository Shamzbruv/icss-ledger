const { Resend } = require('resend');

// Initialize Resend
// It uses process.env.RESEND_API_KEY automatically if no argument is passed,
// but we will explicitly pass it to be safe.
const resend = new Resend(process.env.RESEND_API_KEY);

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
            from: 'iCreate Solutions <invoices@icreatesolutionsandservices.com>',
            to: Array.isArray(to) ? to : [to],
            // Resend allows multiple CC/BCC if provided as arrays
            subject: subject,
            text: text,
            html: html,
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
        const data = await resend.emails.send(mailOptions);

        console.log('Resend Email sent successfully:', data.id);
    } catch (error) {
        console.error('Error sending email via Resend:', error);
        throw error;
    }
}

module.exports = {
    sendInvoiceEmail,
};
