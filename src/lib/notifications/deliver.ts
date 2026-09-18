import "server-only";
import { after } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { emailButton, emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/env";
import { MODULES } from "@/modules/registry";

/** Which events send an email unless the person switches it off. */
const EMAIL_DEFAULT = new Set(MODULES.flatMap((m) => m.notifications.filter((n) => n.defaultChannels.includes("email")).map((n) => n.key)));

/**
 * Sends emails for recent in-app notifications that should also go by
 * email. Safe to call often: each notification is emailed at most once
 * (a delivery row is written first). Runs with the secret key because it
 * reads other people's notifications and email addresses; it only reads
 * what the notification already says.
 */
export async function deliverPendingEmails(opts: { businessId?: string; sinceMinutes?: number } = {}): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!isAdminConfigured()) return result;
  const admin = createAdminClient();
  const since = new Date(Date.now() - (opts.sinceMinutes ?? 60 * 24) * 60_000).toISOString();

  let q = admin
    .from("notifications")
    .select("id, business_id, user_id, event_type, title, body, link, created_at, deliveries:notification_deliveries(id, channel)")
    .gte("created_at", since)
    .order("created_at")
    .limit(200);
  if (opts.businessId) q = q.eq("business_id", opts.businessId);
  const { data: rows, error } = await q;
  if (error || !rows?.length) return result;

  const pending = rows.filter((n) => !(n.deliveries as { channel: string }[]).some((d) => d.channel === "email"));
  if (!pending.length) return result;

  const businessIds = [...new Set(pending.map((n) => n.business_id))];
  const userIds = [...new Set(pending.map((n) => n.user_id))];
  const [{ data: channels }, { data: prefs }, { data: profiles }, { data: businesses }] = await Promise.all([
    admin.from("notification_channels").select("business_id, enabled").eq("channel", "email").in("business_id", businessIds),
    admin.from("notification_preferences").select("business_id, user_id, event_type, enabled").eq("channel", "email").in("user_id", userIds),
    admin.from("profiles").select("id, email, full_name").in("id", userIds),
    admin.from("businesses").select("id, name").in("id", businessIds),
  ]);

  for (const n of pending) {
    // Company switched email off entirely.
    const companyOff = channels?.some((c) => c.business_id === n.business_id && !c.enabled);
    const pref = prefs?.find((p) => p.business_id === n.business_id && p.user_id === n.user_id && p.event_type === n.event_type);
    const wanted = pref ? pref.enabled : EMAIL_DEFAULT.has(n.event_type);
    const to = profiles?.find((p) => p.id === n.user_id)?.email;
    if (companyOff || !wanted || !to) {
      await admin.from("notification_deliveries").insert({ business_id: n.business_id, notification_id: n.id, channel: "email", recipient: to ?? "", status: "skipped" });
      result.skipped++;
      continue;
    }
    // Claim the notification before sending, so two runs can't both email it.
    const { data: claim, error: claimErr } = await admin
      .from("notification_deliveries")
      .insert({ business_id: n.business_id, notification_id: n.id, channel: "email", recipient: to, status: "queued" })
      .select("id")
      .single();
    if (claimErr || !claim) continue;
    const company = businesses?.find((b) => b.id === n.business_id)?.name ?? "";
    const link = n.link ? `${siteUrl()}${n.link}` : `${siteUrl()}/app`;
    const sent = await sendEmail({
      to,
      subject: n.title,
      text: `${n.title}\n\n${n.body ?? ""}\n\nOpen: ${link}\n\n${company}. Change which emails you get in your account settings.`,
      html: emailLayout(
        n.title,
        `${n.body ? `<p>${escapeHtml(n.body)}</p>` : ""}${emailButton(link, "Open")}<p style="font-size:13px;color:#5a6473">${escapeHtml(company)}. You can change which emails you get in your account settings.</p>`,
      ),
    });
    await admin
      .from("notification_deliveries")
      .update({ status: sent.ok ? "sent" : "failed", error: sent.ok ? null : (sent.error ?? "Unknown error"), sent_at: sent.ok ? new Date().toISOString() : null })
      .eq("id", claim.id);
    if (sent.ok) result.sent++;
    else result.failed++;
  }
  return result;
}

/** Sends any emails for new notifications once the current response has gone back to the browser. */
export function sendEmailsAfterResponse(businessId: string) {
  after(async () => {
    try {
      await deliverPendingEmails({ businessId, sinceMinutes: 30 });
    } catch (e) {
      console.error("[notifications] email delivery failed", e);
    }
  });
}
