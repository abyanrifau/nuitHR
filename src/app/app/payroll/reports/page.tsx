import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { formatMoney, localDay } from "@/lib/format";
import { PAY_REPORTS, buildPayReport, type PayReportKind } from "@/lib/payroll/reports";
import { payReportRange } from "@/lib/payroll/report-range";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Payroll reports" };

/** Payroll reports from finalized and paid runs, for a month or the year so far, to download for Excel or as PDF. */
export default async function PayrollReportsPage(props: PageProps<"/app/payroll/reports">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "payroll", "view", "all")) {
    return <Alert tone="warning" title="No access">Payroll reports are only shown to the owner and payroll.</Alert>;
  }
  const kind = (PAY_REPORTS.some((r) => r.key === sp.report) ? sp.report : "department") as PayReportKind;
  const def = PAY_REPORTS.find((r) => r.key === kind)!;
  const today = localDay(new Date(), active.timezone);
  const range = payReportRange(Boolean(def.yearly), sp.month, sp.year, today);
  const report = await buildPayReport(active, kind, range);
  const exportQ = new URLSearchParams({ report: kind, ...(def.yearly ? { year: range.key } : { month: range.key }) });

  return (
    <div>
      <PageHeader
        back={{ href: "/app/payroll", label: "Payroll" }}
        title="Payroll reports"
        description="From finalized and paid pay runs, by the month people were paid. Download them for Excel or as PDF."
        actions={
          <>
            <a href={`/app/payroll/reports/export?${exportQ}&format=xlsx`} className={buttonClasses({ variant: "secondary" })}>
              <Download className="size-4" aria-hidden /> Excel
            </a>
            <a href={`/app/payroll/reports/export?${exportQ}&format=pdf`} className={buttonClasses({ variant: "secondary" })}>
              <Download className="size-4" aria-hidden /> PDF
            </a>
          </>
        }
      />
      <nav aria-label="Reports" className="mb-5 flex flex-wrap gap-2 text-[13px]">
        {PAY_REPORTS.map((r) => (
          <Link
            key={r.key}
            href={`?report=${r.key}${r.yearly ? "" : `&month=${def.yearly ? today.slice(0, 7) : range.key}`}`}
            className={cn("rounded-full border px-3 py-1", r.key === kind ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {r.label}
          </Link>
        ))}
      </nav>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="report" value={kind} />
        {def.yearly ? (
          <label className="text-[13px] text-muted-foreground">
            Year
            <Input name="year" type="number" min={2000} max={2100} defaultValue={range.key} className="mt-1.5 w-28" />
          </label>
        ) : (
          <label className="text-[13px] text-muted-foreground">
            Paid in
            <Input name="month" type="month" defaultValue={range.key} className="mt-1.5" />
          </label>
        )}
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <p className="mb-1 text-sm text-muted-foreground">{def.description}</p>
      <p className="mb-4 text-[12px] text-subtle-foreground">
        {report.title} · from {report.runs} {report.runs === 1 ? "pay run" : "pay runs"}
      </p>
      {report.note && (
        <Alert tone="warning" className="mb-4">
          {report.note}
        </Alert>
      )}
      {report.rows.length ? (
        <Table>
          <thead>
            <tr>
              {report.columns.map((c) => (
                <Th key={c.label} className={c.numeric ? "text-right" : undefined}>
                  {c.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => {
              const total = i === report.rows.length - 1 && r.includes("Total");
              return (
                <Tr key={i}>
                  {r.map((v, j) => (
                    <Td key={j} className={cn(report.columns[j].numeric && "text-right tabular", total && "font-medium text-foreground")}>
                      {typeof v === "number" && report.columns[j].numeric && !["People", "Pay runs"].includes(report.columns[j].label) ? formatMoney(v, active.currency) : v}
                    </Td>
                  ))}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="Nothing yet" description="There are no finalized pay runs paid in this period." />
      )}
    </div>
  );
}
