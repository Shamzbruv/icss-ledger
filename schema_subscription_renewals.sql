-- schema_subscription_renewals.sql
-- Adds columns for explicitly tracking when a subscription renews and when a reminder was sent

ALTER TABLE client_services ADD COLUMN IF NOT EXISTS next_renewal_date DATE;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS last_renewal_reminder_sent_date DATE;
