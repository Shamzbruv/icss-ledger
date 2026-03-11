-- Enable Row Level Security (RLS) on all tables flagged by the Supabase Security Advisor
-- These tables are currently exposed to public access. Enabling RLS blocks anonymous/public access.
-- Since the backend uses the Service Role Key (which bypasses RLS), this will not break the app.

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_forms_generated ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_policy_versions ENABLE ROW LEVEL SECURITY;

-- If you ever need authenticated users (from the frontend) to query these directly,
-- you will need to add Policies, e.g.:
-- CREATE POLICY "Allow authenticated access" ON public.table_name FOR ALL TO authenticated USING (true);
