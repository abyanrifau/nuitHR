import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { StatusDot } from "@/components/ui/table";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate, localDay } from "@/lib/format";
import { ClockPanel, TimeFixForm } from "./time-client";

export const metadata: Metadata = { title: "Time" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  present: { label: "Present", tone: "success" },
  late: { label: "Late", tone: "warning" },
  half_day: { label: "Half day", tone: "warning" },
  absent: { label: "Absent", tone: "danger" },
  on_leave: { label: "On leave", tone: "info" },
  holiday: { label: "Holiday", tone: "neutral" },
  rest_day: { label: "Rest day", tone: "neutral" },
};

function hm(mins: number) {
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

function timeOf(iso: string | null, timeZone: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export default async function StaffTime() {
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const tz = active.timezone;
  const today = localDay(new Date(), tz);
  const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  const weekAhead = addDays(today, 7);
  const twoWeeksAgo = addDays(today, -14);

  const [{ data: open }, { data: recent }, { data: roster }, { data: policies }, { data: fixes }, { data: emp }] = await Promise.all([
    supabase
      .from("attendance_records")
      .select("id, work_date, clock_in_at, clock_out_at, breaks:attendance_breaks(started_at, ended_at)")
      .eq("employee_id", me.id)
      .not("clock_in_at", "is", null)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: false })
      .limit(1),
    supabase
      .from("attendance_records")
      .select("id, work_date, clock_in_at, clock_out_at, worked_minutes, late_minutes, overtime_minutes, status, is_flagged")
      .eq("employee_id", me.id)
      .gte("work_date", twoWeeksAgo)
      .order("work_date", { ascending: false }),
    supabase
      .from("roster_entries")
      .select("work_date, is_rest_day, shift:shifts(name, start_time, end_time)")
      .eq("employee_id", me.id)
      .eq("published", true)
      .gte("work_date", today)
      .lte("work_date", weekAhead)
      .order("work_date"),
    supabase.from("attendance_policies").select("require_gps, require_selfie, allow_breaks, is_default, id").eq("business_id", active.business_id),
    supabase.from("attendance_corrections").select("id, work_date, status").eq("employee_id", me.id).eq("status", "pending"),
    supabase.from("employees").select("attendance_policy_id").eq("id", me.id).maybeSingle(),
  ]);
  const policy = policies?.find((p) => p.id === emp?.attendance_policy_id) ?? policies?.find((p) => p.is_default);
  const current = open?.[0];
  const onBreak = Boolean(current && (current.breaks as { ended_at: string | null }[]).some((b) => !b.ended_at));
  const todayRecord = recent?.find((r) => r.work_date === today);
  const todayShift = roster?.find((r) => r.work_date === today);
  const shift = todayShift?.shift as unknown as { name: string; start_time: string; end_time: string } | null;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl">Time</h1>

      <ClockPanel
        businessId={active.business_id}
        employeeId={me.id}
        state={current ? (onBreak ? "break" : "in") : todayRecord?.clock_out_at ? "done" : "out"}
        since={current?.clock_in_at ?? null}
        sinceText={timeOf(current?.clock_in_at ?? null, tz)}
        shiftText={todayShift ? (todayShift.is_rest_day ? "Rest day" : shift ? `${shift.name} · ${shift.start_time.slice(0, 5)} to ${shift.end_time.slice(0, 5)}` : "") : ""}
        needsLocation={Boolean(policy?.require_gps)}
        needsSelfie={Boolean(policy?.require_selfie)}
        allowBreaks={policy?.allow_breaks ?? true}
        doneText={todayRecord?.clock_out_at ? `${timeOf(todayRecord.clock_in_at, tz)} to ${timeOf(todayRecord.clock_out_at, tz)} · ${hm(todayRecord.worked_minutes)}` : ""}
      />

      {roster && roster.length > 0 && (
        <section aria-labelledby="week">
          <h2 id="week" className="section-label mb-3">
            your shifts
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {roster.map((r) => {
              const s = r.shift as unknown as { name: string; start_time: string; end_time: string } | null;
              return (
                <li key={r.work_date} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="text-foreground">
                    {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${r.work_date}T00:00:00Z`))}
                    {r.work_date === today && <span className="ml-2 text-[12px] text-subtle-foreground">today</span>}
                  </span>
                  <span className="text-muted-foreground tabular">{r.is_rest_day ? "Rest day" : s ? `${s.start_time.slice(0, 5)} to ${s.end_time.slice(0, 5)}` : ""}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="recent">
        <h2 id="recent" className="section-label mb-3">
          last two weeks
        </h2>
        {recent?.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {recent.map((r) => {
              const s = STATUS[r.status] ?? STATUS.present;
              return (
                <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm text-foreground">{formatDate(r.work_date, active.date_format)}</p>
                    <p className="text-[13px] text-subtle-foreground tabular">
                      {r.clock_in_at ? `${timeOf(r.clock_in_at, tz)} to ${timeOf(r.clock_out_at, tz) || "…"}` : ""}
                      {r.worked_minutes > 0 && ` · ${hm(r.worked_minutes)}`}
                      {r.overtime_minutes > 0 && ` · ${r.overtime_minutes} min overtime`}
                    </p>
                  </div>
                  <StatusDot tone={s.tone}>{r.status === "late" ? `Late ${r.late_minutes} min` : s.label}</StatusDot>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">Nothing yet. Your days show here after you clock in.</p>
        )}
      </section>

      <section aria-labelledby="fix-h" id="fix">
        <h2 id="fix-h" className="section-label mb-1">
          forgot to clock in or out?
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">Ask your manager to fix the time. Once they approve it, your day updates.</p>
        {fixes && fixes.length > 0 && (
          <p className="mb-3 text-[13px] text-subtle-foreground">Waiting for an answer: {fixes.map((f) => formatDate(f.work_date, active.date_format)).join(", ")}</p>
        )}
        <TimeFixForm today={today} />
      </section>
    </div>
  );
}
