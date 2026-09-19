import "server-only";
import { appConfig } from "@/config/app.config";
import { emailButton, emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

/** Emails to company owners about their plan: 7 days and 1 day before it ends, and when it's paused. */

const billingLink = () => `${siteUrl()}/app/workspace/billing`;

function message(subject: string, paragraphs: string[]) {
  return {
    subject,
    text: `${paragraphs.join("\n\n")}\n\nBilling and how to pay: ${billingLink()}`,
    html: emailLayout(subject, `${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}${emailButton(billingLink(), "See billing details")}`),
  };
}

export function suspendedEmail(businessName: string) {
  return message(`Your ${appConfig.brand.name} account is paused`, [
    `${businessName} is now read-only. You can still sign in, view and export your data, but changes can't be saved until your plan is renewed.`,
    `To reactivate, pay by bank transfer or mobile payment and send us the receipt, or reply to this email.`,
  ]);
}

export function endingEmail(businessName: string, isTrial: boolean, endsOn: string, daysLeft: 1 | 7) {
  const what = isTrial ? "free trial" : "plan";
  return message(`Your ${appConfig.brand.name} ${what} ends ${daysLeft === 1 ? "tomorrow" : `on ${endsOn}`}`, [
    `The ${what} for ${businessName} ends on ${endsOn}.`,
    `To keep using ${appConfig.brand.name}, pay by bank transfer or mobile payment and send us the receipt. Payment details are in Workspace, Billing. If the ${what} ends without payment, you keep full access for ${appConfig.billing.graceDays} more days, then the account becomes read-only until payment arrives.`,
  ]);
}

interface Due {
  business_id: string;
  business_name: string;
  kind: "ends_7" | "ends_1" | "suspended";
  period_end: string;
  plan_status: string;
  timezone: string;
  owner_emails: string[];
}

/** Run daily by the scheduled job. Each email goes once per company, kind and end date. */
export async function sendBillingReminders(): Promise<number> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("admin_billing_reminders_due");
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const d of (data ?? []) as Due[]) {
    const endsOn = formatDate(d.period_end, "DD/MM/YYYY", d.timezone);
    const msg = d.kind === "suspended" ? suspendedEmail(d.business_name) : endingEmail(d.business_name, d.plan_status === "trial", endsOn, d.kind === "ends_1" ? 1 : 7);
    // Record first, so a failure mid-way never sends the same email twice.
    const { error: recErr } = await db.from("platform_billing_reminders").insert({ business_id: d.business_id, kind: d.kind, period_end: d.period_end });
    if (recErr) continue;
    for (const to of d.owner_emails) {
      const r = await sendEmail({ to, ...msg });
      if (r.ok) sent++;
    }
  }
  return sent;
}
