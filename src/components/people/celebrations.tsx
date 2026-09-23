import Link from "next/link";
import { Cake, CalendarDays, Megaphone, PartyPopper, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

interface Person {
  employee_id: string;
  name: string;
  photo_path: string | null;
}
interface Data {
  enabled: boolean;
  birthdays?: (Person & { day: number; month: number; on: string })[];
  anniversaries?: (Person & { years: number; on: string })[];
  joiners?: (Person & { join_date: string; position: string | null })[];
}

/** "Fri 26 Sep" for a date this week. Birthdays only ever show the day and month. */
const weekday = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function Group({ icon: Icon, title, children }: { icon: typeof Cake; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Icon className="size-3.5" aria-hidden /> {title}
      </h3>
      <ul className="space-y-2.5">{children}</ul>
    </div>
  );
}

function Row({ name, path, detail }: { name: string; path: string | null; detail: string }) {
  return (
    <li className="flex items-center gap-3">
      <Avatar name={name} path={path} size="md" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">{name}</span>
        <span className="block truncate text-[12px] text-subtle-foreground">{detail}</span>
      </span>
    </li>
  );
}

/**
 * Celebrations for everyone in the company, staff included: birthdays this
 * week, work anniversaries, new joiners, and company news and holidays.
 * Hidden when the company switches it off (Workspace, Company settings).
 */
export async function Celebrations({
  businessId,
  dateFormat,
  today,
  newsHref,
  showNews = true,
}: {
  businessId: string;
  dateFormat: string;
  today: string;
  newsHref: string;
  showNews?: boolean;
}) {
  const supabase = await createClient();
  const in14 = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const [{ data }, { data: holidays }, { data: news }] = await Promise.all([
    supabase.rpc("celebrations", { p_business: businessId }),
    supabase.from("public_holidays").select("holiday_date, name").eq("business_id", businessId).gte("holiday_date", today).lte("holiday_date", in14).order("holiday_date").limit(3),
    showNews
      ? supabase
          .from("announcements")
          .select("id, title, published_at, is_pinned")
          .eq("business_id", businessId)
          .not("published_at", "is", null)
          .lte("published_at", now)
          .or(`expires_at.is.null,expires_at.gt.${now}`)
          .order("is_pinned", { ascending: false })
          .order("published_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
  ]);
  const c = data as Data | null;
  if (!c?.enabled) return null;
  const birthdays = c.birthdays ?? [];
  const anniversaries = c.anniversaries ?? [];
  const joiners = c.joiners ?? [];
  const events = holidays ?? [];
  const posts = news ?? [];
  const empty = !birthdays.length && !anniversaries.length && !joiners.length && !events.length && !posts.length;

  return (
    <section aria-labelledby="celebrations" className="rounded-xl border border-border bg-surface p-5">
      <h2 id="celebrations" className="mb-4 flex items-center gap-2 text-lg">
        <PartyPopper className="size-4 text-muted-foreground" aria-hidden /> Celebrations
      </h2>
      {empty ? (
        <p className="text-sm text-muted-foreground">No birthdays, anniversaries or new joiners this week.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {birthdays.length > 0 && (
            <Group icon={Cake} title="Birthdays this week">
              {birthdays.map((b) => (
                <Row key={b.employee_id} name={b.name} path={b.photo_path} detail={b.on === today ? "Today" : weekday(b.on)} />
              ))}
            </Group>
          )}
          {anniversaries.length > 0 && (
            <Group icon={PartyPopper} title="Work anniversaries">
              {anniversaries.map((a) => (
                <Row key={a.employee_id} name={a.name} path={a.photo_path} detail={`${a.years} ${a.years === 1 ? "year" : "years"} · ${a.on === today ? "today" : weekday(a.on)}`} />
              ))}
            </Group>
          )}
          {joiners.length > 0 && (
            <Group icon={UserPlus} title="New joiners">
              {joiners.map((j) => (
                <Row key={j.employee_id} name={j.name} path={j.photo_path} detail={[j.position, `joined ${formatDate(j.join_date, dateFormat)}`].filter(Boolean).join(" · ")} />
              ))}
            </Group>
          )}
          {(events.length > 0 || posts.length > 0) && (
            <Group icon={events.length ? CalendarDays : Megaphone} title="Company news and events">
              {events.map((h) => (
                <li key={h.holiday_date} className="text-sm">
                  <span className="text-foreground">{h.name}</span>
                  <span className="block text-[12px] text-subtle-foreground">{weekday(h.holiday_date)} · public holiday</span>
                </li>
              ))}
              {posts.map((n) => (
                <li key={n.id} className="text-sm">
                  <Link href={newsHref} className="text-foreground hover:underline">
                    {n.title}
                  </Link>
                  <span className="block text-[12px] text-subtle-foreground">{n.is_pinned ? "Pinned" : `Posted ${formatDate(n.published_at, dateFormat)}`}</span>
                </li>
              ))}
            </Group>
          )}
        </div>
      )}
    </section>
  );
}
