import Link from "next/link";
import { ChevronRight, Pin } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { InstallPrompt } from "@/components/staff/install";
import { getStaffContext } from "@/lib/staff/context";
import { formatDateTime } from "@/lib/format";
import { ModuleIcon } from "@/modules/icons";
import { portalNavigation } from "@/modules/access";

function greeting(timeZone: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function StaffHome() {
  const { active, ctx, me, supabase, user } = await getStaffContext();
  const extras = portalNavigation(ctx, { onlyBuilt: true }).filter((p) => !p.tab);
  const now = new Date().toISOString();
  const [{ data: news }, { data: inbox }, { count: open }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body, is_pinned, published_at, branch_id, department_id")
      .eq("business_id", active.business_id)
      .not("published_at", "is", null)
      .lte("published_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(20),
    supabase.rpc("my_request_inbox", { p_business: active.business_id }),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("business_id", active.business_id).eq("requested_by", user.id).eq("status", "pending"),
  ]);
  // Only news meant for everyone, or for my location and team.
  const mine = (news ?? [])
    .filter((n) => (!n.branch_id || n.branch_id === me?.branch_id) && (!n.department_id || n.department_id === me?.department_id))
    .slice(0, 5);
  const waiting = (inbox as unknown[] | null)?.length ?? 0;
  const name = me?.preferred_name || me?.first_name;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">{greeting(active.timezone)}</p>
        <h1 className="mt-1 text-3xl">{name ? `${name}.` : "Welcome."}</h1>
      </div>

      <InstallPrompt />

      {!me && (
        <Alert tone="warning" title="Your login isn't linked to a staff profile">
          Ask HR to link it in People &amp; access. Until then you can read news, but not see your own records.
        </Alert>
      )}

      {(waiting > 0 || (open ?? 0) > 0) && (
        <section className="grid grid-cols-2 gap-3">
          {waiting > 0 && (
            <Link href="/staff/requests" className="rounded-xl border border-border-strong p-4">
              <span className="block font-display text-3xl tabular">{waiting}</span>
              <span className="text-sm text-muted-foreground">waiting for your decision</span>
            </Link>
          )}
          {(open ?? 0) > 0 && (
            <Link href="/staff/requests" className="rounded-xl border border-border p-4">
              <span className="block font-display text-3xl tabular">{open}</span>
              <span className="text-sm text-muted-foreground">of your requests in progress</span>
            </Link>
          )}
        </section>
      )}

      {extras.length > 0 && (
        <section aria-labelledby="quick">
          <h2 id="quick" className="section-label mb-3">
            quick links
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {extras.map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="flex min-h-14 items-center gap-3 px-4 hover:bg-accent-soft">
                  <ModuleIcon name={p.icon} className="size-5 text-muted-foreground" />
                  <span className="flex-1">{p.label}</span>
                  <ChevronRight className="size-4 text-subtle-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="news">
        <h2 id="news" className="section-label mb-3">
          news
        </h2>
        {mine.length ? (
          <ul className="space-y-3">
            {mine.map((n) => (
              <li key={n.id} className="rounded-xl border border-border p-4">
                <p className="flex items-start gap-2 text-foreground">
                  {n.is_pinned && <Pin className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                  {n.title}
                </p>
                <p className="mt-0.5 text-[12px] text-subtle-foreground tabular">{formatDateTime(n.published_at, active.date_format, active.timezone)}</p>
                <p className="mt-2 text-sm whitespace-pre-line text-muted-foreground">{n.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">No news yet. Company news will show here.</p>
        )}
      </section>
    </div>
  );
}
