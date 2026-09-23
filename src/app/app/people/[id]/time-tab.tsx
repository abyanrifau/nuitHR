import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/table";
import type { BusinessAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { loadAttendanceMonth } from "@/lib/time/attendance-data";
import { DAY_STATUS, OT_TYPE_LABEL, STATUS_ORDER, hm, monthRange, type AttendanceDay } from "@/lib/time/day-status";
import { cn } from "@/lib/utils";

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FIX = { pending: { label: "Waiting", tone: "warning" }, approved: { label: "Approved", tone: "success" }, rejected: { label: "Declined", tone: "danger" }, cancelled: { label: "Cancelled", tone: "neutral" } } as const;

function Figure({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-2xl tabular">{value}</p>
      {note && <p className="text-[12px] text-subtle-foreground">{note}</p>}
    </div>
  );
}

/** One person's month: a calendar with each day's status, the month's numbers, overtime, and fixes to their times. */
export async function TimeTab({ id, active, day, month }: { id: string; active: BusinessAccess; day: string; month?: string }) {
  const range = monthRange(month, day);
  const supabase = await createClient();
  const [{ days, summaries }, { data: fixes }, { data: edits }] = await Promise.all([
    loadAttendanceMonth(active, range, { employeeId: id }),
    supabase
      .from("attendance_corrections")
      .select("id, work_date, requested_clock_in, requested_clock_out, reason, status, decision_comment, created_at")
      .eq("employee_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("audit_log")
      .select("id, action, changes, created_at, actor_id, entity_id")
      .eq("subject_employee_id", id)
      .eq("entity_type", "attendance_records")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const list = days.get(id) ?? [];
  const byDay = new Map(list.map((d) => [d.day, d]));
  const m = summaries.get(id);
  const t = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: active.timezone }).format(new Date(iso)) : "–");
  const actorIds = [...new Set((edits ?? []).map((e) => e.actor_id).filter(Boolean))] as string[];
  const recordIds = [...new Set((edits ?? []).map((e) => e.entity_id).filter(Boolean))] as string[];
  const [{ data: actors }, { data: recs }] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id, full_name").in("id", actorIds) : Promise.resolve({ data: [] }),
    recordIds.length ? supabase.from("attendance_records").select("id, work_date").in("id", recordIds) : Promise.resolve({ data: [] }),
  ]);
  const recordDate = new Map(((recs ?? []) as { id: string; work_date: string }[]).map((r) => [r.id, r.work_date]));
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

  // The calendar: blank cells before the 1st, so days line up under their weekday.
  const first = new Date(`${range.start}T00:00:00Z`).getUTCDay();
  const total = Number(range.end.slice(8));
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => `${range.month}-${String(i + 1).padStart(2, "0")}`)];
  const tip = (d: AttendanceDay) =>
    [
      d.status ? DAY_STATUS[d.status].label : "Not yet",
      d.clock_in_at ? `${t(d.clock_in_at)} to ${t(d.clock_out_at)}` : null,
      d.worked_minutes ? `${hm(d.worked_minutes)} worked` : null,
      d.late_minutes ? `${d.late_minutes} min late` : null,
      d.overtime_minutes ? `${hm(d.overtime_minutes)} overtime` : null,
      d.leave_name,
    ]
      .filter(Boolean)
      .join(" · ");
  const ot = m ? m.overtime_normal_minutes + m.overtime_rest_day_minutes + m.overtime_holiday_minutes : 0;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/app/people/${id}?tab=time&month=${range.prev}`} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Previous month">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <p className="min-w-40 text-center font-display">{range.label}</p>
        <Link href={`/app/people/${id}?tab=time&month=${range.next}`} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Next month">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        {m?.locked_at && (
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Lock className="size-3.5" aria-hidden /> Locked by finalized payroll
          </span>
        )}
      </div>

      <section aria-label="Calendar">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-subtle-foreground">
          {WEEK.map((w) => (
            <span key={w} className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((c, i) => {
            if (!c) return <span key={`blank-${i}`} aria-hidden />;
            const d = byDay.get(c);
            const s = d?.status ? DAY_STATUS[d.status] : null;
            return (
              <div
                key={c}
                title={d ? tip(d) : "Not employed"}
                className={cn("flex min-h-16 flex-col rounded-lg border p-1.5 text-left sm:min-h-20", s ? "border-transparent" : "border-border")}
                style={s ? { background: `${s.color}22`, borderColor: `${s.color}66` } : undefined}
              >
                <span className="flex items-center justify-between text-[11px] text-muted-foreground tabular">
                  {Number(c.slice(8))}
                  {s && (
                    <span className="rounded px-1 text-[10px] font-medium" style={{ background: s.color, color: s.text }}>
                      {s.code}
                    </span>
                  )}
                </span>
                {d?.clock_in_at && <span className="mt-auto hidden text-[10px] text-muted-foreground tabular sm:block">{t(d.clock_in_at)}–{t(d.clock_out_at)}</span>}
                {d && d.overtime_minutes > 0 && <span className="text-[10px] text-foreground tabular">+{hm(d.overtime_minutes)}</span>}
                {d?.missing_clock_out && <span className="text-[10px] text-danger">No clock-out</span>}
              </div>
            );
          })}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          {STATUS_ORDER.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="rounded px-1 text-[10px] font-medium" style={{ background: DAY_STATUS[s].color, color: DAY_STATUS[s].text }}>
                {DAY_STATUS[s].code}
              </span>
              {DAY_STATUS[s].label}
            </li>
          ))}
        </ul>
      </section>

      {m && (
        <section>
          <h2 className="mb-3 text-lg">The month in numbers</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Working days" value={m.working_days} note={`of ${m.days_in_month} days in the month`} />
            <Figure label="Days present" value={m.days_present} note={m.half_days ? `plus ${m.half_days} half ${m.half_days === 1 ? "day" : "days"}` : undefined} />
            <Figure label="Unapproved absences" value={m.unapproved_absences} note={m.longest_absence_run ? `longest run ${m.longest_absence_run} ${m.longest_absence_run === 1 ? "day" : "days"}` : undefined} />
            <Figure label="Approved absences" value={m.approved_absences} note="days on approved time off" />
            <Figure label="Late" value={m.late_count} note={m.late_minutes ? `${m.late_minutes} minutes in all` : undefined} />
            <Figure label="Left early" value={m.early_leaves} />
            <Figure label="Hours worked" value={hm(m.worked_minutes)} />
            <Figure label="Overtime counted" value={hm(ot)} note={m.overtime_pending_minutes ? `${hm(m.overtime_pending_minutes)} waiting for approval` : undefined} />
          </div>
        </section>
      )}

      {m && (ot > 0 || m.overtime_pending_minutes > 0 || m.overtime_over_cap_minutes > 0) && (
        <section>
          <h2 className="mb-3 text-lg">Overtime</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              [OT_TYPE_LABEL.normal, m.overtime_normal_minutes],
              [OT_TYPE_LABEL.rest_day, m.overtime_rest_day_minutes],
              [OT_TYPE_LABEL.holiday, m.overtime_holiday_minutes],
              ["Waiting for approval", m.overtime_pending_minutes],
              ["Over the monthly limit (not counted)", m.overtime_over_cap_minutes],
            ].map(([label, mins]) => (
              <div key={label as string} className="flex justify-between border-b border-border py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular">{hm(mins as number)}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-4 space-y-1 text-[13px] text-muted-foreground">
            {list
              .filter((d) => d.overtime_minutes > 0)
              .map((d) => (
                <li key={d.day}>
                  {formatDate(d.day, active.date_format)}: {hm(d.overtime_minutes)} on a {OT_TYPE_LABEL[d.overtime_type ?? "normal"].toLowerCase()} ·{" "}
                  {d.overtime_state === "approved" ? "counted" : d.overtime_state === "pending" ? "waiting" : "rejected"}
                </li>
              ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg">Fixes to their times</h2>
        {(fixes?.length ?? 0) + (edits?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No fixes yet. Requests from the staff app and changes made in the office show here.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {(fixes ?? []).map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <span className="text-foreground">
                    Asked to fix {formatDate(f.work_date, active.date_format)}: {f.requested_clock_in ? `in ${t(f.requested_clock_in)}` : ""} {f.requested_clock_out ? `out ${t(f.requested_clock_out)}` : ""}
                  </span>
                  <span className="block text-[12px] text-subtle-foreground">
                    {f.reason}
                    {f.decision_comment && ` · ${f.decision_comment}`}
                  </span>
                </span>
                <StatusDot tone={FIX[f.status as keyof typeof FIX]?.tone ?? "neutral"}>{FIX[f.status as keyof typeof FIX]?.label ?? f.status}</StatusDot>
              </li>
            ))}
            {(edits ?? []).map((e) => {
              const ch = (e.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
              const reason = ch.edit_reason?.to as string | undefined;
              const date = ((ch.work_date?.to ?? ch.work_date?.from) as string | undefined) ?? (e.entity_id ? recordDate.get(e.entity_id) : undefined);
              return (
                <li key={e.id} className="px-4 py-3">
                  <span className="text-foreground">
                    {e.action === "delete" ? "Removed" : e.action === "insert" ? "Added" : "Changed"} a day{date ? ` (${formatDate(date, active.date_format)})` : ""} in the office
                  </span>
                  <span className="block text-[12px] text-subtle-foreground">
                    {(e.actor_id && actorName.get(e.actor_id)) || "Someone"} · {formatDateTime(e.created_at, active.date_format, active.timezone)}
                    {reason && ` · ${reason}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
