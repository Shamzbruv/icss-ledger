/**
 * iCreate Solutions & Services - Smart Email Template System
 */

const SERVICE_NAMES = {
    'WEB': 'Website Development',
    'APP': 'App Development',
    'GD': 'Graphic Designs',
    'HOST_PRO': 'Professional Hosting',
    'HOST_DOM': 'Hosting + Domain',
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

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
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
        return getSubscriptionTemplate(state, client);
    }

    return getUnifiedStatusTemplate(state, client);
}

function getUnifiedStatusTemplate(state, client) {
    const detailsHtml = state.emailSummaryRows.map(row =>
        `<p><strong>${row.label}:</strong> ${row.value}</p>`
    ).join('');

    const htmlBody = `
        <p>Hello <strong>${client.name}</strong>,</p>
        <p>Your invoice for <strong>${state.serviceType}</strong> is attached. Status: <strong>${state.paymentStatus}</strong>.</p>
        
        <div class="details">
            <h3>Invoice Summary</h3>
            ${detailsHtml}
        </div>

        <p>Thank you for your business. Please reach out if you have any questions.</p>
    `;

    return {
        subject: state.emailSubjectText,
        text: `Hello ${client.name}, ${state.emailSubjectText}. Details: ${state.emailSummaryRows.map(r => `${r.label}: ${r.value}`).join(', ')}`,
        html: getBaseHtml(htmlBody)
    };
}

function getSubscriptionTemplate(state, client) {
    const detailsHtml = state.emailSummaryRows.map(row =>
        `<p><strong>${row.label}:</strong> ${row.value}</p>`
    ).join('');

    const htmlBody = `
        <p>Hello <strong>${client.name}</strong>,</p>
        <p>Your subscription for <strong>${state.serviceType}</strong> is active.</p>
        
        <div class="details">
            <h3>Subscription Details</h3>
            ${detailsHtml}
        </div>

        <p>This subscription will automatically renew unless canceled prior to the renewal date.</p>
    `;

    return {
        subject: state.emailSubjectText,
        text: `Hello ${client.name}, ${state.emailSubjectText}.`,
        html: getBaseHtml(htmlBody)
    };
}


// ... (existing code)

/**
 * Generates the Client Care Pulse Report Email
 * @param {Object} runData - The checklist run data
 * @param {Object} client - Client details
 * @param {Object} plan - Service Plan details
 * @param {Array} items - The run items
 */
