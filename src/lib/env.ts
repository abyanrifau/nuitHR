/**
 * Reads the secret keys and settings from environment variables
 * (the .env.local file on your computer, or Vercel's settings online).
 * See README → "Environment variables" for what each one is.
 */

import { appConfig } from "@/config/app.config";

export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
}

/** The public "publishable" key (older Supabase projects call it the "anon" key). */
export function supabasePublishableKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;
}

/** True once the two public Supabase settings are filled in. */
export function isSupabaseConfigured(): boolean {
  return !!supabaseUrl() && !!supabasePublishableKey();
}

export function requireSupabasePublicEnv(): { url: string; key: string } {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  if (!url || !key) {
    throw new Error(
      "Supabase is not connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to your .env.local file (see README).",
    );
  }
  return { url, key };
}

/**
 * The web address of this app: the one used in email links, and the one
 * visitors are sent to if they arrive on a different address (such as the
 * vercel.app one). NEXT_PUBLIC_SITE_URL wins, then the address in
 * src/config/app.config.ts, so links are right even if the setting is
 * missing on Vercel.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const configured = appConfig.brand.siteUrl?.trim().replace(/\/$/, "");
  if (configured && process.env.NODE_ENV === "production") return configured;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
