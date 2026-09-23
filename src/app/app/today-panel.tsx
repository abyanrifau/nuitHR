import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { fullName } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Emp = { first_name: string; last_name: string; preferred_name: string | null; photo_path: string | null } | null;
interface Tile {
  key: string;
  label: string;
  href: string;
  empty: string;
  people: { id: string; name: string; photo: string | null; note?: string }[];
}

/**
 * Today at the top of Home: who's in, who's off, who's late and today's
 * shifts, with names and pictures. Each part shows only when its tool is on
 * and the viewer may see it; the database also limits managers to their team.
 */
export async function TodayPanel({ businessId, today, timezone, attendance, roster, leave }: { businessId: string; today: string; timezone: string; attendance: boolean; roster: boolean; leave: boolean }) {
  const supabase = await createClient();
  const person = "employee:employees(first_name, last_name, preferred_name, photo_path)";
  const none = Promise.resolve({ data: null });
  const [{ data: records }, { data: off }, { data: shifts }] = await Promise.all([
    attendance
      ? supabase.from("attendance_records").select(`id, employee_id, clock_in_at, clock_out_at, late_minutes, ${person}`).eq("business_id", businessId).eq("work_date", today).not("clock_in_at", "is", null)
      : none,
    leave
      ? supabase.from("leave_requests").select(`id, employee_id, end_date, ${person}, type:leave_types(name)`).eq("business_id", businessId).eq("status", "approved").lte("start_date", today).gte("end_date", today)
      : none,
    roster
      ? supabase.from("roster_entries").select(`id, employee_id, ${person}, shift:shifts(name, start_time)`).eq("business_id", businessId).eq("work_date", today).eq("is_rest_day", false)
      : none,
  ]);
  const nameOf = (e: unknown) => fullName(e as Emp) || "Someone";
  const photoOf = (e: unknown) => (e as Emp)?.photo_path ?? null;
  const time = (ts: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(ts));

  const tiles: Tile[] = [];
  if (attendance) {
    const recs = records ?? [];
    tiles.push({
      key: "in",
      label: "In now",
      href: "/app/time",
      empty: "Nobody has clocked in yet",
      people: recs.filter((r) => !r.clock_out_at).map((r) => ({ id: r.id, name: nameOf(r.employee), photo: photoOf(r.employee), note: `since ${time(r.clock_in_at!)}` })),
    });
    tiles.push({
      key: "late",
      label: "Late today",
      href: "/app/time",
      empty: "Nobody was late",
      people: recs.filter((r) => (r.late_minutes ?? 0) > 0).map((r) => ({ id: r.id, name: nameOf(r.employee), photo: photoOf(r.employee), note: `${r.late_minutes} min late` })),
    });
  }
  if (leave) {
    tiles.push({
      key: "off",
      label: "Off today",
      href: "/app/time-off/calendar",
      empty: "Everyone's in",
      people: (off ?? []).map((l) => ({ id: l.id, name: nameOf(l.employee), photo: photoOf(l.employee), note: (l.type as unknown as { name: string } | null)?.name })),
    });
  }
  if (roster) {
    tiles.push({
      key: "shifts",
      label: "On shift today",
      href: "/app/time/roster",
      empty: "No shifts on the roster",
      people: (shifts ?? []).map((s) => {
        const sh = s.shift as unknown as { name: string; start_time: string } | null;
        return { id: s.id, name: nameOf(s.employee), photo: photoOf(s.employee), note: sh ? `${sh.name} · ${sh.start_time.slice(0, 5)}` : undefined };
      }),
    });
  }
  if (!tiles.length) return null;

  return (
    <section aria-labelledby="home-today" className="space-y-4">
      <h2 id="home-today" className="border-b border-border pb-3 text-xl">
        Today
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.key} href={t.href} className="block rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
            <p className="text-[13px] text-muted-foreground">{t.label}</p>
            <p className="font-display mt-3 text-4xl tabular">{t.people.length}</p>
            {t.people.length ? (
              <ul className="mt-3 space-y-2">
                {t.people.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Avatar name={p.name} path={p.photo} size="xs" />
                    <span className="min-w-0 truncate text-[13px] text-foreground">
                      {p.name}
                      {p.note && <span className="text-subtle-foreground"> · {p.note}</span>}
                    </span>
                  </li>
                ))}
                {t.people.length > 4 && <li className="text-[12px] text-subtle-foreground">and {t.people.length - 4} more</li>}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-subtle-foreground">{t.empty}</p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
