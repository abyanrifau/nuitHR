import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { actionVerb, describeChanges, entityLabel } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/access";
import { allResources } from "@/modules/registry";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity log" };

const PAGE = 50;

export default async function ActivityPage(props: PageProps<"/app/workspace/activity">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "audit", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner to see the activity log.
      </Alert>
    );
  }
  const page = Math.max(1, Number(sp.page) || 1);
  const resources = [...new Map(allResources().map((r) => [r.key, r.label])).entries()];
  const supabase = await createClient();
  let q = supabase
    .from("audit_log")
    .select("id, action, entity_type, resource, subject_employee_id, changes, created_at, actor_id", { count: "exact" })
    .eq("business_id", active.business_id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.area) q = q.eq("resource", sp.area);
  const { data, count } = await q;
  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const empIds = [...new Set(rows.map((r) => r.subject_employee_id).filter(Boolean))] as string[];
  const [{ data: actors }, { data: emps }] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    empIds.length ? supabase.from("employees").select("id, first_name, last_name").in("id", empIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
  ]);
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name || a.email || "Someone"]));
  const empName = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]));
  const canSeePay = can(ctx, "compensation", "view");

  return (
    <div>
      <PageHeader label="workspace" title="Activity log" description="Every change in your company: who made it, what changed and when. Nobody can edit or delete this list." />
      <div className="mb-5 flex flex-wrap gap-2 text-[13px]">
        {[["", "Everything"], ...resources.filter(([k]) => ["employees", "org", "compensation", "users", "roles", "settings", "modules", "documents", "letters", "approvals", "support", "leave", "attendance", "payroll", "claims"].includes(k))].map(([k, label]) => (
          <Link
            key={k}
            href={k ? `/app/workspace/activity?area=${k}` : "/app/workspace/activity"}
            className={cn("rounded-full border px-3 py-1", (sp.area ?? "") === k ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <>
          <ol className="rounded-xl border border-border">
            {rows.map((r) => {
              const lines = r.action === "update" ? describeChanges(r.changes as Record<string, { from: unknown; to: unknown }> | null, { showSensitive: canSeePay }) : [];
              const who = r.subject_employee_id ? empName.get(r.subject_employee_id) : null;
              return (
                <li key={r.id} className="grid gap-1 border-b border-border px-4 py-3.5 last:border-b-0 sm:grid-cols-[10.5rem_1fr]">
                  <span className="text-[13px] text-subtle-foreground tabular">{formatDateTime(r.created_at, active.date_format, active.timezone)}</span>
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="text-foreground">{(r.actor_id && actorName.get(r.actor_id)) || "System"}</span>{" "}
                      <span className="text-muted-foreground">
                        {actionVerb(r.action)} {entityLabel(r.entity_type)}
                      </span>
                      {who && (
                        <>
                          {" "}
                          <span className="text-muted-foreground">for</span>{" "}
                          <Link href={`/app/people/${r.subject_employee_id}`} className="text-foreground hover:underline">
                            {who}
                          </Link>
                        </>
                      )}
                    </p>
                    {lines.length > 0 && (
                      <ul className="mt-1 flex min-w-0 flex-wrap gap-1.5">
                        {lines.slice(0, 6).map((l) => (
                          <li key={l} className="max-w-full">
                            <Badge className="max-w-full whitespace-normal break-words">{l}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={sp} basePath="/app/workspace/activity" />
        </>
      )}
    </div>
  );
}
