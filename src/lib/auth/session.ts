import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { AccessContext } from "@/modules/access";
import type { ModuleKey, PermissionAction, PermissionScope } from "@/modules/types";

export const ACTIVE_BUSINESS_COOKIE = "active_business_id";

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface BusinessAccess {
  business_id: string;
  business_name: string;
  logo_path: string | null;
  currency: string;
  timezone: string;
  date_format: string;
  country: string;
  onboarding_completed_at: string | null;
  role_id: string;
  role_key: string | null;
  role_name: string;
  is_owner: boolean;
  employee_id: string | null;
  modules: ModuleKey[];
  permissions: { resource: string; action: PermissionAction; scope: PermissionScope }[];
}

/** The signed-in user, or null. Verified from the session token. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Always evaluated per request, never baked into a pre-built page.
  await connection();
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
});

/** Use at the top of any private page: sends signed-out visitors to the login page. */
export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return user;
}

/** Every business the user belongs to, with their role, enabled modules and permissions. */
export const getMyBusinesses = cache(async (): Promise<BusinessAccess[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_access");
  if (error) throw new Error(`Could not load your businesses: ${error.message}`);
  return (data ?? []) as BusinessAccess[];
});

/**
 * The business the user is currently working in. Chosen from the
 * business switcher (stored in a cookie), otherwise the one used last,
 * otherwise the first one. Always re-checked against their memberships,
 * so a guessed or stale cookie can never open someone else's business.
 */
export const getActiveBusiness = cache(async (): Promise<BusinessAccess | null> => {
  const businesses = await getMyBusinesses();
  if (businesses.length === 0) return null;
  const cookieStore = await cookies();
  const chosen = cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value;
  const match = businesses.find((b) => b.business_id === chosen);
  if (match) return match;

  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: profile } = await supabase.from("profiles").select("last_business_id").eq("id", user!.id).maybeSingle();
  return businesses.find((b) => b.business_id === profile?.last_business_id) ?? businesses[0];
});

export function toAccessContext(b: BusinessAccess): AccessContext {
  return { isOwner: b.is_owner, modules: b.modules, permissions: b.permissions };
}
