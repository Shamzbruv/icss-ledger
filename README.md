# ICSS Ledger

A free, full-stack billing system integrated with Supabase, PDF generation, Email (Gmail), and PayPal/Bank Transfer detection.

## Prerequisites

- Node.js (v18+)
- Supabase Account (Free)
- Gmail Account (with App Password)
- PayPal Developer Account (for Webhooks)

## Setup

1. **Clone & Install**
   ```bash
   npm install
   ```

2. **Database Setup**
   - Log in to Supabase and open the SQL Editor.
   - Run `SUPABASE_FINAL_MIGRATION.sql`. It is idempotent and includes the invoice, PayPal webhook, Client Care, relationship-email, Link Hub, plan, and checklist schema used by the current server.
   - Railway deploys application code only; it does not execute Supabase SQL automatically.
   - Historical PayPal-event recovery stays safely paused until the migration's unique payment-reference check is installed; Railway rechecks it automatically every hour.

3. **Environment Configuration**
   - Rename `.env.example` to `.env`.
   - Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and `PAYPAL_MODE`. Railway must have the service-role key in `SUPABASE_SERVICE_KEY`; the backend intentionally refuses to use the public anon key in production.
   - For automated GA4 traffic analysis, set `GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON` (or its base64 form in `GOOGLE_ANALYTICS_SERVICE_ACCOUNT_BASE64`). In Client Care, save each site's numeric GA4 **Property ID** (Admin → Property settings, usually 9–10 digits — *not* the longer Data Stream ID and not the `G-` measurement ID) and grant the service-account email Viewer access to that property. The **Test Google Analytics** button in *Edit Service* explains in plain English what is (not) working.
   - Enable the **Google Analytics Admin API** (and the Data API) for the same Google Cloud project as the service account. With the Admin API on, the system can find a missing or mistyped Property ID itself (matching the site's `G-` tag, the Data Stream ID or the domain, and only when exactly one property matches) and it refuses to show a client another business's traffic.
   - Optional: `PAGESPEED_API_KEY` adds Google's PageSpeed score to the Web Maintenance and Content Refresh reports. Without it the check is simply left out. `CARE_ALERT_EMAIL` (default: `ADMIN_EMAIL`) receives alerts about outages, expiring certificates/domains and Google Analytics set-up problems. `PUBLIC_BASE_URL` sets the link used in those alerts.
   - Set `CRON_SECRET` for protected scheduled-job requests in production.

4.  **Run the Server**
    You need **two terminal windows** open during development:

    **Terminal 1 (Public URL Tunnel)**:
    ```bash
    npx localtunnel --port 3000
    ```

    **Terminal 2 (Your Application)**:
    ```bash
    npm start
    ```
    The server will start on http://localhost:3000.

## Usage

### Creating an Invoice
1. Open http://localhost:3000 in your browser.
2. Enter the Client ID (UUID from Supabase `clients` table).
3. Add items, due date, and notes.
4. Click "Create & Send Invoice".
   - This will:
     - Save invoice to DB.
     - Generate a PDF.
     - Email the PDF to the client.

### Payment Handling
- **PayPal**: Configure your PayPal Webhook to point to `https://your-domain.com/api/paypal/webhook`.
- **Bank Transfer**: The system includes an IMAP script to check for payment emails.
  - You can run it manually or schedule it:
    ```bash
    node -e 'require("./src/services/imapService").checkEmailsForPayments()'
    ```

### Client Care reports

Each active website plan gets a weekly report (and a monthly review on the 1st). Everything in a report comes from live checks of the client's own website and Google Analytics; nothing is invented.

| Plan | What is checked and explained |
| --- | --- |
| Hosting Only | online/uptime, page speed, SSL padlock, secure forwarding, phone-friendliness, visitor statistics, how the homepage looks on Google |
| Hosting + Domain Management | + domain renewal date, DNS, business-email protection, traffic sources and devices, how easy the page is to contact |
| Web Maintenance | + security settings, insecure page items, WordPress/plugin updates, broken links, search basics, day-by-day traffic and countries |
| Content Refresh | + page-by-page review, picture descriptions, sitemap, content freshness, and content ideas based on the most-viewed pages |

- In *Client Care*, **Preview** runs the real checks and shows exactly what the client would receive (plus notes for the team that clients never see). It sends and saves nothing. **Send test to me** emails that preview to the admin only. **Run Now** emails the client.
- The wording lives in `src/services/care/`: `carePlans.js` (what each plan covers), `careExplainers.js` (plain-English explanations), `careAnalytics.js` (visitor section), `careReport.js` (scoring and report model), `careReportEmail.js` (HTML + text rendering). The checks themselves are in `src/services/checks/`.
- A Google Analytics connection problem never lowers a client's score or shows Google's error text to the client. The client sees a gentle "we're still connecting your visitor statistics" note while the team gets an alert (at most weekly) with exact steps.
- Run the tests with `npm test`.

### Partner Contracts

*Partner Contracts* in the sidebar lists the companies iCreate owns (HaloManage) and general agreements:

- **HaloManage** — four role agreements (client acquisition, accounting/payroll, 90-day interim, HR consulting).
- **Referral Contract** — the *Referral Partner Commission Agreement* for anyone who introduces clients: a flat commission (default JMD $2,000) on projects below a threshold (default JMD $120,000) and a percentage (default 5%) above it, paid within 7/14/30 business days of the client's payment clearing. Each partner's copy can be customized (amounts, threshold, percentage, payment time, notice period, optional extra terms) before sending.

Both use the same workflow as client contracts: draft → email (or copy the link) → partner views → partner signs electronically (drawn or typed) → company countersignature is applied automatically → signed PDF with audit trail emailed to the partner, owner notified. Drafts can be edited and previewed as PDF; sent agreements can be resent or voided; signed ones can be downloaded. When the Company has no address/phone for a referral partner, the signing page asks for them, plus an optional TRN and an optional witness. The agreement wording lives in `src/services/referralContractTemplate.js` (referral) and `src/services/partnerContractTemplate.js` (HaloManage); the shared routes are in `src/routes/partnerContracts.js`. Referral terms are stored in `partner_contracts.custom_terms_json` / `signer_extra_json` (see `schema_partner_contracts.sql`).

## Development

- `src/services/pdfService.js`: Customizes the PDF layout.
- `src/services/emailService.js`: Handles email transport.
- `src/services/imapService.js`: Logic for detecting bank transfer emails.

## Website structure and content management

The public website now has dedicated `/services`, `/portfolio`, `/project.html?id=…`,
`/about`, `/contact` and `/work-with-icss` pages. The homepage preserves the original
blue technology theme, founder profile and social links, full service offerings,
packages, estimator, instant quote, reviews and inquiry tools. The estimator is at
`/#project-estimator`; `/project-planner.html` provides an additional entry point.

In Command Center, use **Website & Portfolio** or **Careers & Referrals** to open
`/website-manager`. Add or edit projects, choose a category and system type, set
visibility and portfolio display order, and publish changes. The homepage automatically
previews the three most recently added published projects; editing a project does
not reset its added date. Existing projects without an added date retain their
previous display order until new projects are added. Vacancies, referral
program information and the About story use the same editor. No vacancy is
advertised until it is published. Application reviews save immediately; content
changes use the Publish button. The website refreshes published content within
30 seconds.

Content is stored under `link_hub_settings.content.website` in the existing
single-business settings document. Link Hub saves preserve website content, and
website saves preserve Link Hub settings. Optimistic revision checks reject stale
edits. No new database tables or public Supabase grants are required. The server
uses its existing service connection; management APIs use Command Center auth.
Career and referral requests are saved in `leads` with `source = 'Work with ICSS'`
and are available both in the website manager's inbox and the existing Leads UI.

When the database is unavailable, public pages use the bundled portfolio and
business story. Admin publishing and form submissions return an error instead of
acknowledging an unsaved change. Restore database availability to use live content,
applications and accounting. The server retries its database health check once a
minute after an outage.

Dedicated pages use small local CSS and JavaScript files. Older public pages
use a precompiled Tailwind stylesheet instead of the browser runtime. After changing
utility classes on those pages, run `npm run build:styles` and commit the result.
`scripts/build-public-pages.py` regenerates dedicated pages from bundled defaults
and the homepage from the complete `project-planner.html` template. It replaces
only the homepage portfolio section with managed project cards. Runtime content
changes belong in Website Manager.

Command Center loads public authentication settings from `/auth/config`, using
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`. This endpoint
rejects service-role keys. `/auth/login` uses an isolated public client per attempt
and returns a Supabase session for browser persistence; it does not depend on an
unconfigured Express session. `/auth/check` verifies an explicit bearer token.
The Supabase project must be active for real login and data access. Mocked tests
verify the login flow and provider-outage handling without real credentials.

Run `npm test` for the regression suite. Tests use mocked services and do not post
live accounting records, submit real applications or send production emails.
