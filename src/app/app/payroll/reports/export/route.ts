import { NextResponse } from "next/server";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { formatDateTime, localDay } from "@/lib/format";
import { PAY_REPORTS, buildPayReport, type PayReportKind } from "@/lib/payroll/reports";
import { payReportRange } from "@/lib/payroll/report-range";
import { reportPdf } from "@/lib/time/report-pdf";
import { makeXlsx } from "@/lib/xlsx";
import { can } from "@/modules/access";

/** A payroll report as an Excel or PDF file. */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return new NextResponse("Sign in first.", { status: 401 });
  const active = await getActiveBusiness();
  if (!active || !can(toAccessContext(active), "payroll", "view", "all")) return new NextResponse("You don't have permission to see payroll.", { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("report") as PayReportKind;
  const def = PAY_REPORTS.find((r) => r.key === kind);
  if (!def) return new NextResponse("Choose a report.", { status: 400 });
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const range = payReportRange(Boolean(def.yearly), url.searchParams.get("month") ?? undefined, url.searchParams.get("year") ?? undefined, localDay(new Date(), active.timezone));
  const report = await buildPayReport(active, kind, range);
  const file = `payroll-${kind}-${range.key}`;
  if (format === "pdf") {
    const pdf = await reportPdf(report, active.business_name, formatDateTime(new Date().toISOString(), active.date_format, active.timezone));
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${file}.pdf"`, "cache-control": "private, no-store" },
    });
  }
  const rows = report.note ? [...report.rows, [], [report.note]] : report.rows;
  const xlsx = await makeXlsx(def.label, report.columns.map((c) => c.label), rows as (string | number)[][]);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${file}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
