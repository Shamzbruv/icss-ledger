-- Phase 8: Subscription Billing Integration

-- 1. Add next_billing_date to client_services
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_billing_date DATE;

-- 2. Link invoices to client_services
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_service_id UUID REFERENCES client_services(id) ON DELETE SET NULL;
