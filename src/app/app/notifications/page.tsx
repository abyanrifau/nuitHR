import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/table";
import { getActiveBusiness, getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MarkAllRead } from "./mark-all-read";

export const metadata: Metadata = { title: "Notifications" };

const PAGE = 50;

export default async function NotificationsPage(props: PageProps<"/app/notifications">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const user = (await getSessionUser())!;
  const active = (await getActiveBusiness())!;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("notifications")
    .select("id, title, body, link, read_at, created_at", { count: "exact" })
    .eq("user_id", user.id)
    .eq("business_id", active.business_id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  const rows = data ?? [];
  const unread = rows.some((r) => !r.read_at);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Notifications"
        description={
          <>
            Everything sent to you in {active.business_name}. Choose what you get in{" "}
            <Link href="/app/account" className="underline underline-offset-4">
              your account
            </Link>
            .
          </>
        }
        actions={unread ? <MarkAllRead /> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="No notifications yet" description="Requests waiting for you, decisions on your requests and company news will show up here." />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {rows.map((n) => (
              <li key={n.id}>
                <Link href={n.link ?? "/app"} className="flex gap-3 px-4 py-3.5 hover:bg-accent-soft">
                  <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-foreground")} aria-label={n.read_at ? undefined : "Unread"} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block", n.read_at ? "text-muted-foreground" : "text-foreground")}>{n.title}</span>
                    {n.body && <span className="block text-[13px] text-subtle-foreground">{n.body}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-subtle-foreground tabular">{formatDateTime(n.created_at, active.date_format, active.timezone)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={sp} basePath="/app/notifications" />
        </>
      )}
    </div>
  );
}
