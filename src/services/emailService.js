const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SMTPS instead of STARTTLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
    // Force Node to use IPv4 (fixes Render -> Gmail IPv6 routing hang)
    tls: { rejectUnauthorized: false }, // Optional, sometimes helps
    family: 4,
    // Explicit timeouts to prevent Render 504 hanging
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
});

/**
 * 
 * @param {string} toEmail 
 * @param {string} subject 
 * @param {string} text 
 * @param {string} html
 * @param {Buffer} attachmentBuffer 
 * @param {string} attachmentName 
 */
/**
 * 
 * @param {string} toEmail 
 * @param {string} subject 
 * @param {string} text 
 * @param {string} html
 * @param {Buffer} attachmentBuffer 
 * @param {string} attachmentName 
 * @param {string} bccEmail 
 */
/**
 * 
 * @param {string} toEmail 
 * @param {string} subject 
 * @param {string} text 
 * @param {string} html
 * @param {Buffer} attachmentBuffer 
 * @param {string} attachmentName 
 * @param {string} bccEmail 
 * @param {string|string[]} ccEmail 
 */
async function sendInvoiceEmail(toEmail, subject, text, html, attachmentBuffer, attachmentName, bccEmail, ccEmail) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: toEmail,
        subject: subject,
        text: text,
        html: html, // HTML body
        attachments: attachmentBuffer ? [
            {
                filename: attachmentName,
                content: attachmentBuffer
            }
        ] : []
    };

    if (bccEmail) {
        mailOptions.bcc = bccEmail;
    }

    if (ccEmail) {
        mailOptions.cc = ccEmail;
    }

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

module.exports = { sendInvoiceEmail };
