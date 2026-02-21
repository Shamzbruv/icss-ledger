-- =================================================================================
-- DUPLICATES CLEANUP AND SCHEMA FIX
-- =================================================================================

-- 1. Ensure created_at exists (Idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'created_at') THEN
        ALTER TABLE invoices ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;
    END IF;
END $$;

-- 2. Populate created_at where missing
UPDATE invoices SET created_at = COALESCE(issue_date::timestamp, now()) WHERE created_at IS NULL;

-- 3. Resolve Duplicates
-- Strategy: For each set of duplicates, keep the one with the LATEST created_at (or random if same) as the 'real' one.
-- Rename others to 'INV-ICSS-XXX-COPY-uuid_prefix'
DO $$
DECLARE
    r RECORD;
    dup_row RECORD;
    i INT;
BEGIN
    -- Iterate over all invoice numbers that appear more than once
    FOR r IN 
        SELECT invoice_number
        FROM invoices
        GROUP BY invoice_number
        HAVING COUNT(*) > 1
    LOOP
        i := 0;
        -- Loop through the duplicates for this specific invoice_number, ordered by created_at DESC.
        -- We skip the first one (OFFSET 1) because that's the most recent one we want to keep.
        FOR dup_row IN 
            SELECT id 
            FROM invoices 
            WHERE invoice_number = r.invoice_number 
            ORDER BY created_at DESC, id DESC 
            OFFSET 1
        LOOP
            i := i + 1;
            -- Rename the duplicate
            UPDATE invoices 
            SET invoice_number = invoice_number || '-OLD-' || i || '-' || substring(id::text, 1, 4)
            WHERE id = dup_row.id;
        END LOOP;
    END LOOP;
END $$;

-- 4. Apply Unique Constraint (Should succeed now)
BEGIN;
    ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);
COMMIT;
