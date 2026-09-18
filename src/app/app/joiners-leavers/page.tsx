import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { StartChecklistButton } from "./joiners-client";

export const metadata: Metadata = { title: "Joiners & leavers" };

export default async function JoinersLeaversPage(props: PageProps<"/app/joiners-leavers">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "onboarding", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see joiner and leaver checklists. Your own tasks are in the staff app.
      </Alert>
    );
  }
  const show = sp.show === "done" ? "done" : "active";
  const supabase = await createClient();
  const [{ data: lists }, { data: people }, { data: templates }] = await Promise.all([
    supabase
      .from("employee_checklists")
      .select("id, kind, status, started_at, completed_at, employee:employees(id, first_name, last_name, join_date, exit_date), tasks:employee_checklist_tasks(status, due_date)")
      .eq("business_id", active.business_id)
      .in("status", show === "done" ? ["completed", "cancelled"] : ["in_progress"])
      .order("started_at", { ascending: false })
      .limit(100),
    supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).order("first_name").limit(3000),
    supabase.from("checklist_templates").select("id, name, kind").eq("business_id", active.business_id).eq("is_active", true).order("name"),
  ]);
  const today = localDay(new Date(), active.timezone);
  const section = (kind: "onboarding" | "offboarding") => (lists ?? []).filter((l) => l.kind === kind);

  const renderList = (kind: "onboarding" | "offboarding") => {
    const rows = section(kind);
    if (!rows.length) return <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">{kind === "onboarding" ? "No joiners right now." : "No leavers right now."}</p>;
    return (
      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((l) => {
          const e = l.employee as unknown as { id: string; first_name: string; last_name: string; join_date: string | null; exit_date: string | null };
          const tasks = (l.tasks ?? []) as { status: string; due_date: string | null }[];
          const done = tasks.filter((t) => t.status !== "todo").length;
          const late = tasks.filter((t) => t.status === "todo" && t.due_date && t.due_date < today).length;
          const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
          return (
            <li key={l.id}>
              <Link href={`/app/joiners-leavers/${l.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-accent-soft">
                <span className="min-w-0 flex-1">
                  <span className="block text-foreground">{`${e.first_name} ${e.last_name}`.trim()}</span>
                  <span className="block text-[12px] text-subtle-foreground">
                    {kind === "onboarding" ? `Joins ${formatDate(e.join_date, active.date_format)}` : `Last day ${formatDate(e.exit_date, active.date_format)}`}
                    {late > 0 && <span className="text-danger"> · {late} late</span>}
                    {l.status !== "in_progress" && ` · ${l.status === "completed" ? "Finished" : "Cancelled"}`}
                  </span>
                </span>
                <span className="w-32 text-right">
                  <span className="block text-[12px] text-muted-foreground tabular">
                    {done} of {tasks.length} done
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-muted">
                    <span className={cn("block h-full", pct === 100 ? "bg-success" : "bg-foreground")} style={{ width: `${pct}%` }} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div>
      <PageHeader
        label="hire"
        title="Joiners & leavers"
        description="Checklists for everyone starting or leaving. They start by themselves when you add or hire someone, or mark them as leaving. Tasks go to HR, the manager or the person."
        actions={
          <>
            {can(ctx, "onboarding", "edit") && (
              <Link href="/app/joiners-leavers/checklists" className={buttonClasses({ variant: "secondary" })}>
                <ListChecks className="size-4" aria-hidden /> Checklists
              </Link>
            )}
            {can(ctx, "onboarding", "create") && (
              <StartChecklistButton
                people={(people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() + ` · ${p.employee_code}` }))}
                templates={(templates ?? []).map((t) => ({ value: t.id, label: t.name, kind: t.kind }))}
              />
            )}
          </>
        }
      />
      <nav className="mb-6 flex gap-2 text-[13px]">
        <Link href="/app/joiners-leavers" className={cn("rounded-full border px-3 py-1", show === "active" ? "border-foreground" : "border-border text-muted-foreground")}>
          In progress
        </Link>
        <Link href="/app/joiners-leavers?show=done" className={cn("rounded-full border px-3 py-1", show === "done" ? "border-foreground" : "border-border text-muted-foreground")}>
          Finished
        </Link>
      </nav>
      {!templates?.length ? (
        <EmptyState
          title="No checklists yet"
          description="Add a joiner and a leaver checklist first."
          action={
            <Link href="/app/joiners-leavers/checklists" className={buttonClasses()}>
              Set up checklists
            </Link>
          }
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 text-lg">Joining</h2>
            {renderList("onboarding")}
          </section>
          <section>
            <h2 className="mb-3 text-lg">Leaving</h2>
            {renderList("offboarding")}
          </section>
        </div>
      )}
    </div>
  );
}
