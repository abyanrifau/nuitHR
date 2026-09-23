import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { TabNav } from "@/components/ui/tab-nav";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { today } from "@/lib/format";
import { monthRange } from "@/lib/time/day-status";
import { REPORTS, buildReport, type ReportKind } from "@/lib/time/reports";
import { can } from "@/modules/access";

export const metadata: Metadata = { title: "Attendance reports" };

/** Lateness, absences, overtime and hours for a month, to read here or download for Excel or as a PDF. */
export default async function ReportsPage(props: PageProps<"/app/time/reports">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "attendance", "view", "team")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need attendance reports.</Alert>;
  }
  const range = monthRange(sp.month, today(active.timezone));
  const kind = (REPORTS.find((r) => r.key === sp.report)?.key ?? "late") as ReportKind;
  const report = await buildReport(active, range, kind);
  const q = (extra: Record<string, string>) => `?${new URLSearchParams({ month: range.month, report: kind, ...extra })}`;

  return (
    <div>
      <PageHeader
        back={{ href: "/app/time", label: "Time" }}
        title="Attendance reports"
        description={REPORTS.find((r) => r.key === kind)!.description}
        actions={
          <>
            <a href={`/app/time/reports/export${q({ format: "xlsx" })}`} className={buttonClasses({ variant: "secondary" })}>
              <Download className="size-4" aria-hidden /> Excel
            </a>
            <a href={`/app/time/reports/export${q({ format: "pdf" })}`} className={buttonClasses({ variant: "secondary" })}>
              <Download className="size-4" aria-hidden /> PDF
            </a>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/app/time/reports${q({ month: range.prev })}`} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Previous month">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <p className="min-w-40 text-center font-display">{range.label}</p>
        <Link href={`/app/time/reports${q({ month: range.next })}`} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Next month">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      <TabNav label="Reports" current={kind} tabs={REPORTS.map((r) => ({ key: r.key, label: r.label, href: `/app/time/reports?month=${range.month}&report=${r.key}` }))} />
      {report.rows.length ? (
        <Table>
          <thead>
            <tr>
              {report.columns.map((c, i) => (
                <Th key={c.label} className={[c.numeric ? "text-right" : "", i === 0 || i === 2 ? "hidden md:table-cell" : ""].join(" ")}>
                  {c.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, ri) => (
              <Tr key={ri}>
                {r.map((v, i) => (
                  <Td key={i} className={[report.columns[i].numeric ? "text-right tabular" : "", i === 0 || i === 2 ? "hidden md:table-cell" : "", i === 1 ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                    {typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : v}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="Nothing to report" description="No one matches this report for the month." />
      )}
      <p className="mt-3 text-[12px] text-subtle-foreground">Hours are shown as decimals, as payroll uses them: 7.50 is 7 hours 30 minutes.</p>
    </div>
  );
}
