-- ============================================================
-- ICSS Command Center: Verify/Create Leads & Reviews Tables
-- Safe to run multiple times (uses IF NOT EXISTS)
-- ============================================================

-- 1. LEADS TABLE
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Source tracking
  source VARCHAR(100),
  lead_type VARCHAR(100),
  page_url TEXT,
  referrer TEXT,
  landing_page TEXT,
  
  -- UTM tracking
  utm_source VARCHAR(255),
  utm_medium VARCHAR(255),
  utm_campaign VARCHAR(255),
  utm_content VARCHAR(255),
  utm_term VARCHAR(255),
  user_agent TEXT,
  
  -- Status
  status VARCHAR(50) DEFAULT 'New',
  priority VARCHAR(20) DEFAULT 'Warm',
  
  -- Contact info
  name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  business_name VARCHAR(255),
  website_url TEXT,
  preferred_contact_method VARCHAR(50),
  consent_given BOOLEAN DEFAULT false,
  
  -- Project details
  service_needed VARCHAR(255),
  package_name VARCHAR(100),
  project_type VARCHAR(100),
  project_stage VARCHAR(100),
  budget VARCHAR(100),
  timeline VARCHAR(100),
  goal TEXT,
  message TEXT,
  pain_point TEXT,
  description TEXT,
  
  -- Flexible data
  selected_features JSONB DEFAULT '[]',
  selected_needs JSONB DEFAULT '[]',
  form_data JSONB DEFAULT '{}',
  
  -- Internal
  internal_notes TEXT,
  
  -- Spam protection
  honeypot VARCHAR(255),
  submission_time_ms INTEGER
);
-- 1b. ADD COLUMNS IF NOT EXISTS (To safely patch existing tables)
DO $$
BEGIN
  -- Source tracking
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS source VARCHAR(100);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_type VARCHAR(100);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS page_url TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS referrer TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS landing_page TEXT;
  
  -- UTM tracking
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_agent TEXT;
  
  -- Status
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'New';
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'Warm';
  
  -- Contact info
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS name VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS email VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_name VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS website_url TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_contact_method VARCHAR(50);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT false;
  
  -- Project details
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS service_needed VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS package_name VARCHAR(100);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_type VARCHAR(100);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_stage VARCHAR(100);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS budget VARCHAR(100);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS timeline VARCHAR(100);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS goal TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS message TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS pain_point TEXT;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS description TEXT;
  
  -- Flexible data
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS selected_features JSONB DEFAULT '[]';
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS selected_needs JSONB DEFAULT '[]';
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS form_data JSONB DEFAULT '{}';
  
  -- Internal
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS internal_notes TEXT;
  
  -- Spam protection
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS honeypot VARCHAR(255);
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS submission_time_ms INTEGER;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);
CREATE INDEX IF NOT EXISTS idx_leads_lead_type ON leads(lead_type);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);

-- 2. REVIEWS TABLE
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, hidden, deleted
    name TEXT NOT NULL,
    business_name TEXT,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    website_url TEXT,
    service_completed TEXT,
    message TEXT NOT NULL
);

-- 2b. ADD COLUMNS IF NOT EXISTS (To safely patch existing tables)
DO $$
BEGIN
  ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS name TEXT NOT NULL;
  ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS business_name TEXT;
  ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS rating INTEGER NOT NULL DEFAULT 5;
  ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS website_url TEXT;
  ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS service_completed TEXT;
  ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- 3. VERIFICATION: Check both tables exist
SELECT 'leads' AS table_name, COUNT(*) AS row_count FROM leads
UNION ALL
SELECT 'reviews' AS table_name, COUNT(*) AS row_count FROM reviews;
