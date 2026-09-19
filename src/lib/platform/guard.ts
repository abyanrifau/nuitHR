import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

/**
 * Who may use the platform admin panel (/admin): Harbor's own staff, listed in
 * the PLATFORM_ADMIN_EMAILS setting. This is separate from the admin roles
 * inside each company.
 *
 * Every admin page and every admin action calls requirePlatformAdmin() on the
 * server. Anyone else gets a plain "page not found", so the panel's existence
 * isn't revealed.
 */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export interface PlatformAdmin {
  id: string;
  email: string;
}

export type AdminGate =
  | { kind: "admin"; admin: PlatformAdmin }
  /** On the list, but two-step sign-in isn't set up yet. */
  | { kind: "needs_2fa_setup"; admin: PlatformAdmin }
  /** On the list and set up, but hasn't entered the code this session. */
  | { kind: "needs_2fa_verify"; admin: PlatformAdmin }
  | { kind: "none" };

export const getAdminGate = cache(async (): Promise<AdminGate> => {
  const allowed = platformAdminEmails();
  if (!allowed.length || !isAdminConfigured()) return { kind: "none" };
  const supabase = await createClient();
  // getUser asks Supabase directly (not just the cookie), so the email and its confirmation are current.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !user.email_confirmed_at) return { kind: "none" };
  const email = user.email.toLowerCase();
  if (!allowed.includes(email)) return { kind: "none" };
  const admin = { id: user.id, email };

  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.aal === "aal2") return { kind: "admin", admin };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasVerified = (factors?.totp ?? []).some((f) => f.status === "verified");
  return hasVerified ? { kind: "needs_2fa_verify", admin } : { kind: "needs_2fa_setup", admin };
});

/** For admin pages and actions: the signed-in platform admin, or a plain 404 for anyone else. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const gate = await getAdminGate();
  if (gate.kind !== "admin") notFound();
  return gate.admin;
}

/** Keeps the database's list of platform admins (used for support access) in line with the setting. */
export async function syncPlatformAdmins() {
  if (!isAdminConfigured()) return;
  await createAdminClient().rpc("admin_sync_platform_admins", { p_emails: platformAdminEmails() });
}

/**
 * Page titles for the admin area, only for platform admins. Everyone else
 * gets no admin title at all, so a refused page looks like any other 404.
 */
export async function adminTitle(title: string): Promise<{ title?: { absolute: string } }> {
  const gate = await getAdminGate();
  return gate.kind === "none" ? {} : { title: { absolute: `${title} | Harbor admin` } };
}
