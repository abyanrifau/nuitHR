import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { DayRecordButton, FlagButton } from "./time-office-client";

export const metadata: Metadata = { title: "Time" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  present: { label: "Present", tone: "success" },
  late: { label: "Late", tone: "warning" },
  half_day: { label: "Half day", tone: "warning" },
  early_leave: { label: "Left early", tone: "warning" },
  absent: { label: "Absent", tone: "danger" },
  on_leave: { label: "On leave", tone: "info" },
  holiday: { label: "Holiday", tone: "neutral" },
  rest_day: { label: "Rest day", tone: "neutral" },
};

const shiftDay = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export default async function TimePage(props: PageProps<"/app/time">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "attendance", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see time records. To clock in, use the staff app.
      </Alert>
    );
  }
  const tz = active.timezone;
  const today = localDay(new Date(), tz);
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const supabase = await createClient();
  const [{ data: people }, { data: records }, { data: roster }, { data: leave }, { data: shifts }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave"]).order("first_name").limit(3000),
    supabase
      .from("attendance_records")
      .select("id, employee_id, clock_in_at, clock_out_at, worked_minutes, late_minutes, overtime_minutes, break_minutes, status, is_flagged, flag_reason, shift_id, notes, source, is_half_day")
      .eq("business_id", active.business_id)
      .eq("work_date", day),
    supabase.from("roster_entries").select("employee_id, is_rest_day, shift:shifts(name, start_time, end_time)").eq("business_id", active.business_id).eq("work_date", day),
    supabase.from("leave_requests").select("employee_id, type:leave_types(name)").eq("business_id", active.business_id).eq("status", "approved").lte("start_date", day).gte("end_date", day),
    supabase.from("shifts").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
  ]);
  const recBy = new Map((records ?? []).map((r) => [r.employee_id, r]));
  const rosterBy = new Map((roster ?? []).map((r) => [r.employee_id, r]));
  const leaveBy = new Map((leave ?? []).map((l) => [l.employee_id, (l.type as unknown as { name: string } | null)?.name ?? "Time off"]));
  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "");
  const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

  // Only people who are rostered, on leave, or have a record show by default; "everyone" shows all.
  const rows = (people ?? [])
    .map((p) => ({ p, rec: recBy.get(p.id), ros: rosterBy.get(p.id), off: leaveBy.get(p.id) }))
    .filter((r) => sp.show === "all" || r.rec || r.ros || r.off);
  const inNow = rows.filter((r) => r.rec?.clock_in_at && !r.rec.clock_out_at).length;
  const late = rows.filter((r) => (r.rec?.late_minutes ?? 0) > 0).length;
  const notIn = day === today ? rows.filter((r) => r.ros && !r.ros.is_rest_day && !r.rec && !r.off).length : 0;
  const flagged = rows.filter((r) => r.rec?.is_flagged).length;
  const canEdit = can(ctx, "attendance", "edit");
  const hrefFor = (d: string) => `/app/time?date=${d}${sp.show ? `&show=${sp.show}` : ""}`;

  return (
    <div>
      <PageHeader
        label="run"
        title="Time"
        description="Who's in, who's late and who hasn't arrived. Staff clock in from the staff app; you can add or fix a day here."
        actions={
          <>
            <Link href="/app/time/schedules" className={buttonClasses({ variant: "secondary" })}>
              Work schedules
            </Link>
            {can(ctx, "attendance", "edit") && (
              <Link href="/app/time/import" className={buttonClasses({ variant: "secondary" })}>
                Import from clock machine
              </Link>
            )}
            {can(ctx, "attendance", "edit", "all") && (
              <Link href="/app/time/rules" className={buttonClasses({ variant: "secondary" })}>
                Rules
              </Link>
            )}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={hrefFor(shiftDay(day, -1))} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Previous day">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <p className="min-w-40 text-center font-display">
          {day === today ? "Today, " : ""}
          {formatDate(day, active.date_format)}
        </p>
        <Link href={hrefFor(shiftDay(day, 1))} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Next day">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        {day !== today && (
          <Link href="/app/time" className={buttonClasses({ variant: "link", size: "sm" })}>
            Back to today
          </Link>
        )}
        <span className="ml-auto flex gap-2 text-[13px]">
          <Link href={`/app/time?date=${day}`} className={cn("rounded-full border px-3 py-1", sp.show !== "all" ? "border-foreground" : "border-border text-muted-foreground")}>
            Working today
          </Link>
          <Link href={`/app/time?date=${day}&show=all`} className={cn("rounded-full border px-3 py-1", sp.show === "all" ? "border-foreground" : "border-border text-muted-foreground")}>
            Everyone
          </Link>
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["In now", inNow],
          ["Late", late],
          ["Not in yet", notIn],
          ["Need checking", flagged],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border p-4">
            <p className="font-display text-3xl tabular">{v}</p>
            <p className="text-[13px] text-muted-foreground">{k}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody on for this day"
          description="Put people on the roster, or switch to Everyone to add a day by hand."
          action={
            <Link href="/app/time/roster" className={buttonClasses()}>
              Open the roster
            </Link>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th className="hidden md:table-cell">Shift</Th>
              <Th>In · out</Th>
              <Th className="hidden sm:table-cell">Worked</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, rec, ros, off }) => {
              const s = ros?.shift as unknown as { name: string; start_time: string; end_time: string } | null;
              const st = rec ? STATUS[rec.status] : off ? STATUS.on_leave : ros?.is_rest_day ? STATUS.rest_day : null;
              return (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/app/people/${p.id}`} className="text-foreground hover:underline">
                      {`${p.first_name} ${p.last_name}`.trim()}
                    </Link>
                    {rec?.is_flagged && <span className="block text-[12px] text-warning">{rec.flag_reason ?? "Needs checking"}</span>}
                  </Td>
                  <Td className="hidden text-muted-foreground md:table-cell">{ros?.is_rest_day ? "Rest day" : s ? `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` : ""}</Td>
                  <Td className="tabular">
                    {rec?.clock_in_at ? (
                      <>
                        {time(rec.clock_in_at)} · {rec.clock_out_at ? time(rec.clock_out_at) : <span className="text-success">in</span>}
                      </>
                    ) : (
                      <span className="text-subtle-foreground">{off ?? (ros && !ros.is_rest_day && day === today ? "not in yet" : "")}</span>
                    )}
                  </Td>
                  <Td className="hidden text-muted-foreground tabular sm:table-cell">
                    {rec?.worked_minutes ? hm(rec.worked_minutes) : ""}
                    {rec?.overtime_minutes ? <span className="block text-[12px]">+{hm(rec.overtime_minutes)} OT</span> : null}
                  </Td>
                  <Td>{st && <StatusDot tone={st.tone}>{rec?.status === "late" ? `Late ${rec.late_minutes}m` : st.label}</StatusDot>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {rec?.is_flagged && canEdit && <FlagButton id={rec.id} />}
                    {canEdit && (
                      <DayRecordButton
                        employee={{ id: p.id, name: `${p.first_name} ${p.last_name}`.trim() }}
                        day={day}
                        shifts={(shifts ?? []).map((x) => ({ value: x.id, label: x.name }))}
                        record={
                          rec
                            ? {
                                id: rec.id,
                                clock_in: time(rec.clock_in_at),
                                clock_out: time(rec.clock_out_at),
                                shift_id: rec.shift_id,
                                status: !rec.clock_in_at && ["absent", "on_leave", "holiday", "rest_day"].includes(rec.status) ? rec.status : "auto",
                                notes: rec.notes,
                                is_half_day: rec.is_half_day,
                              }
                            : null
                        }
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <p className="mt-4 text-[13px] text-subtle-foreground">
        Staff who forgot to clock in or out can ask for a fix in the staff app. Those arrive in{" "}
        <Link href="/app/requests" className="underline underline-offset-4">
          Requests
        </Link>
        .
      </p>
    </div>
  );
}
