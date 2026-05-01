-- =============================================
-- SAAS MULTI-TENANT UPGRADE
-- Run this to enable multiple companies support.
-- =============================================

-- 1. Create Companies Table
CREATE TABLE IF NOT EXISTS companies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL UNIQUE,  -- e.g. 'ICSS', 'WIND'
    email TEXT,
    logo_url TEXT,
    payment_email TEXT,
    subscription_plan TEXT DEFAULT 'Free' -- Free, Pro, Enterprise
);

-- 2. Insert Default Companies (for testing)
INSERT INTO companies (name, prefix, email) VALUES 
('iCreate Solutions & Services', 'ICSS', 'admin@icreate.com'),
('Windross Tailoring', 'WIND', 'info@windross.com'),
('Grace Connect', 'GRCE', 'contact@graceconnect.com')
ON CONFLICT (prefix) DO NOTHING;

-- 3. Add company_id to Clients
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- 4. Add company_id to Invoices
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- 5. Add company_id to Payments
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- 6. Add company_id to Services (optional, if services are specific to companies)
ALTER TABLE services 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- 7. Update existing data to belong to the first company (Migration)
DO $$
DECLARE
    first_company_id UUID;
BEGIN
    SELECT id INTO first_company_id FROM companies WHERE prefix = 'ICSS' LIMIT 1;
    
    IF first_company_id IS NOT NULL THEN
        UPDATE clients SET company_id = first_company_id WHERE company_id IS NULL;
        UPDATE invoices SET company_id = first_company_id WHERE company_id IS NULL;
        UPDATE payments SET company_id = first_company_id WHERE company_id IS NULL;
        -- Services might be global or local, for now let's leave global services as NULL or assign them
        -- UPDATE services SET company_id = first_company_id WHERE company_id IS NULL;
    END IF;
END $$;

-- 8. Enable Row Level Security (RLS) - Placeholder
-- In a real app, you would enable RLS and add policies like:
-- CREATE POLICY "Tenant Isolation" ON invoices USING (company_id = auth.user_company_id());
-- ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
