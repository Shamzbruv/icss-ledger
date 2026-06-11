-- schema_reviews.sql
-- Create the reviews table
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

-- Note: To execute this, run it in the Supabase SQL Editor.
