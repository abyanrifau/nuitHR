import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Time off calendar" };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function TimeOffCalendar(props: PageProps<"/app/time-off/calendar">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "leave", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see the team calendar.
      </Alert>
    );
  }
  const today = localDay(new Date(), active.timezone);
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const prev = iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1))).slice(0, 7);
  const next = iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1))).slice(0, 7);
  const supabase = await createClient();
  const { data: b } = await supabase.from("businesses").select("week_start, working_days").eq("id", active.business_id).single();
  const weekStart = b?.week_start ?? 0;
  // Grid from the start of the week containing the 1st to the end of the week containing the last day.
  const gridStart = new Date(first.getTime() - ((first.getUTCDay() - weekStart + 7) % 7) * 86400000);
  const gridEnd = new Date(last.getTime() + ((weekStart + 6 - last.getUTCDay() + 7) % 7) * 86400000);
  const days: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = new Date(d.getTime() + 86400000)) days.push(iso(d));

  let q = supabase
    .from("leave_requests")
    .select("id, start_date, end_date, status, employee:employees(first_name, last_name, department_id), type:leave_types(name, color)")
    .eq("business_id", active.business_id)
    .in("status", sp.pending ? ["approved", "pending"] : ["approved"])
    .lte("start_date", iso(gridEnd))
    .gte("end_date", iso(gridStart));
  const [{ data: leave }, { data: holidays }, { data: departments }] = await Promise.all([
    (q = q.order("start_date")),
    supabase.from("public_holidays").select("holiday_date, name").eq("business_id", active.business_id).gte("holiday_date", iso(gridStart)).lte("holiday_date", iso(gridEnd)),
    supabase.from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
  ]);
  const rows = (leave ?? [])
    .map((l) => ({ ...l, e: l.employee as unknown as { first_name: string; last_name: string; department_id: string | null }, t: l.type as unknown as { name: string; color: string } }))
    .filter((l) => !sp.department || l.e.department_id === sp.department);
  const holidayOn = new Map((holidays ?? []).map((h) => [h.holiday_date, h.name]));
  const workDays = new Set<number>((b?.working_days as number[]) ?? [0, 1, 2, 3, 4]);
  const labels = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + ((weekStart + i) % 7)))),
  );
  const q2 = (patch: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ month, department: sp.department, pending: sp.pending, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/app/time-off/calendar?${s}`;
  };

  return (
    <div>
      <PageHeader back={{ href: "/app/time-off", label: "Time off" }} title="Time off calendar" description="Who's off each day, so you can spot clashes before you approve." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={q2({ month: prev })} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Previous month">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <p className="min-w-36 text-center font-display">{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</p>
        <Link href={q2({ month: next })} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label="Next month">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        <span className="ml-auto flex flex-wrap gap-2 text-[13px]">
          <Link href={q2({ pending: sp.pending ? undefined : "1" })} className={cn("rounded-full border px-3 py-1", sp.pending ? "border-foreground" : "border-border text-muted-foreground")}>
            Include waiting
          </Link>
          {(departments ?? []).map((d) => (
            <Link
              key={d.id}
              href={q2({ department: sp.department === d.id ? undefined : d.id })}
              className={cn("rounded-full border px-3 py-1", sp.department === d.id ? "border-foreground" : "border-border text-muted-foreground")}
            >
              {d.name}
            </Link>
          ))}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[48rem] grid-cols-7 overflow-hidden rounded-xl border border-border">
          {labels.map((l) => (
            <div key={l} className="border-b border-border px-2 py-2 text-[11px] tracking-[0.12em] text-subtle-foreground uppercase">
              {l}
            </div>
          ))}
          {days.map((d) => {
            const off = rows.filter((r) => r.start_date <= d && r.end_date >= d);
            const inMonth = d.slice(0, 7) === month;
            const rest = !workDays.has(new Date(`${d}T00:00:00Z`).getUTCDay());
            return (
              <div key={d} className={cn("min-h-28 border-b border-l border-border p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0", !inMonth && "opacity-40", rest && "bg-surface-muted/40")}>
                <p className={cn("mb-1 text-[12px] tabular", d === today ? "font-display text-foreground" : "text-muted-foreground")}>{Number(d.slice(8))}</p>
                {holidayOn.get(d) && <p className="mb-1 truncate text-[11px] text-info">{holidayOn.get(d)}</p>}
                <ul className="space-y-0.5">
                  {off.slice(0, 4).map((r) => (
                    <li
                      key={r.id}
                      className={cn("truncate rounded px-1.5 py-0.5 text-[11px] text-foreground", r.status === "pending" && "border border-dashed border-border-strong")}
                      style={{ background: r.status === "approved" ? `color-mix(in oklab, ${r.t.color} 25%, transparent)` : undefined }}
                      title={`${r.e.first_name} ${r.e.last_name}: ${r.t.name}${r.status === "pending" ? " (waiting)" : ""}`}
                    >
                      {r.e.first_name}
                    </li>
                  ))}
                  {off.length > 4 && <li className="px-1.5 text-[11px] text-subtle-foreground">+{off.length - 4} more</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
