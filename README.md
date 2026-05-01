# ICSS Ledger

A free, full-stack billing system integrated with Supabase, PDF generation, Email (Gmail), and PayPal/Bank Transfer detection.

## Prerequisites

- Node.js (v14+)
- Supabase Account (Free)
- Gmail Account (with App Password)
- PayPal Developer Account (for Webhooks)

## Setup

1. **Clone & Install**
   ```bash
   npm install
   ```

2. **Database Setup**
   - Log in to Supabase.
   - Go to the SQL Editor.
   - Copy and paste the contents of `schema.sql` and run it to create the tables.

3. **Environment Configuration**
   - Rename `.env.example` to `.env`.
   - Fill in your `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EMAIL_USER`, `EMAIL_APP_PASSWORD`, etc.

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
