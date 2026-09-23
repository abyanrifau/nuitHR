import { NextResponse } from "next/server";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { formatDateTime, today } from "@/lib/format";
import { monthRange } from "@/lib/time/day-status";
import { reportPdf } from "@/lib/time/report-pdf";
import { REPORTS, buildReport, type ReportKind } from "@/lib/time/reports";
import { makeXlsx } from "@/lib/xlsx";
import { can } from "@/modules/access";

/** An attendance report as an Excel or PDF file. Only people the viewer may see are in it. */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return new NextResponse("Sign in first.", { status: 401 });
  const active = await getActiveBusiness();
  if (!active || !can(toAccessContext(active), "attendance", "view", "team")) return new NextResponse("You don't have permission to see attendance.", { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("report") as ReportKind;
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  if (!REPORTS.some((r) => r.key === kind)) return new NextResponse("Choose a report.", { status: 400 });
  const range = monthRange(url.searchParams.get("month") ?? undefined, today(active.timezone));
  const report = await buildReport(active, range, kind, {
    branch: url.searchParams.get("branch") ?? undefined,
    department: url.searchParams.get("department") ?? undefined,
  });
  const file = `${kind}-${range.month}`;
  if (format === "pdf") {
    const pdf = await reportPdf(report, active.business_name, formatDateTime(new Date().toISOString(), active.date_format, active.timezone));
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${file}.pdf"`, "cache-control": "private, no-store" },
    });
  }
  const xlsx = await makeXlsx(REPORTS.find((r) => r.key === kind)!.label, report.columns.map((c) => c.label), report.rows);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${file}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
