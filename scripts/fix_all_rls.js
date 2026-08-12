const { Client } = require('pg');

const connectionString = 'postgresql://postgres.bfhyuohoukpqvyfhqugm:Shambizonly1%40@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

async function fixRLS() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to database.');

    // Get all tables in public schema
    const result = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);

    const tables = result.rows.map(r => r.tablename);
    console.log(`Found ${tables.length} tables in public schema.`);

    for (const table of tables) {
      console.log(`Enabling RLS on public."${table}"...`);
      await client.query(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;`);
    }

    console.log('Successfully enabled RLS on all tables in public schema!');
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await client.end();
  }
}

fixRLS();
