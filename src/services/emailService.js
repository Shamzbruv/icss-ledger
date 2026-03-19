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
 * @returns {Promise<void>}
 */
const nodemailer = require('nodemailer');

// Initialize Nodemailer Transport as fallback
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
    }
});

async function sendInvoiceEmail(to, subject, text, html, pdfBuffer = null, invoiceNumber = null, bcc = null, cc = null) {
    if (!process.env.RESEND_API_KEY) {
        console.log('No RESEND_API_KEY found, falling back to Nodemailer (Gmail)');
        try {
            const mailOptions = {
                from: process.env.EMAIL_USER || 'iCreate Solutions <support@icreatesolutionsandservices.com>',
                to: Array.isArray(to) ? to.join(', ') : to,
                subject: subject,
                text: text,
                html: html,
                replyTo: process.env.EMAIL_USER
            };

            if (pdfBuffer && invoiceNumber) {
                mailOptions.attachments = [{
                    filename: `${invoiceNumber}.pdf`,
                    content: pdfBuffer
                }];
            }

            if (bcc) mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;
            if (cc) mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;

            const info = await transporter.sendMail(mailOptions);
            console.log('Nodemailer Email sent successfully:', info.messageId);
            return;
        } catch (error) {
            console.error('Error sending email via Nodemailer:', error);
            throw error;
        }
    }

    // Original Resend Logic
    try {
        const mailOptions = {
            from: 'iCreate Solutions <support@icreatesolutionsandservices.com>',
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            text: text,
            html: html,
            reply_to: process.env.EMAIL_USER || 'iCreatesolutions.ja@gmail.com',
        };

        if (pdfBuffer && invoiceNumber) {
            mailOptions.attachments = [{
                filename: `${invoiceNumber}.pdf`,
                content: pdfBuffer
            }];
        }

        if (bcc) mailOptions.bcc = Array.isArray(bcc) ? bcc : [bcc];
        if (cc) mailOptions.cc = Array.isArray(cc) ? cc : [cc];

        const { data, error } = await resend.emails.send(mailOptions);
        if (error) throw new Error(error.message || 'Failed to send email via Resend');
        console.log('Resend Email sent successfully:', data ? data.id : 'No ID returned');
    } catch (error) {
        console.error('Error sending email via Resend:', error);
        throw error;
    }
}

/**
 * Sends a generic email using Resend API (used for notifications like renewals)
 */
async function sendEmail(to, subject, html, fromEmail = 'iCreate Solutions <no-reply@icreatesolutionsandservices.com>', bcc = null) {
    if (!process.env.RESEND_API_KEY) {
        try {
            const mailOptions = {
                from: process.env.EMAIL_USER || fromEmail,
                to: Array.isArray(to) ? to.join(', ') : to,
                subject: subject,
                html: html
            };
            if (bcc) mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;
            
            const info = await transporter.sendMail(mailOptions);
            console.log('Nodemailer Generic Email sent successfully:', info.messageId);
            return true;
        } catch (error) {
            console.error('Error sending generic email via Nodemailer:', error);
            return false;
        }
    }

    try {
        const mailOptions = {
            from: fromEmail,
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: html
        };

        if (bcc) {
            mailOptions.bcc = Array.isArray(bcc) ? bcc : [bcc];
        }

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
