-- Fix auto_category_rules foreign key constraint
ALTER TABLE auto_category_rules DROP CONSTRAINT IF EXISTS auto_category_rules_target_account_id_fkey;
ALTER TABLE auto_category_rules ADD CONSTRAINT auto_category_rules_target_account_id_fkey FOREIGN KEY (target_account_id) REFERENCES chart_of_accounts(id) ON DELETE CASCADE;
