import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
const anonKey = process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAuthProjectRef = (() => {
  try {
    return url ? new URL(url).hostname.split('.')[0] : null;
  } catch {
    return null;
  }
})();

export function getSupabaseAuthConfigStatus() {
  return {
    hasUrl: Boolean(url),
    hasAnonKey: Boolean(anonKey),
    projectRef: supabaseAuthProjectRef,
  };
}

export const supabaseAuthClient: SupabaseClient | null = url && anonKey
  ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export const supabaseAdminClient: SupabaseClient | null = url && serviceRoleKey
  ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
