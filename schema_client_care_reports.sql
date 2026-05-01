-- =============================================
-- CLIENT CARE PULSE: REPORT HISTORY
-- =============================================

BEGIN;

CREATE TABLE IF NOT EXISTS client_care_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_run_id UUID REFERENCES checklist_runs(id) ON DELETE CASCADE,
    client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL,
    recipient_email TEXT NOT NULL,
    email_subject TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT DEFAULT 'sent', -- 'sent', 'failed'
    metadata_json JSONB DEFAULT '{}'::JSONB
);

-- Index for faster history lookups
CREATE INDEX IF NOT EXISTS idx_client_care_reports_sent_at ON client_care_reports(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_care_reports_service ON client_care_reports(client_service_id);

COMMIT;
