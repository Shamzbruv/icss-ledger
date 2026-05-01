# ICSS Command Center - Deployment Guide

## 1. Database Setup (Supabase)
1.  Go to your Supabase Project -> SQL Editor.
2.  Open `SUPABASE_FINAL_MIGRATION.sql` (found in the root of the project).
3.  Copy and paste the **entire content** into the SQL Editor.
4.  Click **Run**.
5.  Check the "Results" tab. It should show "Success" and no errors.
6.  (Optional) Scroll to the bottom of the file and run the "Verification Queries" one by one to confirm.

## 2. Server Configuration (.env)
1.  Navigate to `icss-command-center/`.
2.  Copy `.env.example` to `.env`.
3.  Fill in your keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, etc.).
4.  **CRITICAL: `APP_BASE_PATH` Setting**
    - **Scenario A (Recommended):** You set up the Node.js app in cPanel to load from `http://icreatesolutionsandservices.com/command`.
        - Set `APP_BASE_PATH=` (leave empty).
    - **Scenario B:** You set up the Node.js app to load from the ROOT `http://icreatesolutionsandservices.com`.
        - Set `APP_BASE_PATH=/command`.

## 3. Node.js App Deployment (cPanel / iFastNet)
1.  **Upload**: Upload the entire `icss-command-center` folder to your server (outside `public_html` if possible, or protected).
2.  **Node Version**: Ensure you select Node.js 18 or 20.
3.  **Application Startup File**: `server.js`.
4.  **Install Dependencies**: Run `npm install` button in cPanel or `npm install` via SSH.
5.  **Start App**: Click "Start App".

## 4. Static Site Deployment
1.  Upload all HTML files (`index.html`, `portfolio.html`, etc.) and `assets/` folder to `public_html`.
2.  Do **NOT** upload `icss-command-center` folder into `public_html` if you can avoid it (keep it parallel).

## 5. Launch Test Script (Verification)

### Step 1: Public Site Check
- [ ] Go to `https://icreatesolutionsandservices.com`.
- [ ] Verify the "Secret Padlock" icon is in the footer/header.
- [ ] **Click the Padlock**.
    - **Pass:** It redirects to `.../command/login`.
    - **Fail:** 404 Not Found (Check `APP_BASE_PATH` or cPanel alias).

### Step 2: Login Check
- [ ] Enter Admin Credentials.
- [ ] Click Login.
- [ ] **Pass:** Redirects to `.../command/dashboard`.
- [ ] **Fail:** Redirects to `/dashboard` (missing `APP_BASE_PATH` prefix) or stays on login.

### Step 3: Schema & App Health
- [ ] Monitor the Startup Log (Passenger log in cPanel).
- [ ] **Pass:** You see `✅ Database Schema Check Passed`.
- [ ] **Fail:** You see `❌ CRITICAL: Unknown Schema Error`.
    - *Fix:* Run the `SUPABASE_FINAL_MIGRATION.sql` again.
- [ ] **Fail:** `503 Service Unavailable` page on browser.
    - *Fix:* This means the DB check failed. Check logs for missing column names.

### Step 4: Feature Check
- [ ] Navigate to "Invoices".
- [ ] Create a "Test Invoice".
- [ ] **Pass:** Success message, email sent (if configured).
- [ ] Click "Pulse/Scheduling".
- [ ] **Pass:** Page loads without crushing (verifies `client_services` table).
