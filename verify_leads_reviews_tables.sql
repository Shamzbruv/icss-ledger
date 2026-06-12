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

-- 3. VERIFICATION: Check both tables exist
SELECT 'leads' AS table_name, COUNT(*) AS row_count FROM leads
UNION ALL
SELECT 'reviews' AS table_name, COUNT(*) AS row_count FROM reviews;
