import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireSupabasePublicEnv } from "@/lib/env";

/**
 * Supabase client with the SECRET key. It bypasses Row Level Security,
 * so only use it on the server for jobs that genuinely need it (sending
 * emails to other users, scheduled reminders, the public careers form),
 * and always check permissions yourself before using it.
 * Never import this file from a "use client" component.
 */
export function createAdminClient() {
  const { url } = requireSupabasePublicEnv();
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is missing from your environment variables (see README).");
  }
  return createSupabaseClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAdminConfigured(): boolean {
  return !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
}
