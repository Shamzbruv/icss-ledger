require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const query = `
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'expense_records';
`;

async function run() {
    const { data, error } = await supabase.rpc('postgres_query', { query });
    console.log(data, error);
}
run();
