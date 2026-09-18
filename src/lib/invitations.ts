import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";
import { emailButton, emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { appConfig } from "@/config/app.config";
import { friendly } from "@/lib/errors";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return siteUrl();
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Creates an invitation (cancelling older ones for the same email) and emails the link. */
export async function createInvitation(opts: {
  businessId: string;
  businessName: string;
  email: string;
  roleId: string;
  roleName: string;
  employeeId?: string | null;
  inviterName: string;
}): Promise<{ link?: string; emailed: boolean; error?: string }> {
  const supabase = await createClient();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Cancel older pending invitations for the same person.
  await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("business_id", opts.businessId)
    .ilike("email", opts.email)
    .is("accepted_at", null)
    .is("revoked_at", null);
  const { error } = await supabase.from("invitations").insert({
    business_id: opts.businessId,
    email: opts.email.toLowerCase(),
    role_id: opts.roleId,
    employee_id: opts.employeeId ?? null,
    token_hash: tokenHash,
  });
  if (error) return { emailed: false, error: friendly(error.message) };

  const link = `${await origin()}/invite/${token}`;
  const sent = await sendEmail({
    to: opts.email,
    subject: `You're invited to join ${opts.businessName} on ${appConfig.brand.name}`,
    text: `${opts.inviterName} invited you to join ${opts.businessName} on ${appConfig.brand.name} as ${opts.roleName}.\n\nAccept the invitation: ${link}\n\nThe link expires in 14 days.`,
    html: emailLayout(
      `Join ${opts.businessName}`,
      `<p>${escapeHtml(opts.inviterName)} invited you to join <strong>${escapeHtml(opts.businessName)}</strong> on ${escapeHtml(appConfig.brand.name)} as <strong>${escapeHtml(opts.roleName)}</strong>.</p>${emailButton(link, "Accept invitation")}<p style="font-size:13px;color:#5a6473">The link expires in 14 days. If you weren't expecting this, you can ignore this email.</p>`,
    ),
  });
  return { link, emailed: sent.ok, error: sent.ok ? undefined : sent.error };
}

