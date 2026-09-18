import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Training" };

const STATUS = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Live", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
} as const;

export default async function TrainingPage(props: PageProps<"/app/training">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "learning", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to manage courses. Your own courses are in the staff app.
      </Alert>
    );
  }
  const showArchived = sp.show === "archived";
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, category, status, is_mandatory, estimated_minutes, lessons:course_lessons(id), enrollments:course_enrollments(status, due_date)")
    .eq("business_id", active.business_id)
    .in("status", showArchived ? ["archived"] : ["draft", "published"])
    .order("status", { ascending: false })
    .order("title");
  const today = localDay(new Date(), active.timezone);

  return (
    <div>
      <PageHeader
        label="grow"
        title="Training"
        description="Short courses staff take on their phone. Assign them to a person, a team, a job or everyone, and see who has finished."
        actions={
          <>
            {can(ctx, "sponsorships", "view", "team") && (
              <Link href="/app/training/paid" className={buttonClasses({ variant: "secondary" })}>
                <Wallet className="size-4" aria-hidden /> Paid training
              </Link>
            )}
            {can(ctx, "learning", "create") && (
              <Link href="/app/training/new" className={buttonClasses()}>
                <Plus className="size-4" aria-hidden /> New course
              </Link>
            )}
          </>
        }
      />
      <nav className="mb-6 flex gap-2 text-[13px]">
        <Link href="/app/training" className={cn("rounded-full border px-3 py-1", !showArchived ? "border-foreground" : "border-border text-muted-foreground")}>
          Courses
        </Link>
        <Link href="/app/training?show=archived" className={cn("rounded-full border px-3 py-1", showArchived ? "border-foreground" : "border-border text-muted-foreground")}>
          Archived
        </Link>
      </nav>
      {courses?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Course</Th>
              <Th>Lessons</Th>
              <Th>Finished</Th>
              <Th>Overdue</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => {
              const en = (c.enrollments ?? []) as { status: string; due_date: string | null }[];
              const done = en.filter((e) => e.status === "completed").length;
              const late = en.filter((e) => e.status !== "completed" && e.due_date && e.due_date < today).length;
              const s = STATUS[c.status as keyof typeof STATUS];
              return (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`/app/training/${c.id}`} className="text-foreground underline-offset-4 hover:underline">
                      {c.title}
                    </Link>
                    <span className="block text-[12px] text-subtle-foreground">
                      {[c.category, c.estimated_minutes ? `${c.estimated_minutes} min` : null].filter(Boolean).join(" · ")}
                      {c.is_mandatory && (
                        <Badge className="ml-1" tone="warning">
                          Required
                        </Badge>
                      )}
                    </span>
                  </Td>
                  <Td className="tabular">{(c.lessons ?? []).length}</Td>
                  <Td className="tabular">
                    {done} of {en.length}
                  </Td>
                  <Td className={cn("tabular", late > 0 && "text-danger")}>{late}</Td>
                  <Td>
                    <StatusDot tone={s.tone}>{s.label}</StatusDot>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title={showArchived ? "No archived courses" : "No courses yet"}
          description={showArchived ? undefined : "Make a short course, for example food safety or how to greet guests."}
          action={
            !showArchived && can(ctx, "learning", "create") ? (
              <Link href="/app/training/new" className={buttonClasses()}>
                New course
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
