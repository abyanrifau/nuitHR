import { NextResponse, type NextRequest } from "next/server";
import { deliverPendingEmails } from "@/lib/notifications/deliver";

/**
 * Backstop for notification emails: Vercel calls this once a day (see
 * vercel.json) and it sends anything that wasn't emailed straight away.
 * Protected by CRON_SECRET, which Vercel sends automatically.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const result = await deliverPendingEmails({ sinceMinutes: 60 * 26 });
  return NextResponse.json(result);
}