function getClientCarePulseEmailContent(runData, client, plan, items) {
    const periodStart = formatDate(runData.period_start);
    const periodEnd = formatDate(runData.period_end);
    const score = runData.score;

    // Status Logic
    let statusColor = '#28a745'; // Green
    let statusText = 'Excellent';
    if (score < 50) { statusColor = '#dc3545'; statusText = 'Critical'; }
    else if (score < 80) { statusColor = '#ffc107'; statusText = 'Needs Attention'; }

    // Group Items
    const failedItems = items.filter(i => i.status === 'fail');
    const warnItems = items.filter(i => i.status === 'warn');
    const passItems = items.filter(i => i.status === 'pass');

    const subject = `Client Care Report: ${statusText} - ${plan.name} (${periodStart} - ${periodEnd})`;

    const textBody = `Hello ${client.name},

Here is your ${plan.name} Report for the period ${periodStart} to ${periodEnd}.

Overall Status: ${statusText} (${score}/100)

--- ISSUES DETECTED ---
${failedItems.map(i => `[FAIL] ${i.label || i.item_code}: ${i.details}`).join('\n') || 'None'}

--- WARNINGS ---
${warnItems.map(i => `[WARN] ${i.label || i.item_code}: ${i.details}`).join('\n') || 'None'}

--- PASSED CHECKS ---
${passItems.map(i => `[PASS] ${i.label || i.item_code}: ${i.details}`).join('\n')}

We are proactively monitoring your systems. If critical issues were found, our team has been notified.
Reply to this email if you have questions.

— iCreate Solutions & Services`;

    const htmlBody = `
        <p>Hello <strong>${client.name}</strong>,</p>
        <p>Here is your <strong>${plan.name}</strong> Health Report.</p>
        <p class="period" style="color: #666; font-size: 0.9em;">Period: ${periodStart} - ${periodEnd}</p>

        <div style="background-color: ${statusColor}; color: white; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <h2 style="margin:0;">${statusText}</h2>
            <p style="margin:0;">System Health Score: ${score}/100</p>
        </div>

        ${failedItems.length > 0 ? `
        <div class="section" style="margin-bottom: 20px;">
            <h3 style="color: #dc3545; border-bottom: 2px solid #dc3545; padding-bottom: 5px;">⚠️ Critical Issues</h3>
            <ul style="list-style: none; padding: 0;">
                ${failedItems.map(i => `
                    <li style="background: #fff5f5; border-left: 4px solid #dc3545; padding: 10px; margin-bottom: 10px;">
                        <strong>${i.label || i.item_code}</strong><br>
                        ${i.details}
                    </li>
                `).join('')}
            </ul>
        </div>` : ''}

        ${warnItems.length > 0 ? `
        <div class="section" style="margin-bottom: 20px;">
            <h3 style="color: #ffc107; border-bottom: 2px solid #ffc107; padding-bottom: 5px;">⚠️ Needs Attention</h3>
            <ul style="list-style: none; padding: 0;">
                ${warnItems.map(i => `
                    <li style="background: #fffbf0; border-left: 4px solid #ffc107; padding: 10px; margin-bottom: 10px;">
                        <strong>${i.label || i.item_code}</strong><br>
                        ${i.details}
                    </li>
                `).join('')}
            </ul>
        </div>` : ''}

        <div class="section">
            <h3 style="color: #28a745; border-bottom: 2px solid #28a745; padding-bottom: 5px;">✅ Passed Checks</h3>
            <ul style="list-style: none; padding: 0;">
                ${passItems.map(i => `
                    <li style="padding: 5px 0; border-bottom: 1px solid #eee;">
                        <span style="color: #28a745;">✔</span> <strong>${i.label || i.item_code}</strong>: ${i.details}
                    </li>
                `).join('')}
            </ul>
        </div>

        ${(plan.name === 'Hosting + Domain' || plan.name === 'Content Refresh' || plan.name === 'Basic Hosting') ? `
        <div class="section" style="margin-top: 30px; position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #e5e5e7;">
            <div style="background: linear-gradient(135deg, #0056b3 0%, #003d82 100%); padding: 15px 20px;">
                <h3 style="color: white; margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center;">🔒 Pro Maintenance Insights</h3>
            </div>
            
            <div style="padding: 20px; position: relative;">
                <!-- Simulated blurred content -->
                <div style="filter: blur(5px); opacity: 0.6; user-select: none;">
                    <p style="margin-top: 0; font-family: monospace; font-size: 13px;">Analyzing plugin vulnerabilities... [3] Outdated detected.</p>
                    <p style="font-family: monospace; font-size: 13px;">Database optimization scan... 450MB overhead cleared.</p>
                    <p style="font-family: monospace; font-size: 13px; margin-bottom: 0;">Running security perimeter check... Firewall rules updated.</p>
                </div>
                
                <!-- Overlay CTA -->
                <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(255,255,255,0.85); text-align: center; padding: 20px;">
                    <span style="font-size: 24px; margin-bottom: 10px;">🛡️</span>
                    <h4 style="margin: 0 0 8px 0; color: #1d1d1f; font-size: 16px;">Elevate Your Digital Security</h4>
                    <p style="margin: 0 0 15px 0; color: #424245; font-size: 13px; max-width: 80%;">Unlock comprehensive security scans, database optimization, and proactive plugin management.</p>
                    <a href="mailto:support@icreatesolutionsandservices.com?subject=Upgrade%20to%20Maintenance%20Plan" style="display: inline-block; background: #0056b3; color: white; text-decoration: none; padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 600;">Upgrade to Maintenance Plan</a>
                </div>
            </div>
        </div>
        ` : ''}

        <div style="margin-top: 30px; background: #f8f9fa; padding: 15px; border-radius: 5px;">
            <p style="margin:0;"><strong>Need help?</strong> Reply to this email to schedule a support session.</p>
        </div>
    `;

    return { subject, text: textBody, html: getBaseHtml(htmlBody) };
}

/**
 * Generates the Monthly Pulse Summary Email
 * @param {Object} summary - The summary object from DB
 * @param {Object} client - Client details
 */
