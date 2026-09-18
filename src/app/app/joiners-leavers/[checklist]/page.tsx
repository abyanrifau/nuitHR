import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { TaskButtons } from "../joiners-client";
import { CancelChecklistButton } from "./cancel-button";

export const metadata: Metadata = { title: "Checklist" };

const WHO: Record<string, string> = { hr: "HR", manager: "Manager", employee: "Them", user: "Someone named" };

export default async function ChecklistPage(props: PageProps<"/app/joiners-leavers/[checklist]">) {
  const { checklist: id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const active = (await getActiveBusiness())!;
  const user = (await getSessionUser())!;
  const ctx = toAccessContext(active);
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("employee_checklists")
    .select("id, kind, status, employee:employees(id, first_name, last_name, join_date, exit_date), template:checklist_templates(name)")
    .eq("id", id)
    .eq("business_id", active.business_id)
    .maybeSingle();
  const { data: tasks } = await supabase
    .from("employee_checklist_tasks")
    .select("id, title, description, assignee_type, assignee_user_id, due_date, status, completed_at, completed_by, sort")
    .eq("checklist_id", id)
    .order("sort");
  if (!c && !tasks?.length) notFound();
  if (!c) {
    return (
      <Alert tone="info" title="Your tasks">
        You can see and tick off the tasks given to you in the staff app under My tasks.
      </Alert>
    );
  }
  const e = c.employee as unknown as { id: string; first_name: string; last_name: string; join_date: string | null; exit_date: string | null };
  const today = localDay(new Date(), active.timezone);
  const canEdit = can(ctx, "onboarding", "edit", "team");
  const people = [...new Set((tasks ?? []).map((t) => t.assignee_user_id).filter(Boolean))] as string[];
  const { data: names } = people.length ? await supabase.from("profiles").select("id, full_name").in("id", people) : { data: [] };
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.full_name ?? "Someone"]));

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/joiners-leavers", label: "Joiners & leavers" }}
        title={`${e.first_name} ${e.last_name}`.trim()}
        description={
          <>
            {c.kind === "onboarding" ? `Joining on ${formatDate(e.join_date, active.date_format)}` : `Leaving on ${formatDate(e.exit_date, active.date_format)}`} ·{" "}
            {(c.template as unknown as { name: string } | null)?.name ?? "Checklist"}
            {" · "}
            <Link href={`/app/people/${e.id}`} className="underline underline-offset-4">
              profile
            </Link>
          </>
        }
        actions={c.status === "in_progress" && can(ctx, "onboarding", "edit") ? <CancelChecklistButton id={c.id} /> : undefined}
      />
      {c.status !== "in_progress" && (
        <Alert tone={c.status === "completed" ? "success" : "info"} className="mb-6">
          {c.status === "completed" ? "Everything is done." : "This checklist was cancelled."}
        </Alert>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border">
        {(tasks ?? []).map((t) => {
          const late = t.status === "todo" && t.due_date && t.due_date < today;
          const mine = t.assignee_user_id === user.id;
          return (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3.5">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", t.status === "done" ? "bg-success" : t.status === "skipped" ? "bg-subtle-foreground" : late ? "bg-danger" : "bg-border-strong")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", t.status === "todo" ? "text-foreground" : "text-muted-foreground line-through")}>{t.title}</p>
                {t.description && <p className="text-[12px] text-subtle-foreground">{t.description}</p>}
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-subtle-foreground">
                  <Badge>{t.assignee_user_id ? nameOf.get(t.assignee_user_id) ?? WHO[t.assignee_type] : WHO[t.assignee_type]}</Badge>
                  {t.due_date && <span className={late ? "text-danger" : undefined}>due {formatDate(t.due_date, active.date_format)}</span>}
                  {t.status === "skipped" && <span>· skipped</span>}
                  {t.assignee_type === "employee" && !t.assignee_user_id && <span>· they don&apos;t have a login yet, so HR can tick this</span>}
                </p>
              </div>
              {c.status === "in_progress" && (canEdit || mine) && <TaskButtons id={t.id} status={t.status} checklistId={c.id} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
