-- schema_reveal_hunt.sql
-- Guest entries for the Big Reveal Hunt game (/reveal-hunt).
-- Run once in the Supabase SQL Editor. Safe to run again.
-- Entries stay until you delete them in /reveal-hunt-admin.

CREATE TABLE IF NOT EXISTS public.reveal_hunt_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    guest_name TEXT,
    team TEXT CHECK (team IN ('pink', 'blue')),
    picks JSONB NOT NULL DEFAULT '{}'::jsonb,
    tickets_won INTEGER NOT NULL DEFAULT 0 CHECK (tickets_won BETWEEN 0 AND 5),
    finished BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- The server uses the service-role key, which bypasses RLS.
-- With RLS on and no policies, the public anon key cannot read or write this table.
ALTER TABLE public.reveal_hunt_entries ENABLE ROW LEVEL SECURITY;
