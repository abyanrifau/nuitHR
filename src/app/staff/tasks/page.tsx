import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page";
import { TaskButtons } from "@/app/app/joiners-leavers/joiners-client";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate, localDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My tasks" };

interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  person: string;
  kind: string;
  is_me: boolean;
}

export default async function StaffTasks() {
  const { active, supabase } = await getStaffContext();
  const { data } = await supabase.rpc("my_checklist_tasks", { p_business: active.business_id });
  const tasks = (data ?? []) as Task[];
  const today = localDay(new Date(), active.timezone);
  const open = tasks.filter((t) => t.status === "todo");
  const done = tasks.filter((t) => t.status !== "todo");
  const row = (t: Task) => {
    const late = t.status === "todo" && t.due_date && t.due_date < today;
    return (
      <li key={t.id} className="flex items-start gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm", t.status === "todo" ? "text-foreground" : "text-muted-foreground line-through")}>{t.title}</p>
          <p className="text-[12px] text-subtle-foreground">
            {t.is_me ? (t.kind === "onboarding" ? "For your first days" : "Before you leave") : `${t.person} is ${t.kind === "onboarding" ? "joining" : "leaving"}`}
            {t.due_date && <span className={late ? "text-danger" : undefined}> · due {formatDate(t.due_date, active.date_format)}</span>}
          </p>
          {t.description && <p className="mt-1 text-[13px] text-muted-foreground">{t.description}</p>}
        </div>
        <TaskButtons id={t.id} status={t.status} />
      </li>
    );
  };
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/staff", label: "Home" }} title="My tasks" description="Things to do for people joining or leaving, including you." />
      {open.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">{open.map(row)}</ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">Nothing to do. Tasks show here when someone joins or leaves.</p>
      )}
      {done.length > 0 && (
        <section>
          <h2 className="section-label mb-3">done</h2>
          <ul className="divide-y divide-border rounded-xl border border-border">{done.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
