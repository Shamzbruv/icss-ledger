-- Add billing_email column to clients table
-- This allows a different payer email (e.g. spouse, admin) to be linked to a client account
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_email TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_billing_email ON clients (billing_email);

-- Set Kamille as the billing email for Mr. Hoilett
UPDATE clients
SET billing_email = 'kgardnerhoilett@gmail.com'
WHERE email = 'hoiletttech1@gmail.com';
