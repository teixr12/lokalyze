import { createClient } from '@supabase/supabase-js';

let supabaseAdminClient = null;

export const getSupabaseAdmin = () => {
  if (supabaseAdminClient) return supabaseAdminClient;

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !serviceRole) {
    throw new Error('Missing Supabase admin credentials (VITE_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)');
  }

  supabaseAdminClient = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });

  return supabaseAdminClient;
};

