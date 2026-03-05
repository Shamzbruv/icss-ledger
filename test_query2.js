require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const query = `
  SELECT conname 
  FROM pg_constraint 
  WHERE conrelid = 'bulk_import_lines'::regclass 
  AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'bulk_import_lines'::regclass AND attname = 'suggested_account_id')]::smallint[]
  AND contype = 'f'
`;

async function run() {
    const { data, error } = await supabase.rpc('postgres_query', { query });
    console.log(data, error);
}
run();
