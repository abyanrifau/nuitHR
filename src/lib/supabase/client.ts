"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for browser components (file uploads, live updates).
 * It acts as the signed-in user, so Row Level Security applies.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not connected yet. See README → Environment variables.");
  }
  return createBrowserClient(url, key);
}
