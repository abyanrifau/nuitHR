"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, FileText, HelpCircle, Pencil, Plus, Trash2, Type, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  assignCourse,
  deleteCourse,
  deleteLesson,
  deleteQuestion,
  moveLesson,
  removeAssignment,
  saveLesson,
  saveQuestion,
  setCourseStatus,
} from "@/lib/training/actions";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };
type Kind = "text" | "video" | "pdf" | "quiz";
export interface QuestionRow {
  id: string;
  question: string;
  kind: "single" | "multiple" | "true_false";
  options: { id: string; text: string }[];
  correct: string[];
  explanation: string;
}
export interface LessonRow {
  id: string;
  title: string;
  kind: Kind;
  content: string | null;
  video_url: string | null;
  file_path: string | null;
  pass_mark: number | null;
  questions: QuestionRow[];
}

const KINDS: { value: Kind; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "video", label: "Video link", icon: Video },
  { value: "pdf", label: "PDF", icon: FileText },
  { value: "quiz", label: "Quiz", icon: HelpCircle },
];

// ---------------------------------------------------------------------
// Publish / archive
// ---------------------------------------------------------------------
export function CourseStatusButtons({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const router = useRouter();
  const set = (s: "draft" | "published" | "archived") =>
    start(async () => {
      const r = await setCourseStatus(id, s);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Saved.");
      router.refresh();
    });
  return (
    <>
      {status === "draft" && (
        <>
          <Button variant="ghost" disabled={pending} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          <Button loading={pending} onClick={() => set("published")}>
            Publish
          </Button>
        </>
      )}
      {status === "published" && (
        <Button variant="secondary" loading={pending} onClick={() => set("archived")}>
          Archive
        </Button>
      )}
      {status === "archived" && (
        <Button variant="secondary" loading={pending} onClick={() => set("published")}>
          Make live again
        </Button>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this course?"
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const r = await deleteCourse(id);
          setConfirmDelete(false);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Deleted.");
          router.push("/app/training");
        }}
      >
        Its lessons and quizzes are deleted too.
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------
export function LessonsEditor({
  courseId,
  businessId,
  lessons,
  canEdit,
  coursePassMark,
}: {
  courseId: string;
  businessId: string;
  lessons: LessonRow[];
  canEdit: boolean;
  coursePassMark: number;
}) {
  const [editing, setEditing] = useState<LessonRow | "new" | null>(null);
  const [removing, setRemoving] = useState<LessonRow | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const move = (l: LessonRow, d: -1 | 1) =>
    start(async () => {
      const r = await moveLesson(courseId, l.id, d);
      if (r.error) toast.error(r.error);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {lessons.length ? (
        <ol className="space-y-3">
          {lessons.map((l, i) => {
            const K = KINDS.find((k) => k.value === l.kind)!;
            return (
              <li key={l.id} className="rounded-xl border border-border">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted-foreground">
                    <K.icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">
                      {i + 1}. {l.title}
                    </p>
                    <p className="text-[12px] text-subtle-foreground">
                      {K.label}
                      {l.kind === "quiz" && ` · ${l.questions.length} ${l.questions.length === 1 ? "question" : "questions"} · pass mark ${l.pass_mark ?? coursePassMark}%`}
                    </p>
                  </div>
                  {canEdit && (
                    <span className="flex shrink-0">
                      <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0 || pending} onClick={() => move(l, -1)}>
                        <ArrowUp className="size-3.5" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === lessons.length - 1 || pending} onClick={() => move(l, 1)}>
                        <ArrowDown className="size-3.5" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Edit ${l.title}`} onClick={() => setEditing(l)}>
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Remove ${l.title}`} onClick={() => setRemoving(l)}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </span>
                  )}
                </div>
                {l.kind === "quiz" && <QuizQuestions courseId={courseId} lesson={l} canEdit={canEdit} />}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">No lessons yet. Add the first one.</p>
      )}
      {canEdit && (
        <Button variant="secondary" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden /> Add a lesson
        </Button>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add a lesson" : "Edit lesson"}>
        {editing !== null && (
          <LessonForm
            courseId={courseId}
            businessId={businessId}
            lesson={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove "${removing?.title}"?`}
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deleteLesson(courseId, removing!.id);
          setRemoving(null);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Removed.");
          router.refresh();
        }}
      >
        People who already finished it keep their progress for the rest of the course.
      </ConfirmDialog>
    </div>
  );
}

function LessonForm({ courseId, businessId, lesson, onDone }: { courseId: string; businessId: string; lesson: LessonRow | null; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>(lesson?.kind ?? "text");
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [content, setContent] = useState(lesson?.content ?? "");
  const [videoUrl, setVideoUrl] = useState(lesson?.video_url ?? "");
  const [passMark, setPassMark] = useState(lesson?.pass_mark?.toString() ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      let filePath = lesson?.file_path ?? "";
      if (kind === "pdf" && file) {
        if (file.type !== "application/pdf") return setError("Choose a PDF file.");
        if (file.size > 20 * 1024 * 1024) return setError("The PDF must be smaller than 20 MB.");
        filePath = `${businessId}/learning/${courseId}/${crypto.randomUUID()}.pdf`;
        const { error: up } = await createClient().storage.from("tenant-files").upload(filePath, file, { contentType: "application/pdf" });
        if (up) return setError("The PDF didn't upload. Check your connection and try again.");
      }
      const r = await saveLesson(courseId, lesson?.id ?? null, { title, kind, content, video_url: videoUrl, file_path: filePath, pass_mark: passMark });
      if (r.error) return setError(r.error);
      toast.success(r.message ?? "Saved.");
      onDone();
    });

  return (
    <div className="space-y-4">
      {!lesson && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Type of lesson">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[13px]",
                kind === k.value ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:border-border-strong",
              )}
            >
              <k.icon className="size-4" aria-hidden />
              {k.label}
            </button>
          ))}
        </div>
      )}
      <Field label="Title" htmlFor="ls-title">
        <Input id="ls-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example Keeping food cold" />
      </Field>
      {kind === "text" && (
        <Field label="Lesson" htmlFor="ls-content" hint="Plain text. Leave an empty line between paragraphs.">
          <Textarea id="ls-content" rows={10} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
      )}
      {kind === "video" && (
        <>
          <Field label="Video link" htmlFor="ls-video" hint="A YouTube or Vimeo link works best.">
            <Input id="ls-video" type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          </Field>
          <Field label="Notes under the video" htmlFor="ls-notes" optional>
            <Textarea id="ls-notes" rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
          </Field>
        </>
      )}
      {kind === "pdf" && (
        <>
          <Field label="PDF" htmlFor="ls-file" hint={lesson?.file_path ? "Choose a new file only if you want to replace it. Up to 20 MB." : "Up to 20 MB."}>
            <input
              id="ls-file"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-foreground"
            />
          </Field>
          <Field label="Notes" htmlFor="ls-notes2" optional>
            <Textarea id="ls-notes2" rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
          </Field>
        </>
      )}
      {kind === "quiz" && (
        <Field label="Pass mark (%)" htmlFor="ls-pass" optional hint="Leave empty to use the course pass mark. You add questions after saving.">
          <Input id="ls-pass" type="number" min={0} max={100} value={passMark} onChange={(e) => setPassMark(e.target.value)} className="w-28" />
        </Field>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button loading={pending} onClick={save}>
        Save lesson
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Quiz questions
// ---------------------------------------------------------------------
const LETTERS = "abcdefgh";

function QuizQuestions({ courseId, lesson, canEdit }: { courseId: string; lesson: LessonRow; canEdit: boolean }) {
  const [editing, setEditing] = useState<QuestionRow | "new" | null>(null);
  const [removing, setRemoving] = useState<QuestionRow | null>(null);
  const router = useRouter();
  return (
    <div className="border-t border-border px-4 py-3">
      {lesson.questions.length ? (
        <ol className="space-y-2">
          {lesson.questions.map((q, i) => (
            <li key={q.id} className="flex items-start gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-foreground">
                  {i + 1}. {q.question}
                </p>
                <p className="text-[12px] text-subtle-foreground">
                  Right answer: {q.options.filter((o) => q.correct.includes(o.id)).map((o) => o.text).join(", ") || "not set"}
                </p>
              </div>
              {canEdit && (
                <span className="flex shrink-0">
                  <Button variant="ghost" size="sm" aria-label="Edit question" onClick={() => setEditing(q)}>
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Remove question" onClick={() => setRemoving(q)}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-warning">No questions yet. The course can&apos;t be published until this quiz has at least one.</p>
      )}
      {canEdit && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" aria-hidden /> Add a question
        </Button>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add a question" : "Edit question"}>
        {editing !== null && (
          <QuestionForm
            courseId={courseId}
            lessonId={lesson.id}
            question={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this question?"
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deleteQuestion(courseId, removing!.id);
          setRemoving(null);
          if (r.error) return void toast.error(r.error);
          router.refresh();
        }}
      >
        {removing?.question}
      </ConfirmDialog>
    </div>
  );
}

function QuestionForm({ courseId, lessonId, question, onDone }: { courseId: string; lessonId: string; question: QuestionRow | null; onDone: () => void }) {
  const [kind, setKind] = useState<QuestionRow["kind"]>(question?.kind ?? "single");
  const [text, setText] = useState(question?.question ?? "");
  const [options, setOptions] = useState<{ id: string; text: string }[]>(
    question?.options ?? [
      { id: "a", text: "" },
      { id: "b", text: "" },
    ],
  );
  const [correct, setCorrect] = useState<string[]>(question?.correct ?? []);
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const changeKind = (k: QuestionRow["kind"]) => {
    setKind(k);
    if (k === "true_false") {
      setOptions([
        { id: "a", text: "True" },
        { id: "b", text: "False" },
      ]);
      setCorrect([]);
    } else if (k === "single" && correct.length > 1) setCorrect(correct.slice(0, 1));
  };
  const toggle = (id: string) => setCorrect((c) => (kind === "multiple" ? (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]) : [id]));
  const addOption = () => {
    const used = new Set(options.map((o) => o.id));
    const id = [...LETTERS].find((l) => !used.has(l));
    if (id) setOptions([...options, { id, text: "" }]);
  };

  return (
    <div className="space-y-4">
      <Field label="Type" htmlFor="qq-kind">
        <Select
          id="qq-kind"
          value={kind}
          onChange={(e) => changeKind(e.target.value as QuestionRow["kind"])}
          options={[
            { value: "single", label: "One right answer" },
            { value: "multiple", label: "Several right answers" },
            { value: "true_false", label: "True or false" },
          ]}
        />
      </Field>
      <Field label="Question" htmlFor="qq-text">
        <Input id="qq-text" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm text-foreground">Answers · tick the right {kind === "multiple" ? "ones" : "one"}</legend>
        {options.map((o, i) => (
          <div key={o.id} className="flex items-center gap-2">
            <input
              type={kind === "multiple" ? "checkbox" : "radio"}
              name="qq-correct"
              checked={correct.includes(o.id)}
              onChange={() => toggle(o.id)}
              aria-label={`Answer ${i + 1} is right`}
              className="size-4 accent-[var(--color-accent)]"
            />
            <Input
              aria-label={`Answer ${i + 1}`}
              value={o.text}
              disabled={kind === "true_false"}
              onChange={(e) => setOptions(options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))}
            />
            {kind !== "true_false" && options.length > 2 && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove answer ${i + 1}`}
                onClick={() => {
                  setOptions(options.filter((x) => x.id !== o.id));
                  setCorrect(correct.filter((x) => x !== o.id));
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {kind !== "true_false" && options.length < 8 && (
          <Button variant="ghost" size="sm" onClick={addOption}>
            <Plus className="size-3.5" aria-hidden /> Add an answer
          </Button>
        )}
      </fieldset>
      <Field label="Why it's right" htmlFor="qq-why" optional hint="Shown once they pass.">
        <Input id="qq-why" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await saveQuestion(courseId, lessonId, question?.id ?? null, { question: text, kind, options, correct, explanation });
            if (r.error) return setError(r.error);
            toast.success(r.message ?? "Saved.");
            onDone();
          })
        }
      >
        Save question
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Assign
// ---------------------------------------------------------------------
type TargetType = "everyone" | "employee" | "department" | "position" | "branch";

export function AssignPanel({
  courseId,
  published,
  canEdit,
  options,
  assignments,
}: {
  courseId: string;
  published: boolean;
  canEdit: boolean;
  options: { people: Opt[]; departments: Opt[]; branches: Opt[]; positions: Opt[] };
  assignments: { id: string; label: string; due: string | null; required: boolean }[];
}) {
  const [type, setType] = useState<TargetType>("department");
  const [target, setTarget] = useState("");
  const [due, setDue] = useState("");
  const [required, setRequired] = useState(false);
  const [pending, start] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);
  const router = useRouter();
  const list = type === "employee" ? options.people : type === "department" ? options.departments : type === "branch" ? options.branches : type === "position" ? options.positions : [];

  return (
    <section className="space-y-4">
      <h2 className="text-lg">Who takes it</h2>
      {assignments.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                {a.label}
                {a.required && (
                  <Badge className="ml-2" tone="warning">
                    Required
                  </Badge>
                )}
                {a.due && <span className="block text-[12px] text-subtle-foreground">Due {a.due}</span>}
              </span>
              {canEdit && (
                <Button variant="ghost" size="sm" aria-label={`Remove ${a.label}`} onClick={() => setRemoving(a.id)}>
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (published ? (
          <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[10rem_1fr_10rem]">
            <Field label="Give it to" htmlFor="as-type">
              <Select
                id="as-type"
                value={type}
                onChange={(e) => (setType(e.target.value as TargetType), setTarget(""))}
                options={[
                  { value: "department", label: "A department" },
                  { value: "position", label: "A job" },
                  { value: "branch", label: "A location" },
                  { value: "employee", label: "One person" },
                  { value: "everyone", label: "Everyone" },
                ]}
              />
            </Field>
            {type !== "everyone" ? (
              <Field label="Which" htmlFor="as-target">
                <Select id="as-target" value={target} onChange={(e) => setTarget(e.target.value)} options={list} placeholder="Choose" />
              </Field>
            ) : (
              <p className="self-end pb-2.5 text-[13px] text-subtle-foreground">Everyone on staff now, and everyone who joins later.</p>
            )}
            <Field label="Due by" htmlFor="as-due" optional>
              <Input id="as-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-4 accent-[var(--color-accent)]" /> Required
            </label>
            <div className="sm:col-span-3">
              <Button
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await assignCourse(courseId, { target_type: type, target_id: target, due_date: due, is_mandatory: required });
                    if (r.error) return void toast.error(r.error);
                    toast.success(r.message ?? "Assigned.");
                    setTarget("");
                    router.refresh();
                  })
                }
              >
                Assign
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">Publish the course first, then assign it here.</p>
        ))}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Stop assigning to this group?"
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await removeAssignment(courseId, removing!);
          setRemoving(null);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Removed.");
          router.refresh();
        }}
      >
        People who already have the course keep it. New joiners won&apos;t get it.
      </ConfirmDialog>
    </section>
  );
}
