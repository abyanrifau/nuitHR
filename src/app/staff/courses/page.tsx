import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate, formatMoney, localDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PaidTrainingForm } from "./paid-form";

export const metadata: Metadata = { title: "My courses" };

const PAID: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  requested: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Finished", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function StaffCourses() {
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const [{ data: enrollments }, { data: paid }] = await Promise.all([
    supabase
      .from("course_enrollments")
      .select("id, status, progress_percent, due_date, is_mandatory, completed_at, course:courses!inner(id, title, estimated_minutes, status)")
      .eq("employee_id", me.id)
      .eq("courses.status", "published")
      .order("created_at", { ascending: false }),
    supabase
      .from("training_sponsorships")
      .select("id, course_name, provider, start_date, cost, currency, status, bond_end_date")
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const today = localDay(new Date(), active.timezone);
  const all = enrollments ?? [];
  const todo = all.filter((e) => e.status !== "completed");
  const done = all.filter((e) => e.status === "completed");

  const row = (e: (typeof all)[number]) => {
    const c = e.course as unknown as { id: string; title: string; estimated_minutes: number | null };
    const late = e.status !== "completed" && e.due_date && e.due_date < today;
    return (
      <li key={e.id}>
        <Link href={`/staff/courses/${c.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-accent-soft">
          <span className="min-w-0 flex-1">
            <span className="block text-foreground">
              {c.title}
              {e.is_mandatory && e.status !== "completed" && (
                <Badge className="ml-2" tone="warning">
                  Required
                </Badge>
              )}
            </span>
            <span className="block text-[12px] text-subtle-foreground">
              {e.status === "completed"
                ? `Finished ${formatDate(e.completed_at, active.date_format, active.timezone)}`
                : [
                    e.progress_percent ? `${e.progress_percent}% done` : "Not started",
                    c.estimated_minutes ? `about ${c.estimated_minutes} min` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
              {e.due_date && e.status !== "completed" && <span className={cn(late && "text-danger")}> · due {formatDate(e.due_date, active.date_format)}</span>}
            </span>
            {e.status !== "completed" && (
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-muted">
                <span className="block h-full bg-foreground" style={{ width: `${e.progress_percent}%` }} />
              </span>
            )}
          </span>
          <ChevronRight className="size-4 text-subtle-foreground" aria-hidden />
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader back={{ href: "/staff", label: "Home" }} title="My courses" description="Short courses from your company. Take them on your phone, at your own pace." />
      {todo.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">{todo.map(row)}</ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">
          {done.length ? "You've finished all your courses." : "No courses for you yet."}
        </p>
      )}
      {done.length > 0 && (
        <section aria-labelledby="done">
          <h2 id="done" className="section-label mb-3">
            finished
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">{done.map(row)}</ul>
        </section>
      )}
      <section aria-labelledby="paid" className="space-y-3">
        <h2 id="paid" className="section-label">
          paid training
        </h2>
        <p className="text-sm text-muted-foreground">Want the company to pay for an outside course? Ask here and it goes for approval.</p>
        <PaidTrainingForm currency={active.currency} />
        {paid && paid.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {paid.map((p) => {
              const s = PAID[p.status] ?? PAID.requested;
              return (
                <li key={p.id} className="px-4 py-3">
                  <p className="text-foreground">{p.course_name}</p>
                  <p className="text-[12px] text-subtle-foreground">
                    {p.provider} · {formatMoney(p.cost, p.currency)}
                    {p.start_date && ` · starts ${formatDate(p.start_date, active.date_format)}`}
                  </p>
                  <p className="mt-1.5">
                    <StatusDot tone={s.tone}>{s.label}</StatusDot>
                  </p>
                  {p.bond_end_date && p.bond_end_date >= today && (
                    <p className="mt-1 text-[12px] text-subtle-foreground">You agreed to stay until {formatDate(p.bond_end_date, active.date_format)}.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
