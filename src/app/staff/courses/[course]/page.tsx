import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Award } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate } from "@/lib/format";
import { CoursePlayer, type PlayerLesson } from "./player";

export const metadata: Metadata = { title: "Course" };

export default async function StaffCourse(props: PageProps<"/staff/courses/[course]">) {
  const { course: id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const { data: en } = await supabase
    .from("course_enrollments")
    .select("id, status, progress_percent, score, due_date, completed_at, course:courses(id, title, description, pass_mark, certificate_enabled, status)")
    .eq("employee_id", me.id)
    .eq("course_id", id)
    .maybeSingle();
  const course = en?.course as unknown as { id: string; title: string; description: string; pass_mark: number; certificate_enabled: boolean; status: string } | null;
  if (!en || !course || course.status !== "published") notFound();

  const [{ data: lessons }, { data: progress }, { data: attempts }] = await Promise.all([
    supabase.from("course_lessons").select("id, title, kind, content, video_url, file_path, pass_mark, sort, questions:quiz_questions(id, question, kind, options, sort)").eq("course_id", id).order("sort"),
    supabase.from("lesson_progress").select("lesson_id").eq("enrollment_id", en.id),
    supabase.from("quiz_attempts").select("lesson_id, score, passed").eq("enrollment_id", en.id),
  ]);
  const done = new Set((progress ?? []).map((p) => p.lesson_id));
  const pdfPaths = (lessons ?? []).filter((l) => l.kind === "pdf" && l.file_path).map((l) => l.file_path!);
  const { data: signed } = pdfPaths.length ? await supabase.storage.from("tenant-files").createSignedUrls(pdfPaths, 3600) : { data: [] };
  const urlFor = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const rows: PlayerLesson[] = (lessons ?? []).map((l) => {
    const tries = (attempts ?? []).filter((a) => a.lesson_id === l.id);
    return {
      id: l.id,
      title: l.title,
      kind: l.kind as PlayerLesson["kind"],
      content: l.content,
      videoUrl: l.video_url,
      pdfUrl: l.file_path ? (urlFor.get(l.file_path) ?? null) : null,
      passMark: l.pass_mark ?? course.pass_mark,
      done: done.has(l.id),
      bestScore: tries.length ? Math.max(...tries.map((t) => t.score)) : null,
      questions: ((l.questions ?? []) as { id: string; question: string; kind: string; options: { id: string; text: string }[]; sort: number }[])
        .sort((a, b) => a.sort - b.sort)
        .map((q) => ({ id: q.id, question: q.question, multiple: q.kind === "multiple", options: q.options })),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/staff/courses", label: "My courses" }}
        title={course.title}
        description={
          en.status === "completed"
            ? `Finished ${formatDate(en.completed_at, active.date_format, active.timezone)}${en.score !== null ? ` · quiz score ${en.score}%` : ""}`
            : `${en.progress_percent}% done${en.due_date ? ` · due ${formatDate(en.due_date, active.date_format)}` : ""}`
        }
      />
      {course.description && <p className="text-sm text-muted-foreground">{course.description}</p>}
      {en.status === "completed" && (
        <Alert tone="success" title="Well done, you finished this course">
          {course.certificate_enabled && (
            <a href={`/staff/courses/${id}/certificate`} className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-2" })}>
              <Award className="size-4" aria-hidden /> Your certificate
            </a>
          )}
        </Alert>
      )}
      <CoursePlayer courseId={id} enrollmentId={en.id} lessons={rows} />
      <p className="text-center text-[13px]">
        <Link href="/staff/courses" className="text-muted-foreground underline underline-offset-4">
          Back to my courses
        </Link>
      </p>
    </div>
  );
}
