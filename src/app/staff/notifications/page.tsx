import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page";
import { getStaffContext } from "@/lib/staff/context";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

/** Links written for the office view are sent to the matching staff app page. */
function staffLink(link: string | null): string {
  if (!link) return "/staff";
  if (link.startsWith("/staff")) return link;
  if (link.startsWith("/app/requests")) return "/staff/requests";
  return link;
}

export default async function StaffNotifications() {
  const { active, supabase, user } = await getStaffContext();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, link, read_at, created_at")
    .eq("user_id", user.id)
    .eq("business_id", active.business_id)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = data ?? [];
  // Opening this page counts as reading them. The dots still show what was new this time.
  if (rows.some((r) => !r.read_at)) {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).eq("business_id", active.business_id).is("read_at", null);
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Notifications" />
      {rows.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((n) => (
            <li key={n.id}>
              <Link href={staffLink(n.link)} className="flex gap-3 px-4 py-3.5 hover:bg-accent-soft">
                <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-foreground")} aria-label={n.read_at ? undefined : "Unread"} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block", n.read_at ? "text-muted-foreground" : "text-foreground")}>{n.title}</span>
                  {n.body && <span className="line-clamp-2 block text-[13px] text-subtle-foreground">{n.body}</span>}
                  <span className="block text-[12px] text-subtle-foreground">{timeAgo(n.created_at, active.date_format)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">Nothing yet. Decisions on your requests and company news show here.</p>
      )}
    </div>
  );
}
