import { NextResponse, type NextRequest } from "next/server";
import { deliverPendingEmails } from "@/lib/notifications/deliver";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBillingReminders } from "@/lib/platform/billing-emails";
import { syncPlatformAdmins } from "@/lib/platform/guard";

/**
 * Backstop for notification emails: Vercel calls this once a day (see
 * vercel.json) and it sends anything that wasn't emailed straight away.
 * It also sends permit, passport and course-due reminders first, so they go out
 * in the same run, plus plan reminders to company owners (7 days and 1 day
 * before their trial or paid period ends, and when an account is paused).
 * Protected by CRON_SECRET, which Vercel sends automatically.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const { data: reminders, error } = await createAdminClient().rpc("send_compliance_reminders");
  if (error) console.error("compliance reminders failed", error.message);
  const { data: courses, error: learnErr } = await createAdminClient().rpc("send_learning_reminders");
  if (learnErr) console.error("course reminders failed", learnErr.message);
  let billing = 0;
  try {
    billing = await sendBillingReminders();
  } catch (e) {
    console.error("billing reminders failed", e instanceof Error ? e.message : e);
  }
  // Keeps support access in line with the PLATFORM_ADMIN_EMAILS setting.
  await syncPlatformAdmins();
  const result = await deliverPendingEmails({ sinceMinutes: 60 * 26 });
  return NextResponse.json({ ...result, reminders: reminders ?? 0, courseReminders: courses ?? 0, billingReminders: billing });
}
