import { createClient, SupabaseClient } from '@supabase/supabase-js';

const serverUrl = process.env.SUPABASE_URL?.trim();
const url = serverUrl || process.env.VITE_SUPABASE_URL?.trim();
const anonKey = process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim();
const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

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

export function getSupabaseAdminConfigError(): string | null {
  const missing: string[] = [];
  if (!serverUrl) missing.push('SUPABASE_URL');
  if (!adminKey) missing.push('SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)');
  return missing.length > 0
    ? `Supabase Auth administration is unavailable. Configure ${missing.join(' and ')} as server-side environment variables.`
    : null;
}

export const supabaseAuthClient: SupabaseClient | null = url && anonKey
  ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export const supabaseAdminClient: SupabaseClient | null = serverUrl && adminKey
  ? createClient(serverUrl, adminKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null;
