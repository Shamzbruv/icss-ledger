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
   - Run `SUPABASE_FINAL_MIGRATION.sql`. It is idempotent and includes the invoice, PayPal webhook, Client Care, relationship-email, plan, and checklist schema used by the current server.
   - Railway deploys application code only; it does not execute Supabase SQL automatically.

3. **Environment Configuration**
   - Rename `.env.example` to `.env`.
   - Configure `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and `PAYPAL_MODE`.
   - For automated GA4 traffic analysis, set `GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON` (or its base64 form in `GOOGLE_ANALYTICS_SERVICE_ACCOUNT_BASE64`). In Client Care, save each site's numeric GA4 Property ID and grant the service-account email Viewer access to that property.
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

## Development

- `src/services/pdfService.js`: Customizes the PDF layout.
- `src/services/emailService.js`: Handles email transport.
- `src/services/imapService.js`: Logic for detecting bank transfer emails.
