import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/access";
import { NewsBoard } from "./news-board";

export const metadata: Metadata = { title: "News" };

export default async function NewsPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "announcements", "create") && !can(ctx, "announcements", "edit")) {
    return (
      <Alert tone="warning" title="No access">
        Company news appears in the staff app. Ask the owner or an admin if you need to post news.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: posts }, { data: branches }, { data: departments }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body, branch_id, department_id, is_pinned, published_at, expires_at, created_at")
      .eq("business_id", active.business_id)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: true })
      .limit(100),
    supabase.from("branches").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
    supabase.from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
  ]);
  const now = new Date().toISOString();
  const tz = active.timezone;
  const local = (iso: string | null) => {
    if (!iso) return "";
    const p = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
    return p.replace(" ", "T");
  };
  return (
    <div className="max-w-3xl">
      <PageHeader label="foundation" title="News" description="Post news to everyone, or just one location or team. It shows at the top of the staff app." />
      <NewsBoard
        canCreate={can(ctx, "announcements", "create")}
        canEdit={can(ctx, "announcements", "edit")}
        canDelete={can(ctx, "announcements", "delete")}
        branches={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
        departments={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
        posts={(posts ?? []).map((p) => ({
          ...p,
          state: !p.published_at ? "draft" : p.published_at > now ? "scheduled" : p.expires_at && p.expires_at <= now ? "ended" : "live",
          publishedText: formatDateTime(p.published_at, active.date_format, tz),
          publishLocal: local(p.published_at),
          expiresLocal: local(p.expires_at).slice(0, 10),
        }))}
      />
    </div>
  );
}
