const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key_for_local_dev');

const DEFAULT_BCC = (process.env.EMAIL_AUDIT_BCC || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

function getMergedBcc(customBcc) {
    let bccList = [...DEFAULT_BCC];
    if (customBcc) {
        if (Array.isArray(customBcc)) {
            bccList = bccList.concat(customBcc);
        } else {
            bccList = bccList.concat(customBcc.split(',').map(e => e.trim()));
        }
    }
    return [...new Set(bccList.map(email => email.toLowerCase()))];
}

function assertResendConfigured() {
    if (!process.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY is missing');
    }
}

async function sendInvoiceEmail(to, subject, text, html, pdfBuffer = null, invoiceNumber = null, bcc = null, cc = null) {
    assertResendConfigured();

    const mailOptions = {
        from: 'iCreate Solutions <support@icreatesolutionsandservices.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        text,
        html,
        reply_to: process.env.EMAIL_USER || 'support@icreatesolutionsandservices.com'
    };

    if (pdfBuffer && invoiceNumber) {
        mailOptions.attachments = [{
            filename: `${invoiceNumber}.pdf`,
            content: pdfBuffer
        }];
    }

    mailOptions.bcc = getMergedBcc(bcc);
    if (cc) mailOptions.cc = Array.isArray(cc) ? cc : [cc];

    const { data, error } = await resend.emails.send(mailOptions);
    if (error) {
        console.error('Error sending email via Resend:', error);
        throw new Error(error.message || 'Failed to send email via Resend');
    }

    console.log('Resend Email sent successfully:', data ? data.id : 'No ID returned');
}

async function sendEmail(to, subject, html, fromEmail = 'iCreate Solutions <no-reply@icreatesolutionsandservices.com>', bcc = null) {
    try {
        assertResendConfigured();

        const mailOptions = {
            from: fromEmail,
            to: Array.isArray(to) ? to : [to],
            subject,
            html
        };

        mailOptions.bcc = getMergedBcc(bcc);

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
