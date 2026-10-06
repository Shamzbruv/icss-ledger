/**
 * iCreate Solutions & Services - Smart Email Template System
 */

const { formatMoney, COMPANY_EMAIL, COMPANY_PHONE } = require('./contractTemplate');
const { findTemplate: findPartnerTemplate, buildPartnerContractData } = require('./partnerContractTemplate');
const { referralSummaryRows, formatJmd, percentText } = require('./referralContractTemplate');

const SERVICE_NAMES = {
  'WEB': 'Website Development',
  'APP': 'App Development',
  'GD': 'Graphic Designs',
  'HOST_PRO': 'Hosting Only',
  'HOST_DOM': 'Hosting + Domain Management',
  'MAINT': 'Web Maintenance',
  'MONITOR': 'App Monitoring',
  'AUTO_BIZ': 'Business Automation',
  'AUTO_IND': 'Industry Automation',
  'REFRESH': 'Content Refresh',
  'CON': 'Consultation',
  'CUST': 'Custom Service'
};

function getServiceName(code) {
  return SERVICE_NAMES[code] || code || 'Service';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function safeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function formatCurrency(amount, currency = 'JMD') {
  const normalized = String(currency || 'JMD').toUpperCase() === 'USD' ? 'USD' : 'JMD';
  return new Intl.NumberFormat(normalized === 'USD' ? 'en-US' : 'en-JM', {
    style: 'currency', currency: normalized, currencyDisplay: 'code'
  }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  // Use UTC to prevent local timezone shifts from changing the day
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function getSubscriptionBillingCycle(service = {}, plan = {}) {
  const supportedCycles = new Set(['monthly', 'yearly']);
  const candidates = [
    service.service_meta_json?.billing_cycle,
    plan.billing_cycle,
    plan.default_frequency
  ];
  const resolved = candidates
    .map(value => String(value || '').trim().toLowerCase())
    .find(value => supportedCycles.has(value)) || 'monthly';
  return resolved.charAt(0).toUpperCase() + resolved.slice(1);
}

function getInvoiceOutstandingBalance(invoice = {}) {
  const candidates = [invoice.balance_due, invoice.remaining_amount];
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && candidate !== '') {
      const amount = Number(candidate);
      if (Number.isFinite(amount)) return Math.max(0, amount);
    }
  }
  const total = Number(invoice.total_amount) || 0;
  const paid = Number(invoice.amount_paid) || 0;
  return Math.max(0, total - paid);
}

function getBaseHtml(bodyContent) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: 'Helvetica', 'Arial', sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px; }
            .header { text-align: center; margin-bottom: 20px; }
            .header h2 { color: #0056b3; }
            .content { margin-bottom: 20px; }
            .details { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
            .details strong { display: inline-block; width: 140px; }
            .footer { font-size: 12px; color: #888; text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                 <h2>iCreate Solutions & Services</h2>
            </div>
            <div class="content">
                ${bodyContent}
            </div>
            <div class="footer">
                <p>&copy; ${new Date().getFullYear()} iCreate Solutions & Services. All rights reserved.</p>
                <p>Powered by iCreate Solutions & Services</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Selects and generates the appropriate email content based on invoice context.
 * @param {Object} invoice 
 * @param {Object} client 
 * @returns {Object} { subject, text, html }
 */
const { computeInvoiceState } = require('./invoiceStateService');

function getInvoiceEmailContent(invoice, client) {
  const state = computeInvoiceState(invoice, client);

  if (state.isSubscription) {
    return getSubscriptionTemplate(state, client, invoice);
  }

  return getUnifiedStatusTemplate(state, client, invoice);
}

function getUnifiedStatusTemplate(state, client, invoice) {
  const detailsHtml = state.emailSummaryRows.map(row =>
    `<p><strong>${row.label}:</strong> ${row.value}</p>`
  ).join('');

  const notesHtml = invoice.notes ? `
        <div class="notes" style="margin-top: 20px; padding: 15px; background: #fff8e1; border-left: 4px solid #ffc107; border-radius: 4px;">
            <h4 style="margin-top: 0; color: #856404;">Additional Notes</h4>
            <p style="margin-bottom: 0; white-space: pre-wrap;">${invoice.notes}</p>
        </div>
    ` : '';

  const htmlBody = `
        <p>Hello <strong>${client.name}</strong>,</p>
        <p>Your invoice for <strong>${state.serviceType}</strong> is attached. Status: <strong>${state.paymentStatus}</strong>.</p>
        
        <div class="details">
            <h3>Invoice Summary</h3>
            ${detailsHtml}
        </div>
        ${notesHtml}

        <p>Thank you for your business. Please reach out if you have any questions.</p>
    `;

  return {
    subject: state.emailSubjectText,
    text: `Hello ${client.name}, ${state.emailSubjectText}. Details: ${state.emailSummaryRows.map(r => `${r.label}: ${r.value}`).join(', ')}${invoice.notes ? `\n\nNotes:\n${invoice.notes}` : ''}`,
    html: getBaseHtml(htmlBody)
  };
}

function getSubscriptionTemplate(state, client, invoice) {
  const detailsHtml = state.emailSummaryRows.map(row =>
    `<p><strong>${row.label}:</strong> ${row.value}</p>`
  ).join('');

  const notesHtml = invoice.notes ? `
        <div class="notes" style="margin-top: 20px; padding: 15px; background: #fff8e1; border-left: 4px solid #ffc107; border-radius: 4px;">
            <h4 style="margin-top: 0; color: #856404;">Additional Notes</h4>
            <p style="margin-bottom: 0; white-space: pre-wrap;">${invoice.notes}</p>
        </div>
    ` : '';

  const htmlBody = `
        <p>Hello <strong>${client.name}</strong>,</p>
        <p>Your subscription for <strong>${state.serviceType}</strong> is active.</p>
        
        <div class="details">
            <h3>Subscription Details</h3>
            ${detailsHtml}
        </div>
        ${notesHtml}

        <p>This subscription will automatically renew unless canceled prior to the renewal date.</p>
    `;

  return {
    subject: state.emailSubjectText,
    text: `Hello ${client.name}, ${state.emailSubjectText}.${invoice.notes ? `\n\nNotes:\n${invoice.notes}` : ''}`,
    html: getBaseHtml(htmlBody)
  };
}


// ... (existing code)

/**
 * Client Care report emails.
 *
 * The weekly and monthly reports are generated by the care/ modules (plain-language findings,
 * tier-specific detail, real visitor figures). These wrappers keep the original function names
 * and signatures so any existing caller keeps working.
 */
function getClientCarePulseEmailContent(runData, client, plan, items) {
  const { buildWeeklyReport } = require('./care/careReport');
  const { renderWeeklyHtml, renderWeeklyText } = require('./care/careReportEmail');
  const { resolveTier } = require('./care/carePlans');
  const service = { service_meta_json: {}, service_plans: plan || {} };
  const model = buildWeeklyReport({
    service, client, tier: resolveTier(service), results: Array.isArray(items) ? items : [],
    now: runData?.created_at ? new Date(runData.created_at) : new Date(),
    periodStart: runData?.period_start, periodEnd: runData?.period_end
  });
  return { subject: model.subject, text: renderWeeklyText(model), html: renderWeeklyHtml(model) };
}

/**
 * Generates the Monthly Pulse Summary Email
 * @param {Object} summary - The summary object from DB
 * @param {Object} client - Client details
 * @param {Object} [extra] - Optional { runs, service } to include visitor and speed detail
 */
function getMonthlySummaryEmailContent(summary, client, extra = {}) {
  const { buildMonthlyReport } = require('./care/careReport');
  const { renderMonthlyHtml, renderMonthlyText } = require('./care/careReportEmail');
  const { resolveTier } = require('./care/carePlans');
  const service = extra.service || {};
  const model = buildMonthlyReport({ monthStr: summary.month, runs: extra.runs || [], summary, client, service, tier: resolveTier(service) });
  return { subject: model.subject, text: renderMonthlyText(model), html: renderMonthlyHtml(model) };
}

/**
 * Generates an elegant Payment Declined Email Template
 * @param {Object} invoice - The invoice/subscription details
 * @param {Object} client - Client details
 */
function getPaymentDeclinedTemplate(invoice, client) {
  const serviceName = invoice.plan_name || invoice.service_code || 'Service Subscription';
  const amountDue = formatCurrency(getInvoiceOutstandingBalance(invoice), invoice.currency);
  const invoiceNumber = invoice.invoice_number || 'Auto-Billing';
  const dueDate = invoice.due_date ? formatDate(invoice.due_date) : 'Immediately';

  const subject = `⚠️ Action Required: Payment Declined — ${serviceName}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Payment Declined — iCreate Solutions & Services</title>
</head>
<body style="margin:0; padding:0; background-color:#f2f2f7; font-family:'Inter','Helvetica Neue',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.10);">

          <!-- ═══ HEADER BANNER ═══ -->
          <tr>
            <td style="background: linear-gradient(135deg, #c0392b 0%, #922b21 100%); padding: 42px 40px; text-align:center;">
              <div style="width:64px; height:64px; background:rgba(255,255,255,0.15); border-radius:50%; margin:0 auto 18px auto; display:flex; align-items:center; justify-content:center;">
                <span style="font-size:32px; line-height:1;">⚠️</span>
              </div>
              <p style="margin:0 0 6px 0; color:rgba(255,255,255,0.75); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:2px;">Payment Notice</p>
              <h1 style="margin:0; color:#ffffff; font-size:26px; font-weight:700; letter-spacing:-0.5px;">Payment Declined</h1>
              <p style="margin:12px 0 0 0; color:rgba(255,255,255,0.8); font-size:14px;">Immediate attention required to keep your services active</p>
            </td>
          </tr>

          <!-- ═══ BODY CONTENT ═══ -->
          <tr>
            <td style="padding: 40px 44px 10px 44px;">
              <p style="margin:0 0 10px 0; font-size:17px; color:#1a1a1a; font-weight:600;">Hello ${client.name},</p>
              <p style="margin:0 0 28px 0; font-size:15px; color:#555555; line-height:1.7;">
                We attempted to process the payment for your <strong style="color:#1a1a1a;">${serviceName}</strong> on your account, but unfortunately the transaction was declined. To avoid any interruption to your services, please update your payment information as soon as possible.
              </p>

              <!-- ═══ INVOICE DETAIL CARD ═══ -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5; border-radius:14px; border:1.5px solid #f5c6c6; padding:0; margin-bottom:30px;">
                <tr>
                  <td style="padding: 22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#c0392b;">Payment Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #f0c0c0; color:#777; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Service / Plan</td>
                        <td style="padding:8px 0; border-bottom:1px solid #f0c0c0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${serviceName}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #f0c0c0; color:#777; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Reference #</td>
                        <td style="padding:8px 0; border-bottom:1px solid #f0c0c0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${invoiceNumber}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #f0c0c0; color:#777; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Payment Due</td>
                        <td style="padding:8px 0; border-bottom:1px solid #f0c0c0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${dueDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:14px 0 0 0; color:#c0392b; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Amount Due</td>
                        <td style="padding:14px 0 0 0; text-align:right; font-weight:800; color:#c0392b; font-size:22px;">${amountDue}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- ═══ WHAT TO DO NEXT ═══ -->
              <p style="margin:0 0 12px 0; font-size:14px; font-weight:700; color:#1a1a1a; text-transform:uppercase; letter-spacing:0.5px;">What you can do:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px;">
                <tr>
                  <td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                    <span style="display:inline-block; width:28px; height:28px; background:#fff5f5; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#c0392b; margin-right:12px; vertical-align:middle;">1</span>
                    <span style="font-size:14px; color:#444; vertical-align:middle;">Verify your card details are correct and current</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                    <span style="display:inline-block; width:28px; height:28px; background:#fff5f5; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#c0392b; margin-right:12px; vertical-align:middle;">2</span>
                    <span style="font-size:14px; color:#444; vertical-align:middle;">Confirm sufficient funds are available</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;">
                    <span style="display:inline-block; width:28px; height:28px; background:#fff5f5; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#c0392b; margin-right:12px; vertical-align:middle;">3</span>
                    <span style="font-size:14px; color:#444; vertical-align:middle;">Contact us to provide a new payment method</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══ CTA BUTTON ═══ -->
          <tr>
            <td style="padding: 0 44px 36px 44px; text-align:center;">
              <a href="mailto:support@icreatesolutionsandservices.com?subject=Update%20Payment%20Method%20-%20${invoiceNumber}&body=Hi%2C%20I%20would%20like%20to%20update%20my%20payment%20method%20for%20invoice%20${invoiceNumber}."
                 style="display:inline-block; background:linear-gradient(135deg, #c0392b 0%, #922b21 100%); color:#ffffff; text-decoration:none; padding:16px 36px; border-radius:50px; font-weight:700; font-size:15px; letter-spacing:0.3px; box-shadow:0 8px 24px rgba(192,57,43,0.35);">
                Update Payment Method →
              </a>
              <p style="margin:16px 0 0 0; font-size:13px; color:#999;">Or reply directly to this email and our team will assist you right away.</p>
            </td>
          </tr>

          <!-- ═══ WARNING STRIP ═══ -->
          <tr>
            <td style="background:#fef9f9; border-top:1px solid #f5c6c6; padding:18px 44px;">
              <p style="margin:0; font-size:13px; color:#c0392b; text-align:center; font-weight:500;">
                ⚠️ &nbsp;Failure to resolve this within <strong>7 days</strong> may result in temporary suspension of your services.
              </p>
            </td>
          </tr>

          <!-- ═══ FOOTER ═══ -->
          <tr>
            <td style="background:#1a1a1a; padding:28px 44px; text-align:center;">
              <p style="margin:0 0 6px 0; color:#ffffff; font-size:14px; font-weight:600;">iCreate Solutions &amp; Services</p>
              <p style="margin:0; color:#888; font-size:12px;">© ${new Date().getFullYear()} iCreate Solutions &amp; Services. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textBody = `Hello ${client.name},\n\nACTION REQUIRED: Payment Declined\n\nWe were unable to process your payment for ${serviceName}.\n\nInvoice Reference: ${invoiceNumber}\nAmount Due: ${amountDue}\nPayment Due: ${dueDate}\n\nTo avoid service interruption, please:\n1. Verify your card details are correct\n2. Confirm sufficient funds are available\n3. Contact us to provide a new payment method\n\nReply to this email or contact: support@icreatesolutionsandservices.com\n\nFailure to resolve within 7 days may result in temporary suspension of services.\n\nThank you,\niCreate Solutions & Services`;

  return { subject, text: textBody, html };
}

/**
 * Outstanding-balance notice for ordinary invoices. This intentionally avoids
 * saying that a charge was attempted or declined; only PayPal subscription
 * failure webhooks may make that claim.
 */
function getInvoiceDelinquencyTemplate(invoice, client) {
  const clientName = escapeHtml(client?.name || 'Valued Client');
  const invoiceNumber = escapeHtml(invoice.invoice_number || 'Invoice');
  const serviceName = escapeHtml(getServiceName(invoice.service_code || invoice.plan_name || 'Service'));
  const dueDate = invoice.due_date ? formatDate(invoice.due_date) : 'Due now';
  const invoiceAmount = formatCurrency(Number(invoice.total_amount) || 0, invoice.currency);
  const amountPaid = formatCurrency(Number(invoice.amount_paid) || 0, invoice.currency);
  const balance = formatCurrency(getInvoiceOutstandingBalance(invoice), invoice.currency);
  const plainInvoiceNumber = safeHeader(invoice.invoice_number || 'Invoice');
  const subject = `URGENT: Outstanding Balance Requires Attention — ${plainInvoiceNumber}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Outstanding Balance Notice</title></head>
<body style="margin:0;padding:0;background:#f3f5f8;font-family:Inter,Arial,sans-serif;color:#172033;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Immediate attention required: ${balance} remains outstanding on ${invoiceNumber}.</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 16px;background:#f3f5f8;"><tr><td align="center">
    <table width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,.10);">
      <tr><td style="padding:36px 40px;background:linear-gradient(135deg,#b42318,#7a170f);color:#fff;text-align:center;">
        <div style="display:inline-block;margin:0 0 14px;padding:7px 13px;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:rgba(255,255,255,.12);font-size:12px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;">Immediate action required</div>
        <h1 style="margin:0;font-size:30px;line-height:1.2;">Outstanding Balance Alert</h1>
        <p style="margin:12px 0 0;color:#fee4e2;font-size:15px;font-weight:600;">This account requires your prompt attention</p>
      </td></tr>
      <tr><td style="padding:36px 40px 12px;">
        <p style="margin:0 0 14px;font-size:17px;font-weight:700;">Hello ${clientName},</p>
        <p style="margin:0 0 24px;color:#344054;font-size:15px;line-height:1.7;"><strong style="color:#b42318;">Please address this balance immediately.</strong> Our records show an outstanding amount on invoice <strong>${invoiceNumber}</strong> for ${serviceName}. This notice does not mean that a payment attempt was declined.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #f04438;border-radius:14px;background:#fff6f5;">
          <tr><td style="padding:22px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:8px 0;color:#718096;">Invoice</td><td style="padding:8px 0;text-align:right;font-weight:700;">${invoiceNumber}</td></tr>
              <tr><td style="padding:8px 0;color:#718096;">Due date</td><td style="padding:8px 0;text-align:right;font-weight:700;">${dueDate}</td></tr>
              <tr><td style="padding:8px 0;color:#718096;">Original amount</td><td style="padding:8px 0;text-align:right;font-weight:700;">${invoiceAmount}</td></tr>
              <tr><td style="padding:8px 0 14px;color:#718096;border-bottom:1px solid #dbe4ee;">Payments received</td><td style="padding:8px 0 14px;text-align:right;font-weight:700;border-bottom:1px solid #dbe4ee;">${amountPaid}</td></tr>
              <tr><td style="padding:16px 0 0;color:#b42318;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;">Amount requiring attention</td><td style="padding:16px 0 0;text-align:right;color:#b42318;font-size:25px;font-weight:900;">${balance}</td></tr>
            </table>
          </td></tr>
        </table>
        <div style="margin:24px 0 0;padding:16px 18px;border-left:5px solid #f04438;background:#fff1f0;color:#7a271a;font-size:14px;line-height:1.6;"><strong>Action required:</strong> Please settle the outstanding amount or contact us promptly to discuss payment arrangements. If payment has already been arranged, reply with the relevant details so we can update the account.</div>
      </td></tr>
      <tr><td style="padding:22px 40px 32px;text-align:center;"><a href="mailto:support@icreatesolutionsandservices.com?subject=Urgent%20Outstanding%20Balance%20-%20${encodeURIComponent(plainInvoiceNumber)}" style="display:inline-block;padding:15px 30px;border-radius:999px;background:#b42318;color:#fff;text-decoration:none;font-weight:800;box-shadow:0 8px 20px rgba(180,35,24,.28);">Resolve Outstanding Balance</a></td></tr>
      <tr><td style="padding:22px 40px;background:#0b1220;color:#a9b6c8;text-align:center;font-size:12px;">iCreate Solutions &amp; Services</td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = `Hello ${safeHeader(client?.name || 'Valued Client')},\n\nURGENT — OUTSTANDING BALANCE REQUIRES ATTENTION\n\nPlease address this balance immediately. Our records show an outstanding amount on invoice ${plainInvoiceNumber}. This notice does not mean that a payment attempt was declined.\n\nOriginal amount: ${invoiceAmount}\nPayments received: ${amountPaid}\nAmount requiring attention: ${balance}\nDue date: ${dueDate}\n\nPlease settle the outstanding amount or contact us promptly to discuss payment arrangements. If payment has already been arranged, reply with the relevant details.\n\niCreate Solutions & Services`;
  return { subject, html, text };
}

/**
 * Payment Nudge Email — sent from Client Care section for subscription payment reminders
 * TO: client   |   BCC: owner (handled by the route)
 * @param {Object} service - client_service row (has frequency, next_renewal_date etc.)
 * @param {Object} client  - clients row (name, email)
 * @param {Object} plan    - service_plans row (name, price etc.)
 */
function getPaymentNudgeTemplate(service, client, plan) {
  const planName = plan?.name || service?.service_meta_json?.planName || 'your subscription';
  const frequency = getSubscriptionBillingCycle(service, plan);
  const billingPeriodUnit = frequency === 'Yearly' ? 'year' : 'month';
  const renewalRaw = service?.next_renewal_date;
  const renewal = renewalRaw ? formatDate(renewalRaw) : null;
  const price = plan?.price ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(plan.price) : null;

  const subject = `Action Required: Please Update Your Payment Details — ${planName}`;

  const renewalRow = renewal ? `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #e8e4ff; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Next Renewal</td>
        <td style="padding:8px 0; border-bottom:1px solid #e8e4ff; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${renewal}</td>
      </tr>` : '';

  const priceRow = price ? `
      <tr>
        <td style="padding:10px 0 0 0; color:#4f46e5; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Subscription Amount</td>
        <td style="padding:10px 0 0 0; text-align:right; font-weight:800; color:#4f46e5; font-size:20px;">${price}<span style="font-size:12px; font-weight:500; color:#888;">/${billingPeriodUnit}</span></td>
      </tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Payment Reminder — iCreate Solutions & Services</title>
</head>
<body style="margin:0; padding:0; background:#f0f0f5; font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f5; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.10);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding:44px 40px; text-align:center;">
              <p style="margin:0 0 8px 0; color:rgba(255,255,255,0.7); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:2px;">Subscription Notice</p>
              <h1 style="margin:0 0 10px 0; color:#ffffff; font-size:26px; font-weight:700; letter-spacing:-0.5px;">Payment Update Required</h1>
              <p style="margin:0; color:rgba(255,255,255,0.8); font-size:14px; line-height:1.5;">We need you to review your payment details to keep your services running smoothly.</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:38px 44px 10px 44px;">
              <p style="margin:0 0 8px 0; font-size:17px; color:#1a1a1a; font-weight:600;">Hi ${client.name},</p>
              <p style="margin:0 0 28px 0; font-size:15px; color:#555; line-height:1.7;">
                We noticed there may be an issue with the payment method on file for your <strong style="color:#1a1a1a;">${planName}</strong> subscription. To avoid any interruption to your services, please take a moment to verify or update your payment details.
              </p>

              <!-- SUBSCRIPTION CARD -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff; border-radius:14px; border:1.5px solid #ddd6fe; margin-bottom:30px;">
                <tr>
                  <td style="padding:22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#4f46e5;">Subscription Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e8e4ff; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Plan</td>
                        <td style="padding:8px 0; border-bottom:1px solid #e8e4ff; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${planName}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e8e4ff; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Billing Cycle</td>
                        <td style="padding:8px 0; border-bottom:1px solid #e8e4ff; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${frequency}</td>
                      </tr>
                      ${renewalRow}
                      ${priceRow}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- STEPS -->
              <p style="margin:0 0 12px 0; font-size:14px; font-weight:700; color:#1a1a1a; text-transform:uppercase; letter-spacing:0.5px;">What to do:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px;">
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f3ff; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#4f46e5; margin-right:12px; vertical-align:middle;">1</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Check that your payment method is valid and up to date</span>
                </td></tr>
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f3ff; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#4f46e5; margin-right:12px; vertical-align:middle;">2</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Ensure sufficient funds are available for your next billing cycle</span>
                </td></tr>
                <tr><td style="padding:10px 0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f3ff; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#4f46e5; margin-right:12px; vertical-align:middle;">3</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Reply to this email or reach out to us directly if you need assistance</span>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 44px 36px 44px; text-align:center;">
              <a href="mailto:support@icreatesolutionsandservices.com?subject=Payment%20Update%20-%20${encodeURIComponent(planName)}&body=Hi%2C%20I%20would%20like%20to%20update%20my%20payment%20details%20for%20my%20${encodeURIComponent(planName)}%20subscription."
                 style="display:inline-block; background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%); color:#ffffff; text-decoration:none; padding:16px 36px; border-radius:50px; font-weight:700; font-size:15px; box-shadow:0 8px 24px rgba(79,70,229,0.35);">
                Contact Us to Update Payment →
              </a>
              <p style="margin:14px 0 0 0; font-size:13px; color:#999;">Simply reply to this email — we're here to help.</p>
            </td>
          </tr>

          <!-- NOTE STRIP -->
          <tr>
            <td style="background:#fafafa; border-top:1px solid #ece9ff; padding:16px 44px;">
              <p style="margin:0; font-size:13px; color:#888; text-align:center;">
                If you believe this is an error or have already updated your details, please disregard this message.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1a1a1a; padding:28px 44px; text-align:center;">
              <p style="margin:0 0 6px 0; color:#fff; font-size:14px; font-weight:600;">iCreate Solutions &amp; Services</p>
              <p style="margin:0; color:#888; font-size:12px;">© ${new Date().getFullYear()} iCreate Solutions &amp; Services. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

/**
 * Upcoming Subscription Renewal Email Template
 * Expected to return raw HTML string for the cron reminder engine.
 * @param {Object} service - client_service row (has clients and service_plans joined)
 */
function getSubscriptionRenewalTemplate(service) {
  const client = service.clients || { name: 'Valued Client' };
  const plan = service.service_plans || { name: 'Service Subscription', price: 0 };

  const renewalRaw = service.next_renewal_date;
  const renewalDate = renewalRaw ? formatDate(renewalRaw) : 'Soon';
  const frequency = getSubscriptionBillingCycle(service, plan);
  const billingPeriodUnit = frequency === 'Yearly' ? 'year' : 'month';
  const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(plan.price || 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Subscription Renewal — iCreate Solutions & Services</title>
</head>
<body style="margin:0; padding:0; background:#f0f0f5; font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f5; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.10);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg, #0056b3 0%, #003d82 100%); padding:44px 40px; text-align:center;">
              <p style="margin:0 0 8px 0; color:rgba(255,255,255,0.7); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:2px;">Automated Notice</p>
              <h1 style="margin:0 0 10px 0; color:#ffffff; font-size:26px; font-weight:700; letter-spacing:-0.5px;">Upcoming Renewal</h1>
              <p style="margin:0; color:rgba(255,255,255,0.8); font-size:14px; line-height:1.5;">Your subscription will automatically renew soon.</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:38px 44px 10px 44px;">
              <p style="margin:0 0 8px 0; font-size:17px; color:#1a1a1a; font-weight:600;">Hi ${client.name},</p>
              <p style="margin:0 0 28px 0; font-size:15px; color:#555; line-height:1.7;">
                This is a courtesy reminder that your subscription for <strong style="color:#1a1a1a;">${plan.name}</strong> is scheduled to automatically renew on <strong>${renewalDate}</strong>.
              </p>

              <!-- SUBSCRIPTION CARD -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa; border-radius:14px; border:1.5px solid #e9ecef; margin-bottom:30px;">
                <tr>
                  <td style="padding:22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#0056b3;">Subscription Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #dee2e6; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Plan</td>
                        <td style="padding:8px 0; border-bottom:1px solid #dee2e6; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${plan.name}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #dee2e6; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Billing Cycle</td>
                        <td style="padding:8px 0; border-bottom:1px solid #dee2e6; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${frequency}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #dee2e6; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Renewal Date</td>
                        <td style="padding:8px 0; border-bottom:1px solid #dee2e6; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${renewalDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0 0 0; color:#0056b3; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Amount Due</td>
                        <td style="padding:10px 0 0 0; text-align:right; font-weight:800; color:#0056b3; font-size:20px;">${price}<span style="font-size:12px; font-weight:500; color:#888;">/${billingPeriodUnit}</span></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 28px 0; font-size:14px; color:#777; line-height:1.7;">
                If your payment information is up to date, no action is required on your part. Your card on file will be charged automatically. If you need to make changes, please ensure they are completed before the renewal.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 44px 36px 44px; text-align:center;">
              <a href="mailto:support@icreatesolutionsandservices.com?subject=Manage%20Subscription%20-%20${encodeURIComponent(plan.name)}"
                 style="display:inline-block; background:linear-gradient(135deg,#0056b3 0%,#003d82 100%); color:#ffffff; text-decoration:none; padding:16px 36px; border-radius:50px; font-weight:700; font-size:15px; box-shadow:0 8px 24px rgba(0,86,179,0.35);">
                Manage Subscription Options →
              </a>
            </td>
          </tr>

          <!-- NOTE STRIP -->
          <tr>
            <td style="background:#fafafa; border-top:1px solid #ece9ff; padding:16px 44px;">
              <p style="margin:0; font-size:13px; color:#888; text-align:center;">
                If you have any questions or require assistance, simply reply to this email.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1a1a1a; padding:28px 44px; text-align:center;">
              <p style="margin:0 0 6px 0; color:#fff; font-size:14px; font-weight:600;">iCreate Solutions &amp; Services</p>
              <p style="margin:0; color:#888; font-size:12px;">© ${new Date().getFullYear()} iCreate Solutions &amp; Services. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return html;
}


/**
 * Welcome / Onboarding Email — sent the moment a client's first subscription is activated.
 * Distinct from the invoice email: this is a warm intro, not a billing notice.
 * @param {Object} service - client_services row (with clients and service_plans joined)
 */
function getWelcomeSubscriptionTemplate(service) {
  const client = service.clients || { name: 'Valued Client' };
  const plan   = service.service_plans || { name: 'Subscription Service', price: 0 };
  const clientName = escapeHtml(client.name || 'Valued Client');
  const planName = escapeHtml(plan.name || 'Subscription Service');
  const plainClientName = safeHeader(client.name || 'Valued Client');
  const plainPlanName = safeHeader(plan.name || 'Subscription Service');

  const freq = getSubscriptionBillingCycle(service, plan);
  const billingPeriodUnit = freq === 'Yearly' ? 'year' : 'month';

  const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(plan.price || 0);
  const renewalDate = service.next_renewal_date ? formatDate(service.next_renewal_date) : null;

  const subject = `Welcome to iCreate Solutions & Services - ${plainPlanName} is Active!`;

  const renewalRow = renewalDate ? `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">First Renewal</td>
        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${renewalDate}</td>
      </tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome — iCreate Solutions & Services</title>
</head>
<body style="margin:0; padding:0; background-color:#f0fdf4; font-family:'Inter','Helvetica Neue',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.10);">

          <!-- HEADER BANNER -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 48px 40px; text-align:center;">
              <div style="width:70px; height:70px; background:rgba(255,255,255,0.15); border-radius:50%; margin:0 auto 18px auto; display:flex; align-items:center; justify-content:center;">
                <span style="font-size:36px; line-height:1;">🎉</span>
              </div>
              <p style="margin:0 0 6px 0; color:rgba(255,255,255,0.8); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:2px;">Welcome Aboard</p>
              <h1 style="margin:0 0 10px 0; color:#ffffff; font-size:28px; font-weight:700; letter-spacing:-0.5px;">You're All Set!</h1>
              <p style="margin:0; color:rgba(255,255,255,0.85); font-size:15px; line-height:1.6;">Your subscription to <strong>${planName}</strong> is now active.</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding: 40px 44px 10px 44px;">
              <p style="margin:0 0 10px 0; font-size:17px; color:#1a1a1a; font-weight:600;">Hello ${clientName},</p>
              <p style="margin:0 0 28px 0; font-size:15px; color:#555555; line-height:1.7;">
                Thank you for choosing <strong style="color:#1a1a1a;">iCreate Solutions &amp; Services</strong>. We're thrilled to have you with us. Your <strong style="color:#059669;">${planName}</strong> plan is active and we're already working behind the scenes to keep your digital presence in top shape.
              </p>

              <!-- SUBSCRIPTION CARD -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; border-radius:14px; border:1.5px solid #a7f3d0; margin-bottom:30px;">
                <tr>
                  <td style="padding: 22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#059669;">Your Subscription</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Plan</td>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${planName}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; color:#6b7280; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Billing Cycle</td>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${freq}</td>
                      </tr>
                      ${renewalRow}
                      <tr>
                        <td style="padding:10px 0 0 0; color:#059669; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Amount</td>
                        <td style="padding:10px 0 0 0; text-align:right; font-weight:800; color:#059669; font-size:20px;">${price}<span style="font-size:12px; font-weight:500; color:#888;">/${billingPeriodUnit}</span></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- WHAT HAPPENS NEXT -->
              <p style="margin:0 0 12px 0; font-size:14px; font-weight:700; color:#1a1a1a; text-transform:uppercase; letter-spacing:0.5px;">What happens next:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px;">
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f0fdf4; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#059669; margin-right:12px; vertical-align:middle;">1</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Subscription payments are tracked automatically without generating invoices</span>
                </td></tr>
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f0fdf4; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#059669; margin-right:12px; vertical-align:middle;">2</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Your subscription automatically renews — no action needed</span>
                </td></tr>
                <tr><td style="padding:10px 0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f0fdf4; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#059669; margin-right:12px; vertical-align:middle;">3</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Reply to this email anytime — we're here to help</span>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 44px 36px 44px; text-align:center;">
              <a href="mailto:support@icreatesolutionsandservices.com?subject=Question%20about%20my%20${encodeURIComponent(plainPlanName)}%20subscription"
                 style="display:inline-block; background:linear-gradient(135deg, #059669 0%, #047857 100%); color:#ffffff; text-decoration:none; padding:16px 36px; border-radius:50px; font-weight:700; font-size:15px; letter-spacing:0.3px; box-shadow:0 8px 24px rgba(5,150,105,0.35);">
                Contact Support →
              </a>
              <p style="margin:16px 0 0 0; font-size:13px; color:#999;">Or simply reply to this email — we'd love to hear from you.</p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1a1a1a; padding:28px 44px; text-align:center;">
              <p style="margin:0 0 6px 0; color:#ffffff; font-size:14px; font-weight:600;">iCreate Solutions &amp; Services</p>
              <p style="margin:0; color:#888; font-size:12px;">© ${new Date().getFullYear()} iCreate Solutions &amp; Services. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textBody = `Hello ${plainClientName},\n\nWelcome to iCreate Solutions & Services!\n\nYour ${plainPlanName} subscription is now active.\n\nPlan: ${plainPlanName}\nBilling Cycle: ${freq}\nAmount: ${price}/${billingPeriodUnit}${renewalDate ? `\nFirst Renewal: ${renewalDate}` : ''}\n\nYour subscription auto-renews, so no action is needed. Subscription payments are tracked separately and do not generate invoices.\n\nQuestions? Reply to this email or contact: support@icreatesolutionsandservices.com\n\nWelcome aboard,\niCreate Solutions & Services`;

  return { subject, html, text: textBody };
}

/**
 * Contract Signing Request — sent when the admin clicks "Send" on a contract.
 * @param {Object} contract - contracts row
 * @param {string} signUrl - full public link to the sign page
 */
function getContractSigningRequestTemplate(contract, signUrl, companySignatureUrl = null) {
  const clientName = escapeHtml(contract.client_name || 'there');
  const projectLabel = escapeHtml(contract.project_type || contract.project_description || 'your project');
  const cost = formatMoney(contract.project_cost, contract.currency);
  const depositAmount = formatMoney((Number(contract.project_cost) || 0) * (Number(contract.deposit_percent) || 0) / 100, contract.currency);
  const refLine = contract.agreement_reference ? `Ref: ${escapeHtml(contract.agreement_reference)}` : '';
  const contactHref = `mailto:${COMPANY_EMAIL}?subject=${encodeURIComponent(`Question about my agreement${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`)}`;

  const subject = `Your Project Service Agreement is Ready to Sign${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Service Agreement — iCreate Solutions & Services</title>
</head>
<body style="margin:0; padding:0; background:#f0f2f5; font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.10);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg, #0B2447 0%, #002B49 100%); padding:44px 40px; text-align:center;">
              <div style="width:64px; height:64px; background:rgba(255,255,255,0.12); border-radius:50%; margin:0 auto 16px auto; display:flex; align-items:center; justify-content:center;">
                <span style="font-size:30px; line-height:1;">📝</span>
              </div>
              <p style="margin:0 0 8px 0; color:rgba(255,255,255,0.7); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:2px;">Action Required</p>
              <h1 style="margin:0; color:#ffffff; font-size:25px; font-weight:700; letter-spacing:-0.5px;">Your Service Agreement is Ready</h1>
              <p style="margin:12px 0 0 0; color:rgba(255,255,255,0.8); font-size:14px;">Please review and sign to get your project started</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:40px 44px 10px 44px;">
              <p style="margin:0 0 10px 0; font-size:17px; color:#1a1a1a; font-weight:600;">Hi ${clientName},</p>
              <p style="margin:0 0 28px 0; font-size:15px; color:#555555; line-height:1.7;">
                Thank you for choosing <strong style="color:#1a1a1a;">I Create Solutions &amp; Services</strong>. Your Project Service Agreement for <strong style="color:#1a1a1a;">${projectLabel}</strong> is ready for your electronic signature. Please review the terms and sign below to confirm your project.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb; border-radius:14px; border:1.5px solid #dde3ee; margin-bottom:30px;">
                <tr>
                  <td style="padding:22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#0B2447;">Agreement Summary</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e3e7f0; color:#6b7280; font-size:13px;">Project</td>
                        <td style="padding:8px 0; border-bottom:1px solid #e3e7f0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${projectLabel}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e3e7f0; color:#6b7280; font-size:13px;">Estimated Cost</td>
                        <td style="padding:8px 0; border-bottom:1px solid #e3e7f0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${cost}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; ${refLine ? 'border-bottom:1px solid #e3e7f0;' : ''} color:#6b7280; font-size:13px;">Deposit Required (${contract.deposit_percent}%)</td>
                        <td style="padding:8px 0; ${refLine ? 'border-bottom:1px solid #e3e7f0;' : ''} text-align:right; font-weight:700; color:#0B2447; font-size:14px;">${depositAmount}</td>
                      </tr>
                      ${refLine ? `<tr><td style="padding:8px 0; color:#6b7280; font-size:13px;">Reference</td><td style="padding:8px 0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${escapeHtml(contract.agreement_reference)}</td></tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              ${companySignatureUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;">
                <tr>
                  <td style="padding:14px 18px; background:#fafbfc; border:1px solid #edf0f5; border-radius:10px;">
                    <table cellpadding="0" cellspacing="0"><tr>
                      <td style="padding-right:14px;"><img src="${companySignatureUrl}" alt="Authorized signature" style="height:30px; width:auto; display:block;"></td>
                      <td style="border-left:1px solid #e3e7f0; padding-left:14px;">
                        <p style="margin:0; font-size:12px; color:#1a1a1a; font-weight:600;">Already countersigned by ${escapeHtml(contract.company_signer_name || 'I Create Solutions & Services')}</p>
                        <p style="margin:2px 0 0 0; font-size:11px; color:#999;">Your signature below is the final step.</p>
                      </td>
                    </tr></table>
                  </td>
                </tr>
              </table>` : ''}

              <p style="margin:0 0 12px 0; font-size:14px; font-weight:700; color:#1a1a1a; text-transform:uppercase; letter-spacing:0.5px;">What happens next:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f7fb; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#0B2447; margin-right:12px; vertical-align:middle;">1</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Open the link below and read through the agreement at your own pace</span>
                </td></tr>
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f7fb; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#0B2447; margin-right:12px; vertical-align:middle;">2</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Sign with your finger, a stylus, or your mouse — no printing or scanning</span>
                </td></tr>
                <tr><td style="padding:10px 0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f7fb; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#0B2447; margin-right:12px; vertical-align:middle;">3</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Get your own signed copy by email instantly, and we'll get to work</span>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:10px 44px 36px 44px; text-align:center;">
              <a href="${signUrl}"
                 style="display:inline-block; background:linear-gradient(135deg, #0B2447 0%, #002B49 100%); color:#ffffff; text-decoration:none; padding:16px 36px; border-radius:50px; font-weight:700; font-size:15px; letter-spacing:0.3px; box-shadow:0 8px 24px rgba(11,36,71,0.35);">
                Review &amp; Sign Agreement →
              </a>
              <p style="margin:16px 0 0 0; font-size:12px; color:#999; word-break:break-all;">Or copy this link into your browser:<br><a href="${signUrl}" style="color:#0B2447;">${signUrl}</a></p>
            </td>
          </tr>

          <!-- CONTACT STRIP -->
          <tr>
            <td style="background:#fafafa; border-top:1px solid #edf0f5; padding:18px 44px; text-align:center;">
              <p style="margin:0; font-size:13px; color:#777;">
                Questions before you sign? <a href="${contactHref}" style="color:#0B2447; font-weight:600; text-decoration:none;">Email us</a> or call/WhatsApp <a href="tel:+18765857469" style="color:#0B2447; font-weight:600; text-decoration:none;">${COMPANY_PHONE}</a>.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1a1a1a; padding:28px 44px; text-align:center;">
              <p style="margin:0 0 6px 0; color:#ffffff; font-size:14px; font-weight:600;">iCreate Solutions &amp; Services</p>
              <p style="margin:0; color:#888; font-size:12px;">© ${new Date().getFullYear()} iCreate Solutions &amp; Services. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Hi ${contract.client_name || 'there'},\n\nYour Project Service Agreement for ${contract.project_type || contract.project_description || 'your project'} is ready for your electronic signature.\n\nProject: ${contract.project_type || contract.project_description || 'N/A'}\nEstimated Cost: ${cost}\nDeposit Required (${contract.deposit_percent}%): ${depositAmount}\n${contract.agreement_reference ? `Reference: ${contract.agreement_reference}\n` : ''}\nAlready countersigned by ${contract.company_signer_name || 'I Create Solutions & Services'} — your signature is the final step.\n\nReview and sign here: ${signUrl}\n\nQuestions? Email ${COMPANY_EMAIL} or call/WhatsApp ${COMPANY_PHONE}.\n\n— iCreate Solutions & Services`;

  return { subject, html, text };
}

/**
 * Signed Confirmation — sent to the client immediately after they sign, with the PDF attached.
 * @param {Object} contract - contracts row (post-signature)
 */
function getContractSignedConfirmationTemplate(contract, companySignatureUrl = null) {
  const clientName = escapeHtml(contract.client_name || 'there');
  const projectLabel = escapeHtml(contract.project_type || contract.project_description || 'your project');
  const signedDate = formatDate(contract.signed_at);
  const refLine = contract.agreement_reference ? escapeHtml(contract.agreement_reference) : 'N/A';
  const contactHref = `mailto:${COMPANY_EMAIL}?subject=${encodeURIComponent(`Question about my agreement${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`)}`;

  const clientSignatureCell = (contract.signature_type === 'drawn' && contract.signature_data)
    ? `<img src="${contract.signature_data}" alt="Client signature" style="max-height:34px; max-width:150px; width:auto; display:block; margin:0 auto;">`
    : `<p style="margin:0; font-family:'Brush Script MT','Segoe Script',cursive; font-size:24px; color:#1a1a1a;">${escapeHtml(contract.signature_data || contract.signer_legal_name || clientName)}</p>`;

  const signatureBlock = `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px;">
                <tr>
                  <td width="50%" style="padding:18px 16px; background:#fbfbfd; border:1px solid #edf0f5; border-radius:12px 0 0 12px; text-align:center; vertical-align:bottom;">
                    ${companySignatureUrl ? `<img src="${companySignatureUrl}" alt="Company signature" style="height:34px; width:auto; display:block; margin:0 auto;">` : `<p style="margin:0; font-family:'Brush Script MT','Segoe Script',cursive; font-size:24px; color:#1a1a1a;">${escapeHtml(contract.company_signer_name || 'I Create Solutions & Services')}</p>`}
                    <p style="margin:10px 0 0 0; padding-top:10px; border-top:1px solid #e3e7f0; font-size:11px; font-weight:600; color:#1a1a1a;">${escapeHtml(contract.company_signer_name || 'I Create Solutions & Services')}</p>
                    <p style="margin:2px 0 0 0; font-size:10px; color:#999; text-transform:uppercase; letter-spacing:0.5px;">Company</p>
                  </td>
                  <td width="50%" style="padding:18px 16px; background:#fbfbfd; border:1px solid #edf0f5; border-left:none; border-radius:0 12px 12px 0; text-align:center; vertical-align:bottom;">
                    ${clientSignatureCell}
                    <p style="margin:10px 0 0 0; padding-top:10px; border-top:1px solid #e3e7f0; font-size:11px; font-weight:600; color:#1a1a1a;">${escapeHtml(contract.signer_legal_name || contract.client_name || '')}</p>
                    <p style="margin:2px 0 0 0; font-size:10px; color:#999; text-transform:uppercase; letter-spacing:0.5px;">Client</p>
                  </td>
                </tr>
              </table>`;

  const subject = `✅ Signed: Your Project Service Agreement${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Agreement Signed — iCreate Solutions & Services</title>
</head>
<body style="margin:0; padding:0; background:#f0fdf4; font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.10);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg, #059669 0%, #047857 100%); padding:48px 40px; text-align:center;">
              <div style="width:70px; height:70px; background:rgba(255,255,255,0.15); border-radius:50%; margin:0 auto 18px auto; display:flex; align-items:center; justify-content:center;">
                <span style="font-size:36px; line-height:1;">🎉</span>
              </div>
              <p style="margin:0 0 6px 0; color:rgba(255,255,255,0.8); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:2px;">Agreement Confirmed</p>
              <h1 style="margin:0 0 10px 0; color:#ffffff; font-size:26px; font-weight:700; letter-spacing:-0.5px;">You're All Signed!</h1>
              <p style="margin:0; color:rgba(255,255,255,0.85); font-size:14px;">Your project is officially underway.</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:40px 44px 10px 44px;">
              <p style="margin:0 0 10px 0; font-size:17px; color:#1a1a1a; font-weight:600;">Hi ${clientName},</p>
              <p style="margin:0 0 28px 0; font-size:15px; color:#555555; line-height:1.7;">
                Thank you for signing your Project Service Agreement with <strong style="color:#1a1a1a;">I Create Solutions &amp; Services</strong> for <strong style="color:#059669;">${projectLabel}</strong>. A fully signed copy is attached to this email (PDF) for your records.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; border-radius:14px; border:1.5px solid #a7f3d0; margin-bottom:30px;">
                <tr>
                  <td style="padding:22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#059669;">Signature Confirmation</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; color:#6b7280; font-size:13px;">Reference</td>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${refLine}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; color:#6b7280; font-size:13px;">Signed By</td>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${escapeHtml(contract.signer_legal_name || contract.client_name || '')}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:13px;">Date Signed</td>
                        <td style="padding:8px 0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${signedDate}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 12px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#059669; text-align:center;">Signed By Both Parties</p>
              ${signatureBlock}

              <p style="margin:0 0 12px 0; font-size:14px; font-weight:700; color:#1a1a1a; text-transform:uppercase; letter-spacing:0.5px;">What happens next:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px;">
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f0fdf4; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#059669; margin-right:12px; vertical-align:middle;">1</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Your deposit invoice will follow separately by email</span>
                </td></tr>
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f0fdf4; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#059669; margin-right:12px; vertical-align:middle;">2</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">We begin work once your deposit is received</span>
                </td></tr>
                <tr><td style="padding:10px 0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f0fdf4; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#059669; margin-right:12px; vertical-align:middle;">3</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Keep this email and the attached PDF — it's your official copy</span>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- CONTACT STRIP -->
          <tr>
            <td style="background:#fafafa; border-top:1px solid #edf0f5; padding:18px 44px; text-align:center;">
              <p style="margin:0; font-size:13px; color:#777;">
                Questions about your agreement or next steps? <a href="${contactHref}" style="color:#059669; font-weight:600; text-decoration:none;">Email us</a> or call/WhatsApp <a href="tel:+18765857469" style="color:#059669; font-weight:600; text-decoration:none;">${COMPANY_PHONE}</a>.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1a1a1a; padding:28px 44px; text-align:center;">
              <p style="margin:0 0 6px 0; color:#ffffff; font-size:14px; font-weight:600;">iCreate Solutions &amp; Services</p>
              <p style="margin:0; color:#888; font-size:12px;">© ${new Date().getFullYear()} iCreate Solutions &amp; Services. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Hi ${contract.client_name || 'there'},\n\nThank you for signing your Project Service Agreement with I Create Solutions & Services for ${contract.project_type || contract.project_description || 'your project'}.\n\nReference: ${refLine}\nSigned By: ${contract.signer_legal_name || contract.client_name || ''}\nDate Signed: ${signedDate}\n\nA signed copy (PDF) is attached to this email for your records.\n\nWhat happens next:\n1. Your deposit invoice will follow separately by email\n2. We begin work once your deposit is received\n3. Keep this email and the attached PDF — it's your official copy\n\nQuestions? Email ${COMPANY_EMAIL} or call/WhatsApp ${COMPANY_PHONE}.\n\n— iCreate Solutions & Services`;

  return { subject, html, text };
}

/**
 * Partner Contract Signing Request — sent when the admin clicks "Send" on a partner contract.
 * @param {Object} contract - partner_contracts row
 * @param {string} signUrl - full public link to the partner sign page
 */
function getPartnerContractSigningRequestTemplate(contract, signUrl, companySignatureUrl = null) {
  const partnerName = escapeHtml(contract.partner_name || 'there');
  const productName = escapeHtml(contract.product_name || 'HaloManage');
  const template = findPartnerTemplate(contract.template_id);
  const roleLabel = escapeHtml(template.shortTitle || template.title);
  const isReferral = template.kind === 'referral';
  const agreementNoun = isReferral ? 'referral agreement' : 'partner agreement';
  const contactHref = `mailto:${COMPANY_EMAIL}?subject=${encodeURIComponent(`Question about my ${agreementNoun}${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`)}`;

  // The "Agreement Summary" box: HaloManage role agreements show role / revenue share / payment
  // frequency; the referral agreement shows its two-tier commission and payment timing.
  const summaryData = isReferral ? buildPartnerContractData(contract.terms_snapshot_json || contract) : null;
  const summaryRows = isReferral
    ? referralSummaryRows(summaryData).map(([label, value]) => ({ label, value }))
    : [
      { label: 'Role', value: template.shortTitle || template.title },
      { label: 'Revenue Share', value: `${Number(contract.revenue_share_percent ?? 0)}%`, accent: true },
      { label: 'Payment Frequency', value: contract.payment_frequency || 'Monthly' }
    ];
  if (contract.agreement_reference) summaryRows.push({ label: 'Reference', value: contract.agreement_reference });
  const summaryRowsHtml = summaryRows.map((row, index) => {
    const border = index < summaryRows.length - 1 ? 'border-bottom:1px solid #e3e7f0;' : '';
    return `<tr>
                        <td style="padding:8px 0; ${border} color:#6b7280; font-size:13px;">${escapeHtml(row.label)}</td>
                        <td style="padding:8px 0; ${border} text-align:right; font-weight:${row.accent ? 700 : 600}; color:${row.accent ? '#129c86' : '#1a1a1a'}; font-size:14px;">${escapeHtml(row.value)}</td>
                      </tr>`;
  }).join('');
  const summaryText = summaryRows.map((row) => `${row.label}: ${row.value}`).join('\n');

  const subject = isReferral
    ? `Your Referral Partner Commission Agreement is Ready to Sign${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`
    : `Your ${contract.product_name || 'HaloManage'} Partner Agreement is Ready to Sign${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`;
  const headline = isReferral ? 'Your Referral Agreement is Ready' : 'Your Partner Agreement is Ready';
  const subHeadline = isReferral ? 'Please review and sign to confirm your referral partnership' : `Please review and sign to confirm your ${productName} partnership`;
  const introHtml = isReferral
    ? `Thank you for helping introduce clients to <strong style="color:#1a1a1a;">${escapeHtml(contract.company_name || 'iCreate Solutions & Services')}</strong>. Your ${roleLabel} commission agreement is ready for your electronic signature. Please review the terms and sign below to confirm.`
    : `Thank you for partnering with us on <strong style="color:#1a1a1a;">${productName}</strong>. Your ${roleLabel} agreement is ready for your electronic signature. Please review the terms and sign below to confirm.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Partner Agreement — ${escapeHtml(contract.company_name || 'iCreate Solutions & Services')}</title>
</head>
<body style="margin:0; padding:0; background:#f0f2f5; font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.10);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg, #101b3d 0%, #129c86 100%); padding:44px 40px; text-align:center;">
              <div style="width:64px; height:64px; background:rgba(255,255,255,0.12); border-radius:50%; margin:0 auto 16px auto; display:flex; align-items:center; justify-content:center;">
                <span style="font-size:30px; line-height:1;">🤝</span>
              </div>
              <p style="margin:0 0 8px 0; color:rgba(255,255,255,0.7); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:2px;">Action Required</p>
              <h1 style="margin:0; color:#ffffff; font-size:25px; font-weight:700; letter-spacing:-0.5px;">${headline}</h1>
              <p style="margin:12px 0 0 0; color:rgba(255,255,255,0.8); font-size:14px;">${subHeadline}</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:40px 44px 10px 44px;">
              <p style="margin:0 0 10px 0; font-size:17px; color:#1a1a1a; font-weight:600;">Hi ${partnerName},</p>
              <p style="margin:0 0 28px 0; font-size:15px; color:#555555; line-height:1.7;">
                ${introHtml}
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb; border-radius:14px; border:1.5px solid #dde3ee; margin-bottom:30px;">
                <tr>
                  <td style="padding:22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#101b3d;">Agreement Summary</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${summaryRowsHtml}
                    </table>
                  </td>
                </tr>
              </table>

              ${companySignatureUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;">
                <tr>
                  <td style="padding:14px 18px; background:#fafbfc; border:1px solid #edf0f5; border-radius:10px;">
                    <table cellpadding="0" cellspacing="0"><tr>
                      <td style="padding-right:14px;"><img src="${companySignatureUrl}" alt="Authorized signature" style="height:30px; width:auto; display:block;"></td>
                      <td style="border-left:1px solid #e3e7f0; padding-left:14px;">
                        <p style="margin:0; font-size:12px; color:#1a1a1a; font-weight:600;">Already countersigned by ${escapeHtml(contract.company_signer_name || 'iCreate Solutions & Services')}</p>
                        <p style="margin:2px 0 0 0; font-size:11px; color:#999;">Your signature below is the final step.</p>
                      </td>
                    </tr></table>
                  </td>
                </tr>
              </table>` : ''}

              <p style="margin:0 0 12px 0; font-size:14px; font-weight:700; color:#1a1a1a; text-transform:uppercase; letter-spacing:0.5px;">What happens next:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f7fb; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#101b3d; margin-right:12px; vertical-align:middle;">1</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Open the link below and read through the agreement at your own pace</span>
                </td></tr>
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f7fb; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#101b3d; margin-right:12px; vertical-align:middle;">2</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Sign with your finger, a stylus, or your mouse — no printing or scanning</span>
                </td></tr>
                <tr><td style="padding:10px 0;">
                  <span style="display:inline-block; width:28px; height:28px; background:#f5f7fb; border-radius:50%; text-align:center; line-height:28px; font-size:13px; font-weight:700; color:#101b3d; margin-right:12px; vertical-align:middle;">3</span>
                  <span style="font-size:14px; color:#444; vertical-align:middle;">Get your own signed copy by email instantly</span>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:10px 44px 36px 44px; text-align:center;">
              <a href="${signUrl}"
                 style="display:inline-block; background:linear-gradient(135deg, #101b3d 0%, #129c86 100%); color:#ffffff; text-decoration:none; padding:16px 36px; border-radius:50px; font-weight:700; font-size:15px; letter-spacing:0.3px; box-shadow:0 8px 24px rgba(16,27,61,0.35);">
                Review &amp; Sign Agreement →
              </a>
              <p style="margin:16px 0 0 0; font-size:12px; color:#999; word-break:break-all;">Or copy this link into your browser:<br><a href="${signUrl}" style="color:#101b3d;">${signUrl}</a></p>
            </td>
          </tr>

          <!-- CONTACT STRIP -->
          <tr>
            <td style="background:#fafafa; border-top:1px solid #edf0f5; padding:18px 44px; text-align:center;">
              <p style="margin:0; font-size:13px; color:#777;">
                Questions before you sign? <a href="${contactHref}" style="color:#101b3d; font-weight:600; text-decoration:none;">Email us</a> or call/WhatsApp <a href="tel:+18765857469" style="color:#101b3d; font-weight:600; text-decoration:none;">${COMPANY_PHONE}</a>.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1a1a1a; padding:28px 44px; text-align:center;">
              <p style="margin:0 0 6px 0; color:#ffffff; font-size:14px; font-weight:600;">${escapeHtml(contract.company_name || 'iCreate Solutions & Services')}</p>
              <p style="margin:0; color:#888; font-size:12px;">© ${new Date().getFullYear()} ${escapeHtml(contract.company_name || 'iCreate Solutions & Services')}. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const lead = isReferral
    ? `Your ${template.title} is ready for your electronic signature.`
    : `Your ${template.shortTitle || template.title} agreement for ${contract.product_name || 'HaloManage'} is ready for your electronic signature.`;
  const text = `Hi ${contract.partner_name || 'there'},\n\n${lead}\n\n${summaryText}\n\nAlready countersigned by ${contract.company_signer_name || 'iCreate Solutions & Services'} — your signature is the final step.\n\nReview and sign here: ${signUrl}\n\nQuestions? Email ${COMPANY_EMAIL} or call/WhatsApp ${COMPANY_PHONE}.\n\n— ${contract.company_name || 'iCreate Solutions & Services'}`;

  return { subject, html, text };
}

/**
 * Partner Contract Signed Confirmation — sent to the partner immediately after they sign,
 * with the PDF attached.
 * @param {Object} contract - partner_contracts row (post-signature)
 */
function getPartnerContractSignedConfirmationTemplate(contract, companySignatureUrl = null) {
  const partnerName = escapeHtml(contract.partner_name || 'there');
  const productName = escapeHtml(contract.product_name || 'HaloManage');
  const template = findPartnerTemplate(contract.template_id);
  const roleLabel = escapeHtml(template.shortTitle || template.title);
  const signedDate = formatDate(contract.signed_at);
  const refLine = contract.agreement_reference ? escapeHtml(contract.agreement_reference) : 'N/A';
  const isReferral = template.kind === 'referral';
  const contactHref = `mailto:${COMPANY_EMAIL}?subject=${encodeURIComponent(`Question about my ${isReferral ? 'referral' : 'partner'} agreement${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`)}`;
  const agreementLabel = isReferral ? template.title : `${template.shortTitle || template.title} agreement`;

  // Referral partners get their commission terms restated in the confirmation, for their records.
  const commissionData = isReferral ? buildPartnerContractData(contract.terms_snapshot_json || contract) : null;
  const commissionBlock = isReferral ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb; border-radius:14px; border:1.5px solid #dde3ee; margin-bottom:30px;">
                <tr>
                  <td style="padding:22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#101b3d;">Your Commission</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e3e7f0; color:#6b7280; font-size:13px;">Projects under ${escapeHtml(formatJmd(commissionData.commissionThresholdAmount))}</td>
                        <td style="padding:8px 0; border-bottom:1px solid #e3e7f0; text-align:right; font-weight:700; color:#129c86; font-size:14px;">${escapeHtml(formatJmd(commissionData.flatCommissionAmount))} per referral</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e3e7f0; color:#6b7280; font-size:13px;">Projects of ${escapeHtml(formatJmd(commissionData.commissionThresholdAmount))} or more</td>
                        <td style="padding:8px 0; border-bottom:1px solid #e3e7f0; text-align:right; font-weight:700; color:#129c86; font-size:14px;">${escapeHtml(percentText(commissionData.commissionPercent))}% of amount received</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:13px;">Paid</td>
                        <td style="padding:8px 0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">within ${Number(commissionData.paymentDueDays)} business days of the client's payment clearing</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>` : '';
  const commissionText = isReferral
    ? `\nYour commission:\n- Projects under ${formatJmd(commissionData.commissionThresholdAmount)}: ${formatJmd(commissionData.flatCommissionAmount)} per referral\n- Projects of ${formatJmd(commissionData.commissionThresholdAmount)} or more: ${percentText(commissionData.commissionPercent)}% of the amount received\n- Paid within ${Number(commissionData.paymentDueDays)} business days of the client's payment clearing\n`
    : '';

  const partnerSignatureCell = (contract.signature_type === 'drawn' && contract.signature_data)
    ? `<img src="${contract.signature_data}" alt="Partner signature" style="max-height:34px; max-width:150px; width:auto; display:block; margin:0 auto;">`
    : `<p style="margin:0; font-family:'Brush Script MT','Segoe Script',cursive; font-size:24px; color:#1a1a1a;">${escapeHtml(contract.signature_data || contract.signer_legal_name || partnerName)}</p>`;

  const signatureBlock = `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px;">
                <tr>
                  <td width="50%" style="padding:18px 16px; background:#fbfbfd; border:1px solid #edf0f5; border-radius:12px 0 0 12px; text-align:center; vertical-align:bottom;">
                    ${companySignatureUrl ? `<img src="${companySignatureUrl}" alt="Company signature" style="height:34px; width:auto; display:block; margin:0 auto;">` : `<p style="margin:0; font-family:'Brush Script MT','Segoe Script',cursive; font-size:24px; color:#1a1a1a;">${escapeHtml(contract.company_signer_name || 'iCreate Solutions & Services')}</p>`}
                    <p style="margin:10px 0 0 0; padding-top:10px; border-top:1px solid #e3e7f0; font-size:11px; font-weight:600; color:#1a1a1a;">${escapeHtml(contract.company_signer_name || 'iCreate Solutions & Services')}</p>
                    <p style="margin:2px 0 0 0; font-size:10px; color:#999; text-transform:uppercase; letter-spacing:0.5px;">Company</p>
                  </td>
                  <td width="50%" style="padding:18px 16px; background:#fbfbfd; border:1px solid #edf0f5; border-left:none; border-radius:0 12px 12px 0; text-align:center; vertical-align:bottom;">
                    ${partnerSignatureCell}
                    <p style="margin:10px 0 0 0; padding-top:10px; border-top:1px solid #e3e7f0; font-size:11px; font-weight:600; color:#1a1a1a;">${escapeHtml(contract.signer_legal_name || contract.partner_name || '')}</p>
                    <p style="margin:2px 0 0 0; font-size:10px; color:#999; text-transform:uppercase; letter-spacing:0.5px;">${isReferral ? 'Referral Partner' : 'Partner'}</p>
                  </td>
                </tr>
              </table>`;

  const subject = isReferral
    ? `✅ Signed: Your Referral Partner Commission Agreement${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`
    : `✅ Signed: Your ${contract.product_name || 'HaloManage'} Partner Agreement${contract.agreement_reference ? ` (${contract.agreement_reference})` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Agreement Signed — ${escapeHtml(contract.company_name || 'iCreate Solutions & Services')}</title>
</head>
<body style="margin:0; padding:0; background:#f0fdf4; font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.10);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg, #059669 0%, #129c86 100%); padding:48px 40px; text-align:center;">
              <div style="width:70px; height:70px; background:rgba(255,255,255,0.15); border-radius:50%; margin:0 auto 18px auto; display:flex; align-items:center; justify-content:center;">
                <span style="font-size:36px; line-height:1;">🎉</span>
              </div>
              <p style="margin:0 0 6px 0; color:rgba(255,255,255,0.8); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:2px;">Agreement Confirmed</p>
              <h1 style="margin:0 0 10px 0; color:#ffffff; font-size:26px; font-weight:700; letter-spacing:-0.5px;">You're All Signed!</h1>
              <p style="margin:0; color:rgba(255,255,255,0.85); font-size:14px;">${isReferral ? 'Your referral partnership is officially underway.' : `Your ${productName} partnership is officially underway.`}</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:40px 44px 10px 44px;">
              <p style="margin:0 0 10px 0; font-size:17px; color:#1a1a1a; font-weight:600;">Hi ${partnerName},</p>
              <p style="margin:0 0 28px 0; font-size:15px; color:#555555; line-height:1.7;">
                Thank you for signing your ${escapeHtml(agreementLabel)} with <strong style="color:#1a1a1a;">${escapeHtml(contract.company_name || 'iCreate Solutions & Services')}</strong>. A fully signed copy is attached to this email (PDF) for your records.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; border-radius:14px; border:1.5px solid #a7f3d0; margin-bottom:30px;">
                <tr>
                  <td style="padding:22px 26px;">
                    <p style="margin:0 0 14px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#059669;">Signature Confirmation</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; color:#6b7280; font-size:13px;">Reference</td>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${refLine}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; color:#6b7280; font-size:13px;">Signed By</td>
                        <td style="padding:8px 0; border-bottom:1px solid #d1fae5; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${escapeHtml(contract.signer_legal_name || contract.partner_name || '')}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0; color:#6b7280; font-size:13px;">Date Signed</td>
                        <td style="padding:8px 0; text-align:right; font-weight:600; color:#1a1a1a; font-size:14px;">${signedDate}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${commissionBlock}
              <p style="margin:0 0 12px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#059669; text-align:center;">Signed By Both Parties</p>
              ${signatureBlock}
            </td>
          </tr>

          <!-- CONTACT STRIP -->
          <tr>
            <td style="background:#fafafa; border-top:1px solid #edf0f5; padding:18px 44px; text-align:center;">
              <p style="margin:0; font-size:13px; color:#777;">
                Questions about your agreement? <a href="${contactHref}" style="color:#059669; font-weight:600; text-decoration:none;">Email us</a> or call/WhatsApp <a href="tel:+18765857469" style="color:#059669; font-weight:600; text-decoration:none;">${COMPANY_PHONE}</a>.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1a1a1a; padding:28px 44px; text-align:center;">
              <p style="margin:0 0 6px 0; color:#ffffff; font-size:14px; font-weight:600;">${escapeHtml(contract.company_name || 'iCreate Solutions & Services')}</p>
              <p style="margin:0; color:#888; font-size:12px;">© ${new Date().getFullYear()} ${escapeHtml(contract.company_name || 'iCreate Solutions & Services')}. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const forLine = isReferral ? '' : ` for ${contract.product_name || 'HaloManage'}`;
  const text = `Hi ${contract.partner_name || 'there'},\n\nThank you for signing your ${agreementLabel} with ${contract.company_name || 'iCreate Solutions & Services'}${forLine}.\n\nReference: ${refLine}\nSigned By: ${contract.signer_legal_name || contract.partner_name || ''}\nDate Signed: ${signedDate}\n${commissionText}\nA signed copy (PDF) is attached to this email for your records.\n\nQuestions? Email ${COMPANY_EMAIL} or call/WhatsApp ${COMPANY_PHONE}.\n\n— ${contract.company_name || 'iCreate Solutions & Services'}`;

  return { subject, html, text };
}

/**
 * Generates the "Request Missing Info" email — asks a client to fill in
 * whatever Client Care details are still blank, explaining why each one is
 * needed, with a link to the public self-service update page.
 * @param {Object} client - { name, email }
 * @param {Array} missingFields - [{ label, why }] from clientInfoRequestService
 * @param {string} updateUrl - the client's unique update-info link
 * @param {number} expiryDays - how many days the link stays valid
 */
function getInfoRequestTemplate(client, missingFields, updateUrl, expiryDays) {
  const clientName = escapeHtml(client?.name || 'there');

  const itemsHtml = missingFields.map(field => `
        <li style="margin-bottom: 16px;">
            <strong style="color:#0056b3;">${escapeHtml(field.label)}</strong><br>
            <span style="color:#666; font-size: 0.9em;">${escapeHtml(field.why)}</span>
        </li>`).join('');

  const itemsText = missingFields.map(field => `- ${field.label}\n  ${field.why}`).join('\n');

  const subject = 'A few quick details for your Client Care setup';

  const htmlBody = `
        <p>Hi <strong>${clientName}</strong>,</p>
        <p>To keep your Client Care reporting running smoothly (and so we don't miss a couple of nice extras), we're missing a few details on file for you:</p>
        <ul style="padding-left: 20px; margin: 20px 0; list-style: none;">${itemsHtml}</ul>
        <div style="text-align:center; margin: 28px 0;">
            <a href="${updateUrl}" style="display:inline-block; background:#0056b3; color:white; text-decoration:none; padding:12px 28px; border-radius:6px; font-weight:600;">Update My Details</a>
        </div>
        <p style="font-size:0.85em; color:#888;">This link is unique to you and doesn't require a password. It stays active for ${expiryDays} days.</p>
        <p style="font-size:0.85em; color:#888;">If the button above doesn't work, copy and paste this link into your browser:<br><span style="word-break:break-all; color:#0056b3;">${updateUrl}</span></p>
        <p>Thanks for being a client — reply to this email any time if you have questions.</p>
    `;

  const text = `Hi ${client?.name || 'there'},

To keep your Client Care reporting running smoothly, we're missing a few details on file for you:

${itemsText}

Update your details here: ${updateUrl}
(This link is unique to you, no password needed, and stays active for ${expiryDays} days.)

Thanks for being a client — reply to this email any time if you have questions.
— iCreate Solutions & Services`;

  return { subject, text, html: getBaseHtml(htmlBody) };
}

module.exports = { getInvoiceEmailContent, getClientCarePulseEmailContent, getMonthlySummaryEmailContent, getPaymentDeclinedTemplate, getInvoiceDelinquencyTemplate, getInvoiceOutstandingBalance, getPaymentNudgeTemplate, getSubscriptionRenewalTemplate, getWelcomeSubscriptionTemplate, getSubscriptionBillingCycle, getContractSigningRequestTemplate, getContractSignedConfirmationTemplate, getPartnerContractSigningRequestTemplate, getPartnerContractSignedConfirmationTemplate, getInfoRequestTemplate };
