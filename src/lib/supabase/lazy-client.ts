"use client";

/**
 * The browser Supabase client, loaded the first time it's needed (a file
 * upload, two-step setup) instead of with the page, so pages that only
 * might upload something don't download the Supabase library upfront.
 */
export async function getBrowserClient() {
  const { createClient } = await import("./client");
  return createClient();
}
