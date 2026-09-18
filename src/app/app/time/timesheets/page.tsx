import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { TimesheetTable, PeriodPicker } from "./timesheets-client";

export const metadata: Metadata = { title: "Timesheets" };

/** Default period: the current calendar month so far. */
function defaultPeriod(today: string) {
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

export default async function TimesheetsPage(props: PageProps<"/app/time/timesheets">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "attendance", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see timesheets.
      </Alert>
    );
  }
  const today = localDay(new Date(), active.timezone);
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  const period = valid(sp.start) && valid(sp.end) ? { start: sp.start!, end: sp.end! } : defaultPeriod(today);
  const supabase = await createClient();
  const { data } = await supabase
    .from("timesheets")
    .select("id, status, days_present, days_absent, worked_minutes, overtime_minutes, late_minutes, approved_at, employee:employees(id, first_name, last_name, employee_code)")
    .eq("business_id", active.business_id)
    .eq("period_start", period.start)
    .eq("period_end", period.end)
    .order("created_at");

  return (
    <div>
      <PageHeader
        back={{ href: "/app/time", label: "Time" }}
        title="Timesheets"
        description="Add up everyone's days, hours, lateness and overtime for a period, check them, and approve. Approved timesheets are what payroll uses."
      />
      <PeriodPicker start={period.start} end={period.end} canBuild={can(ctx, "attendance", "edit")} />
      <p className="mb-4 text-sm text-muted-foreground">
        {formatDate(period.start, active.date_format)} to {formatDate(period.end, active.date_format)}
      </p>
      <TimesheetTable
        canApprove={can(ctx, "attendance", "edit")}
        period={period}
        rows={(data ?? []).map((t) => {
          const e = t.employee as unknown as { id: string; first_name: string; last_name: string; employee_code: string };
          return {
            id: t.id,
            employeeId: e.id,
            name: `${e.first_name} ${e.last_name}`.trim(),
            code: e.employee_code,
            status: t.status,
            present: Number(t.days_present),
            absent: Number(t.days_absent),
            worked: t.worked_minutes,
            overtime: t.overtime_minutes,
            late: t.late_minutes,
          };
        })}
      />
    </div>
  );
}
