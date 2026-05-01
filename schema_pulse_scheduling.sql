-- 1. Add Scheduling Columns to client_services
ALTER TABLE client_services
ADD COLUMN IF NOT EXISTS send_time TIME DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Jamaica',
ADD COLUMN IF NOT EXISTS send_day_of_week INT, -- 0-6 (Sun-Sat)
ADD COLUMN IF NOT EXISTS send_day_of_month INT, -- 1-28
ADD COLUMN IF NOT EXISTS send_week_of_month INT, -- 1-4
ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP WITH TIME ZONE;

-- 2. Create monthly_pulse_summaries table
CREATE TABLE IF NOT EXISTS monthly_pulse_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    month TEXT NOT NULL, -- Format: 'YYYY-MM'
    total_reports_sent INT DEFAULT 0,
    pass_count INT DEFAULT 0,
    warn_count INT DEFAULT 0,
    fail_count INT DEFAULT 0,
    overall_status TEXT, -- 'Mostly Healthy', 'Needs Attention', 'Critical Issues'
    top_issues_json JSONB DEFAULT '[]'::jsonb,
    recommendations_text TEXT,
    emailed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(client_id, month)
);

-- 3. Enable RLS (if active on other tables)
ALTER TABLE monthly_pulse_summaries ENABLE ROW LEVEL SECURITY;

-- 4. Create Policy (Public for now, similar to other tables in this dev setup)
CREATE POLICY "Enable all access for all users" ON monthly_pulse_summaries
FOR ALL USING (true) WITH CHECK (true);
