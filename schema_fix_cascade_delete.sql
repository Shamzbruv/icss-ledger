-- =============================================
-- FIX: ENSURE CASCADE DELETE FOR CLIENT CARE PULSE
-- =============================================
-- This script ensures that deleting a client service automatically
-- deletes all associated runs and items.

BEGIN;

-- 1. Fix checklist_runs -> client_services
ALTER TABLE checklist_runs
DROP CONSTRAINT IF EXISTS checklist_runs_client_service_id_fkey;

ALTER TABLE checklist_runs
ADD CONSTRAINT checklist_runs_client_service_id_fkey
FOREIGN KEY (client_service_id)
REFERENCES client_services(id)
ON DELETE CASCADE;

-- 2. Fix checklist_run_items -> checklist_runs
ALTER TABLE checklist_run_items
DROP CONSTRAINT IF EXISTS checklist_run_items_checklist_run_id_fkey;

ALTER TABLE checklist_run_items
ADD CONSTRAINT checklist_run_items_checklist_run_id_fkey
FOREIGN KEY (checklist_run_id)
REFERENCES checklist_runs(id)
ON DELETE CASCADE;

-- 3. Fix client_care_reports -> checklist_runs (optional, usually set null or cascade)
-- We'll keep history if possible, but if run is gone, report link breaks.
-- schema_client_care_reports.sql said ON DELETE CASCADE.
ALTER TABLE client_care_reports
DROP CONSTRAINT IF EXISTS client_care_reports_checklist_run_id_fkey;

ALTER TABLE client_care_reports
ADD CONSTRAINT client_care_reports_checklist_run_id_fkey
FOREIGN KEY (checklist_run_id)
REFERENCES checklist_runs(id)
ON DELETE CASCADE;

COMMIT;

-- =============================================
-- EXECUTION FINISHED
-- =============================================
