require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const isHostedProduction = process.env.NODE_ENV === 'production'
  || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const localAnonKey = !isHostedProduction ? process.env.SUPABASE_ANON_KEY : null;
const supabaseKey = serviceKey || localAnonKey;

if (!supabaseUrl || !supabaseKey) {
  const keyName = isHostedProduction
    ? 'SUPABASE_SERVICE_KEY'
    : 'SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY for local development only)';
  throw new Error(`Supabase configuration is incomplete. Set SUPABASE_URL and ${keyName}.`);
}

if (!serviceKey) {
  console.warn('[SUPABASE] Using the anon key for local development; protected backend tables require SUPABASE_SERVICE_KEY.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
