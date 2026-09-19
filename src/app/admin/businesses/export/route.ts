import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { listBusinesses, logAdminAction, PLAN_LABEL } from "@/lib/platform/data";
import { filterBusinesses } from "@/lib/platform/filter";
import { getAdminGate } from "@/lib/platform/guard";

/** The companies list as a spreadsheet, with the same filters as the page. Platform admins only. */
export async function GET(req: Request) {
  const gate = await getAdminGate();
  if (gate.kind !== "admin") return new NextResponse("Not found", { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = filterBusinesses(await listBusinesses(), sp);
  await logAdminAction(gate.admin, { action: "export.businesses", after: { rows: rows.length, filters: sp } });
  const csv = toCsv([
    ["Company", "Owner", "Owner email", "Owner phone", "Industry", "Staff", "Tools", "Status", "Trial ends", "Paid until", "Monthly price (MVR)", "Signed up", "Last active"],
    ...rows.map((b) => [
      b.name,
      b.owner?.name ?? "",
      b.owner?.email ?? "",
      b.owner?.phone ?? "",
      b.industry,
      b.staff_count,
      b.modules.join(" "),
      PLAN_LABEL[b.status],
      b.trial_ends_at?.slice(0, 10) ?? "",
      b.paid_until?.slice(0, 10) ?? "",
      b.monthly_price.toFixed(2),
      b.created_at.slice(0, 10),
      b.last_active?.slice(0, 10) ?? "",
    ]),
  ]);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="harbor-companies-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
