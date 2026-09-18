import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { RosterGrid, RosterWeekActions } from "./roster-client";

export const metadata: Metadata = { title: "Roster" };

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** The first day of the week containing `day`, given the company's week start (0 = Sunday). */
function weekStartOf(day: string, weekStart: number) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow - weekStart + 7) % 7));
}

export default async function RosterPage(props: PageProps<"/app/time/roster">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "roster", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see the roster. Your own shifts are in the staff app.
      </Alert>
    );
  }
  const supabase = await createClient();
  const { data: b } = await supabase.from("businesses").select("week_start, working_days").eq("id", active.business_id).single();
  const today = localDay(new Date(), active.timezone);
  const start = weekStartOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today, b?.week_start ?? 0);
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  let peopleQ = supabase
    .from("employees")
    .select("id, first_name, last_name, department_id")
    .eq("business_id", active.business_id)
    .in("status", ["active", "probation", "on_leave"])
    .order("first_name")
    .limit(500);
  if (sp.department) peopleQ = peopleQ.eq("department_id", sp.department);
  const [{ data: people }, { data: entries }, { data: shifts }, { data: departments }, { data: leave }, { data: holidays }] = await Promise.all([
    peopleQ,
    supabase.from("roster_entries").select("employee_id, work_date, shift_id, is_rest_day, published").eq("business_id", active.business_id).gte("work_date", start).lte("work_date", end),
    supabase.from("shifts").select("id, name, code, color, start_time, end_time").eq("business_id", active.business_id).eq("is_active", true).order("start_time"),
    supabase.from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
    supabase.from("leave_requests").select("employee_id, start_date, end_date").eq("business_id", active.business_id).eq("status", "approved").lte("start_date", end).gte("end_date", start),
    supabase.from("public_holidays").select("holiday_date, name").eq("business_id", active.business_id).gte("holiday_date", start).lte("holiday_date", end),
  ]);
  const canEdit = can(ctx, "roster", "edit", "team") || can(ctx, "roster", "create", "team");
  const unpublished = (entries ?? []).filter((e) => !e.published).length;
  const href = (week: string) => `/app/time/roster?week=${week}${sp.department ? `&department=${sp.department}` : ""}`;

  return (
    <div>
      <PageHeader
        back={{ href: "/app/time", label: "Time" }}
        title="Roster"
        description="Pick a shift for each person and day. Staff see a week in their app once you publish it."
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={href(addDays(start, -7))} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Previous week">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <p className="min-w-52 text-center font-display">
          {formatDate(start, active.date_format)} to {formatDate(end, active.date_format)}
        </p>
        <Link href={href(addDays(start, 7))} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Next week">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        {departments && departments.length > 0 && (
          <span className="flex flex-wrap gap-2 text-[13px]">
            <Link href={`/app/time/roster?week=${start}`} className={`rounded-full border px-3 py-1 ${!sp.department ? "border-foreground" : "border-border text-muted-foreground"}`}>
              Everyone
            </Link>
            {departments.map((d) => (
              <Link
                key={d.id}
                href={`/app/time/roster?week=${start}&department=${d.id}`}
                className={`rounded-full border px-3 py-1 ${sp.department === d.id ? "border-foreground" : "border-border text-muted-foreground"}`}
              >
                {d.name}
              </Link>
            ))}
          </span>
        )}
        {canEdit && <RosterWeekActions weekStart={start} unpublished={unpublished} />}
      </div>

      {!shifts?.length ? (
        <EmptyState
          title="No shifts yet"
          description="Add your usual shifts first, for example Morning 07:00 to 15:00."
          action={
            <Link href="/app/workspace/tools/attendance" className={buttonClasses()}>
              Add shifts
            </Link>
          }
        />
      ) : !people?.length ? (
        <EmptyState title="Nobody to roster" description="Add people first." />
      ) : (
        <RosterGrid
          key={`${start}-${sp.department ?? ""}`}
          canEdit={canEdit}
          days={days.map((d) => ({
            date: d,
            label: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)),
            today: d === today,
            workday: ((b?.working_days as number[]) ?? [0, 1, 2, 3, 4]).includes(new Date(`${d}T00:00:00Z`).getUTCDay()),
            holiday: holidays?.find((h) => h.holiday_date === d)?.name ?? null,
          }))}
          people={people.map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim() }))}
          shifts={shifts.map((s) => ({ id: s.id, label: s.code || s.name, name: s.name, color: s.color, time: `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` }))}
          entries={(entries ?? []).map((e) => ({ employee_id: e.employee_id, work_date: e.work_date, value: e.is_rest_day ? "rest" : (e.shift_id ?? ""), published: e.published }))}
          leave={(leave ?? []).map((l) => ({ employee_id: l.employee_id, start: l.start_date, end: l.end_date }))}
        />
      )}
    </div>
  );
}
