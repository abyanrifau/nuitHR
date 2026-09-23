import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadOrgOptions } from "@/lib/people/org-options";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { CourseForm } from "../course-form";
import { AssignPanel, CourseStatusButtons, LessonsEditor, type LessonRow } from "./course-client";

export const metadata: Metadata = { title: "Course" };

const TABS = [
  { key: "lessons", label: "Lessons" },
  { key: "people", label: "People" },
  { key: "details", label: "Details" },
];

const ENROLL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Finished", tone: "success" },
  failed: { label: "Didn't pass", tone: "danger" },
};

export default async function CoursePage(props: PageProps<"/app/training/[course]">) {
  const { course: id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "lessons";
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "learning", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to manage courses.
      </Alert>
    );
  }
  const supabase = await createClient();
  // The course and its lessons (with each question's answer) together.
  const [{ data: c }, lessonsRes] = await Promise.all([
    supabase.from("courses").select("*").eq("id", id).eq("business_id", active.business_id).maybeSingle(),
    tab === "lessons"
      ? supabase
          .from("course_lessons")
          .select("id, title, kind, content, video_url, file_path, pass_mark, sort, questions:quiz_questions(id, question, kind, options, sort, key:quiz_answer_keys(correct_option_ids, explanation))")
          .eq("course_id", id)
          .order("sort")
      : null,
  ]);
  if (!c) notFound();
  const canEdit = can(ctx, "learning", "edit");
  const statusLabel = c.status === "published" ? "Live" : c.status === "draft" ? "Draft, not visible to staff yet" : "Archived";

  let body: React.ReactNode = null;
  if (tab === "lessons") {
    const lessons = lessonsRes?.data;
    type Key = { correct_option_ids: string[]; explanation: string | null };
    const keyFor = new Map(
      (lessons ?? []).flatMap((l) => ((l.questions ?? []) as unknown as { id: string; key: Key | Key[] | null }[]).map((q) => [q.id, Array.isArray(q.key) ? q.key[0] : q.key] as const)),
    );
    const rows: LessonRow[] = (lessons ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      kind: l.kind as LessonRow["kind"],
      content: l.content,
      video_url: l.video_url,
      file_path: l.file_path,
      pass_mark: l.pass_mark,
      questions: ((l.questions ?? []) as { id: string; question: string; kind: string; options: { id: string; text: string }[]; sort: number }[])
        .sort((a, b) => a.sort - b.sort)
        .map((q) => ({
          id: q.id,
          question: q.question,
          kind: q.kind as "single" | "multiple" | "true_false",
          options: q.options,
          correct: keyFor.get(q.id)?.correct_option_ids ?? [],
          explanation: keyFor.get(q.id)?.explanation ?? "",
        })),
    }));
    body = <LessonsEditor courseId={id} businessId={active.business_id} lessons={rows} canEdit={canEdit} coursePassMark={c.pass_mark} />;
  } else if (tab === "people") {
    const today = localDay(new Date(), active.timezone);
    const [{ data: assignments }, { data: enrollments }, org, { data: people }] = await Promise.all([
      supabase.from("course_assignments").select("id, target_type, target_id, due_date, is_mandatory, created_at").eq("course_id", id).order("created_at"),
      supabase
        .from("course_enrollments")
        .select("id, status, progress_percent, score, due_date, completed_at, employee:employees(id, first_name, last_name, employee_code)")
        .eq("course_id", id)
        .order("created_at"),
      loadOrgOptions(supabase, active.business_id),
      supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave"]).order("first_name").limit(3000),
    ]);
    const peopleOpts = (people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() + ` · ${p.employee_code}` }));
    const nameFor = (type: string, target: string | null) => {
      if (type === "everyone") return "Everyone";
      const list = type === "department" ? org.departments : type === "branch" ? org.branches : type === "position" ? org.positions : peopleOpts;
      const label = list.find((o) => o.value === target)?.label ?? "Removed";
      return { department: "Department: ", branch: "Location: ", position: "Job: ", employee: "" }[type as "department"] + label;
    };
    body = (
      <div className="space-y-8">
        <AssignPanel
          courseId={id}
          published={c.status === "published"}
          canEdit={canEdit}
          options={{ people: peopleOpts, departments: org.departments, branches: org.branches, positions: org.positions }}
          assignments={(assignments ?? []).map((a) => ({ id: a.id, label: nameFor(a.target_type, a.target_id), due: a.due_date ? formatDate(a.due_date, active.date_format) : null, required: a.is_mandatory }))}
        />
        <section>
          <h2 className="mb-3 text-lg">Progress</h2>
          {enrollments?.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Progress</Th>
                  <Th>Quiz score</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => {
                  const p = e.employee as unknown as { id: string; first_name: string; last_name: string; employee_code: string };
                  const late = e.status !== "completed" && e.due_date && e.due_date < today;
                  const s = ENROLL[e.status] ?? ENROLL.not_started;
                  return (
                    <Tr key={e.id}>
                      <Td>
                        <Link href={`/app/people/${p.id}`} className="text-foreground underline-offset-4 hover:underline">
                          {`${p.first_name} ${p.last_name}`.trim()}
                        </Link>
                      </Td>
                      <Td className="tabular">{e.progress_percent}%</Td>
                      <Td className="tabular">{e.score === null ? "—" : `${e.score}%`}</Td>
                      <Td className={cn("tabular", late && "text-danger")}>{formatDate(e.due_date, active.date_format)}</Td>
                      <Td>
                        <StatusDot tone={late ? "danger" : s.tone}>{late ? "Overdue" : s.label}</StatusDot>
                        {e.completed_at && <span className="block text-[12px] text-subtle-foreground">{formatDate(e.completed_at, active.date_format, active.timezone)}</span>}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">Nobody has this course yet.</p>
          )}
        </section>
      </div>
    );
  } else {
    body = canEdit ? (
      <CourseForm
        values={{
          id: c.id,
          title: c.title,
          description: c.description,
          category: c.category,
          estimated_minutes: c.estimated_minutes,
          pass_mark: c.pass_mark,
          is_mandatory: c.is_mandatory,
          certificate_enabled: c.certificate_enabled,
        }}
      />
    ) : (
      <p className="text-sm text-muted-foreground">{c.description || "No description."}</p>
    );
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/app/training", label: "Training" }}
        title={c.title}
        description={statusLabel}
        actions={canEdit ? <CourseStatusButtons id={c.id} status={c.status} /> : undefined}
      />
      <nav className="mb-6 flex gap-5 border-b border-border text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/app/training/${id}?tab=${t.key}`}
            className={cn("-mb-px border-b-2 pb-2.5", tab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}