function getMonthlySummaryEmailContent(summary, client) {
    const month = summary.month; // YYYY-MM
    const [yyyy, mm] = month.split('-');
    const dateObj = new Date(yyyy, mm - 1);
    const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

    const scoreColor = summary.overall_status === 'Mostly Healthy' ? '#28a745' :
        summary.overall_status === 'Needs Attention' ? '#ffc107' : '#dc3545';

    const subject = `Monthly Pulse Summary: ${monthName} - ${summary.overall_status}`;

    // Top Issues Format
    let issuesHtml = '';
    if (summary.top_issues_json && summary.top_issues_json.length > 0) {
        issuesHtml = `
        <div class="section" style="margin-bottom: 30px;">
            <h3 style="color: #1d1d1f; font-size: 18px; font-weight: 600; border-bottom: 1px solid #e5e5e7; padding-bottom: 10px; margin-bottom: 15px;">Key Insights & Recurring Issues</h3>
            <div style="background: #ffffff; border-radius: 12px; border: 1px solid #e5e5e7; overflow: hidden;">
                ${summary.top_issues_json.map((i, index) => `
                    <div style="padding: 15px; display: flex; align-items: center; border-bottom: ${index === summary.top_issues_json.length - 1 ? 'none' : '1px solid #f5f5f7'};">
                        <div style="width: 32px; height: 32px; background: #f5f5f7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 15px; color: #86868b; font-weight: 600; font-size: 14px;">
                            ${index + 1}
                        </div>
                        <div style="flex: 1;">
                            <div style="color: #1d1d1f; font-weight: 500;">${i.issue}</div>
                            <div style="color: #86868b; font-size: 12px;">Detected ${i.count} times this month</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    } else {
        issuesHtml = `
        <div style="background: #f5f5f7; padding: 20px; border-radius: 12px; text-align: center; color: #86868b; margin-bottom: 30px;">
            No recurring issues detected this month. Your systems are running exceptionally smooth.
        </div>`;
    }

    const textBody = `Hello ${client.name},

Here is your Client Care Pulse Summary for ${monthName}.

Overall Status: ${summary.overall_status}
Total Reports Sent: ${summary.total_reports_sent}
Breakdown: ${summary.pass_count} Passed, ${summary.warn_count} Warning, ${summary.fail_count} Failed

--- TOP ISSUES ---
${summary.top_issues_json && summary.top_issues_json.length > 0
            ? summary.top_issues_json.map(i => `- ${i.issue}: ${i.count} times`).join('\n')
            : 'None'}

Recommendations:
${summary.recommendations_text || 'None'}

— iCreate Solutions & Services`;

    const htmlBody = `
        <div style="text-align: center; margin-bottom: 30px;">
            <span style="font-size: 12px; font-weight: 600; color: #86868b; text-transform: uppercase; letter-spacing: 0.1em;">Monthly Performance Review</span>
            <h1 style="color: #1d1d1f; font-size: 28px; font-weight: 700; margin: 10px 0 5px 0;">${monthName} Summary</h1>
            <p style="color: #86868b; margin: 0;">Prepared for ${client.name}</p>
        </div>

        <div style="background-color: ${scoreColor}; color: white; padding: 30px; border-radius: 16px; text-align: center; margin: 20px 0 30px 0; box-shadow: 0 10px 20px rgba(0,0,0,0.05);">
            <div style="font-size: 14px; font-weight: 500; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px;">Overall Health Status</div>
            <h2 style="margin:0; font-size: 32px; font-weight: 700; letter-spacing: -0.02em;">${summary.overall_status}</h2>
            <div style="margin: 10px auto 0 auto; width: 40px; height: 3px; background: rgba(255,255,255,0.3); border-radius: 2px;"></div>
            <p style="margin: 10px 0 0 0; font-size: 13px; font-weight: 500; opacity: 0.8;">Analyzed across ${summary.total_reports_sent} pulse reports</p>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 30px;">
            <div style="flex: 1; padding: 15px; background: #ffffff; border: 1px solid #e5e5e7; border-radius: 12px; text-align: center;">
                <div style="color: #28a745; font-size: 24px; font-weight: 700; line-height: 1;">${summary.pass_count}</div>
                <div style="color: #86868b; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-top: 5px;">Passed</div>
            </div>
            <div style="flex: 1; padding: 15px; background: #ffffff; border: 1px solid #e5e5e7; border-radius: 12px; text-align: center;">
                <div style="color: #ffc107; font-size: 24px; font-weight: 700; line-height: 1;">${summary.warn_count}</div>
                <div style="color: #86868b; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-top: 5px;">Warnings</div>
            </div>
            <div style="flex: 1; padding: 15px; background: #ffffff; border: 1px solid #e5e5e7; border-radius: 12px; text-align: center;">
                <div style="color: #dc3545; font-size: 24px; font-weight: 700; line-height: 1;">${summary.fail_count}</div>
                <div style="color: #86868b; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-top: 5px;">Failed</div>
            </div>
        </div>

        ${issuesHtml}

        <div class="section" style="background: #f5f5f7; padding: 25px; border-radius: 16px; border: 1px solid #e5e5e7;">
            <h3 style="color: #1d1d1f; font-size: 18px; font-weight: 600; margin-top: 0; margin-bottom: 12px;">Next Steps & Recommendations</h3>
            <p style="color: #424245; font-size: 15px; margin-bottom: 0; line-height: 1.6;">${summary.recommendations_text || 'Your digital infrastructure is performing optimally. No manual intervention is required at this time.'}</p>
        </div>

        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e7; text-align: center;">
            <p style="color: #86868b; font-size: 13px;">This report was automatically generated by the iCreate Solutions & Services Command Center.</p>
        </div>
    `;

    return { subject, text: textBody, html: getBaseHtml(htmlBody) };
}

module.exports = { getInvoiceEmailContent, getClientCarePulseEmailContent, getMonthlySummaryEmailContent };
