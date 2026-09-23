import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, today } from "@/lib/format";
import { loadAttendanceMonth } from "@/lib/time/attendance-data";
import { OT_TYPE_LABEL, hm, monthRange } from "@/lib/time/day-status";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { OvertimeTable, type OvertimeRow } from "./overtime-client";

export const metadata: Metadata = { title: "Overtime" };

/** Each day's overtime in a month, by kind of day, with approval when the rules ask for it. */
export default async function OvertimePage(props: PageProps<"/app/time/overtime">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "attendance", "view", "team")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to see overtime.</Alert>;
  }
  const range = monthRange(sp.month, today(active.timezone));
  const supabase = await createClient();
  const [{ people, days, summaries }, { data: policy }] = await Promise.all([
    loadAttendanceMonth(active, range),
    supabase.from("attendance_policies").select("overtime_requires_approval, overtime_monthly_cap_hours, overtime_rate_weekday, overtime_rate_rest_day, overtime_rate_holiday").eq("business_id", active.business_id).eq("is_default", true).maybeSingle(),
  ]);
  const needsApproval = Boolean(policy?.overtime_requires_approval);
  const show = sp.show === "all" || !needsApproval ? "all" : "waiting";
  const nameOf = new Map(people.map((p) => [p.id, p]));
  const rows: OvertimeRow[] = [...days.values()]
    .flat()
    .filter((d) => d.overtime_minutes > 0 && (show === "all" || d.overtime_state === "pending"))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => ({
      id: d.record_id!,
      person: nameOf.get(d.employee_id)?.name ?? "",
      photo: nameOf.get(d.employee_id)?.photo_path ?? null,
      employeeId: d.employee_id,
      day: formatDate(d.day, active.date_format),
      type: OT_TYPE_LABEL[d.overtime_type ?? "normal"],
      minutes: d.overtime_minutes,
      state: d.overtime_state ?? "approved",
    }));
  const totals = [...summaries.values()].reduce(
    (t, m) => ({
      normal: t.normal + m.overtime_normal_minutes,
      rest: t.rest + m.overtime_rest_day_minutes,
      holiday: t.holiday + m.overtime_holiday_minutes,
      pending: t.pending + m.overtime_pending_minutes,
      over: t.over + m.overtime_over_cap_minutes,
    }),
    { normal: 0, rest: 0, holiday: 0, pending: 0, over: 0 },
  );
  const q = (extra: Record<string, string | undefined>) => `/app/time/overtime?${new URLSearchParams(Object.entries({ month: range.month, show: sp.show, ...extra }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div>
      <PageHeader
        back={{ href: "/app/time", label: "Time" }}
        title="Overtime"
        description={
          needsApproval
            ? "Overtime waits here until a manager approves it. Only approved overtime, up to the monthly limit, is counted and paid."
            : "Overtime is counted as soon as it's worked. You can ask for approval first in the attendance rules."
        }
        actions={
          can(ctx, "attendance", "edit", "all") ? (
            <Link href="/app/time/rules" className={buttonClasses({ variant: "secondary" })}>
              Overtime rules
            </Link>
          ) : undefined
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={q({ month: range.prev })} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Previous month">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <p className="min-w-40 text-center font-display">{range.label}</p>
        <Link href={q({ month: range.next })} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Next month">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [`Normal days (x${Number(policy?.overtime_rate_weekday ?? 1.25)})`, totals.normal],
          [`Rest days (x${Number(policy?.overtime_rate_rest_day ?? 1.5)})`, totals.rest],
          [`Public holidays (x${Number(policy?.overtime_rate_holiday ?? 1.5)})`, totals.holiday],
          [needsApproval ? "Waiting for approval" : "Over the monthly limit", needsApproval ? totals.pending : totals.over],
        ].map(([label, mins]) => (
          <div key={label as string} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[13px] text-muted-foreground">{label}</p>
            <p className="font-display mt-2 text-2xl tabular">{hm(mins as number)}</p>
          </div>
        ))}
      </div>
      {needsApproval && (
        <nav className="mb-4 flex gap-2 text-[13px]" aria-label="Show">
          {[
            ["waiting", "Waiting"],
            ["all", "All overtime"],
          ].map(([k, label]) => (
            <Link key={k} href={q({ show: k === "all" ? "all" : undefined })} className={cn("rounded-full border px-3 py-1", show === k ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
              {label}
            </Link>
          ))}
        </nav>
      )}
      {rows.length ? (
        <OvertimeTable rows={rows} canDecide={needsApproval && can(ctx, "attendance", "approve", "team")} />
      ) : (
        <EmptyState title={show === "waiting" ? "Nothing waiting" : "No overtime this month"} description="Days with overtime show here once people clock out." />
      )}
    </div>
  );
}
