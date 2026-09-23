import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/format";
import { loadAttendanceMonth } from "@/lib/time/attendance-data";
import { DAY_STATUS, STATUS_ORDER, hm, monthRange, type AttendanceDay } from "@/lib/time/day-status";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Attendance register" };

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

function cellTitle(name: string, d: AttendanceDay, tz: string) {
  const t = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)) : "–");
  const parts = [`${name}, ${d.day}`, d.status ? DAY_STATUS[d.status].label : "Not yet"];
  if (d.clock_in_at) parts.push(`${t(d.clock_in_at)} to ${t(d.clock_out_at)}, ${hm(d.worked_minutes)} worked`);
  if (d.late_minutes) parts.push(`${d.late_minutes} min late`);
  if (d.overtime_minutes) parts.push(`${hm(d.overtime_minutes)} overtime (${d.overtime_state})`);
  if (d.leave_name) parts.push(d.leave_name);
  if (d.missing_clock_out) parts.push("No clock-out");
  return parts.join(" · ");
}

/** Everyone by day for a month, with one coloured status per day and the month's totals. */
export default async function RegisterPage(props: PageProps<"/app/time/register">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "attendance", "view", "team")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to see the attendance register.</Alert>;
  }
  const range = monthRange(sp.month, today(active.timezone));
  const supabase = await createClient();
  const [{ people, days, summaries }, { data: branches }, { data: departments }] = await Promise.all([
    loadAttendanceMonth(active, range, { branch: sp.branch, department: sp.department }),
    supabase.from("branches").select("id, name").eq("business_id", active.business_id).order("name"),
    supabase.from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
  ]);
  const dates: string[] = [];
  for (let d = new Date(`${range.start}T00:00:00Z`); d.toISOString().slice(0, 10) <= range.end; d = new Date(d.getTime() + 86_400_000)) dates.push(d.toISOString().slice(0, 10));
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ month: range.month, branch: sp.branch, department: sp.department, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/app/time/register?${p}`;
  };
  const locked = [...summaries.values()].some((m) => m.locked_at);
  const chip = (on: boolean) => cn("rounded-full border px-3 py-1", on ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground");

  return (
    <div>
      <PageHeader
        back={{ href: "/app/time", label: "Time" }}
        title="Attendance register"
        description="Each person's day, every day of the month. Point at a day for its times. Totals on the right are what payroll uses."
        actions={
          <Link href={`/app/time/reports?month=${range.month}`} className={buttonClasses({ variant: "secondary" })}>
            Reports and export
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={q({ month: range.prev })} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Previous month">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <p className="min-w-40 text-center font-display">{range.label}</p>
        <Link href={q({ month: range.next })} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Next month">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        {locked && (
          <span className="ml-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Lock className="size-3.5" aria-hidden /> Payroll finalized: this month is locked
          </span>
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
        {(branches ?? []).length > 1 && (
          <>
            <Link href={q({ branch: undefined })} className={chip(!sp.branch)}>
              All locations
            </Link>
            {(branches ?? []).map((b) => (
              <Link key={b.id} href={q({ branch: b.id })} className={chip(sp.branch === b.id)}>
                {b.name}
              </Link>
            ))}
          </>
        )}
      </div>
      {(departments ?? []).length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2 text-[13px]">
          <Link href={q({ department: undefined })} className={chip(!sp.department)}>
            All teams
          </Link>
          {(departments ?? []).map((d) => (
            <Link key={d.id} href={q({ department: d.id })} className={chip(sp.department === d.id)}>
              {d.name}
            </Link>
          ))}
        </div>
      )}

      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground" aria-label="Key">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="grid h-5 min-w-5 place-items-center rounded px-1 text-[10px] font-medium" style={{ background: DAY_STATUS[s].color, color: DAY_STATUS[s].text }}>
              {DAY_STATUS[s].code}
            </span>
            {DAY_STATUS[s].label}
          </li>
        ))}
      </ul>

      {people.length === 0 ? (
        <EmptyState title="No one to show" description="There's no one here for this month and these filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-max border-separate border-spacing-0 text-[12px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-36 border-b sm:min-w-44 border-border bg-background px-3 py-2 text-left font-normal text-subtle-foreground">Person</th>
                {dates.map((d) => {
                  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                  return (
                    <th key={d} className="border-b border-border px-0.5 py-1 text-center font-normal text-subtle-foreground">
                      <span className="block">{WEEKDAY[dow]}</span>
                      <span className="block text-foreground tabular">{Number(d.slice(8))}</span>
                    </th>
                  );
                })}
                {[
                  ["P", "Days present"],
                  ["HD", "Half days"],
                  ["A", "Unapproved absences"],
                  ["LV", "On leave"],
                  ["L", "Times late"],
                  ["OT", "Overtime counted"],
                ].map(([c, t]) => (
                  <th key={c} title={t} className="border-b border-l border-border px-2 py-2 text-right font-normal text-subtle-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const byDay = new Map((days.get(p.id) ?? []).map((d) => [d.day, d]));
                const m = summaries.get(p.id);
                return (
                  <tr key={p.id} className="hover:bg-accent-soft">
                    <td className="sticky left-0 z-10 border-b border-border bg-background px-3 py-1.5">
                      <Link href={`/app/people/${p.id}?tab=time&month=${range.month}`} className="flex items-center gap-2 hover:underline">
                        <Avatar name={p.name} path={p.photo_path} size="xs" />
                        <span className="min-w-0 truncate text-foreground">{p.name}</span>
                      </Link>
                    </td>
                    {dates.map((d) => {
                      const day = byDay.get(d);
                      const s = day?.status ? DAY_STATUS[day.status] : null;
                      return (
                        <td key={d} className="border-b border-border px-0.5 py-1 text-center">
                          {day ? (
                            <span
                              title={cellTitle(p.name, day, active.timezone)}
                              className={cn("relative mx-auto grid h-6 min-w-6 place-items-center rounded text-[10px] font-medium", !s && "text-subtle-foreground")}
                              style={s ? { background: s.color, color: s.text } : undefined}
                            >
                              {s ? s.code : "·"}
                              {(day.overtime_minutes > 0 || day.missing_clock_out) && (
                                <span className={cn("absolute -top-1 -right-1 size-2 rounded-full ring-2 ring-background", day.missing_clock_out ? "bg-danger" : "bg-foreground")} aria-hidden />
                              )}
                            </span>
                          ) : (
                            <span className="text-subtle-foreground" aria-hidden>
                              {" "}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-border px-2 text-right tabular">{m?.days_present ?? "–"}</td>
                    <td className="border-b border-l border-border px-2 text-right tabular">{m?.half_days ?? "–"}</td>
                    <td className={cn("border-b border-l border-border px-2 text-right tabular", m?.unapproved_absences ? "text-danger" : "")}>{m?.unapproved_absences ?? "–"}</td>
                    <td className="border-b border-l border-border px-2 text-right tabular">{m?.approved_absences ?? "–"}</td>
                    <td className="border-b border-l border-border px-2 text-right tabular">{m?.late_count ?? "–"}</td>
                    <td className="border-b border-l border-border px-2 text-right whitespace-nowrap tabular">
                      {m ? hm(m.overtime_normal_minutes + m.overtime_rest_day_minutes + m.overtime_holiday_minutes) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[12px] text-subtle-foreground">
        A dot on a day means overtime (black) or a missing clock-out (red). Days before someone joined or after they left are blank.
      </p>
    </div>
  );
}
