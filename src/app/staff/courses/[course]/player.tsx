"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, ExternalLink, FileText, HelpCircle, Type, Video, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { completeLesson, submitQuiz, type QuizResult } from "@/lib/training/actions";
import { cn } from "@/lib/utils";

export interface PlayerLesson {
  id: string;
  title: string;
  kind: "text" | "video" | "pdf" | "quiz";
  content: string | null;
  videoUrl: string | null;
  pdfUrl: string | null;
  passMark: number;
  done: boolean;
  bestScore: number | null;
  questions: { id: string; question: string; multiple: boolean; options: { id: string; text: string }[] }[];
}

const ICON = { text: Type, video: Video, pdf: FileText, quiz: HelpCircle };

/** YouTube and Vimeo links play inside the lesson; anything else opens in a new tab. */
function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host === "youtube.com") {
      const v = u.searchParams.get("v") ?? (u.pathname.startsWith("/shorts/") || u.pathname.startsWith("/embed/") ? u.pathname.split("/")[2] : null);
      return v ? `https://www.youtube-nocookie.com/embed/${v}` : null;
    }
    if (host === "vimeo.com" && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video/${u.pathname.split("/")[1]}`;
  } catch {
    return null;
  }
  return null;
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-foreground">
      {text
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p.trim()}
          </p>
        ))}
    </div>
  );
}

export function CoursePlayer({ courseId, enrollmentId, lessons }: { courseId: string; enrollmentId: string; lessons: PlayerLesson[] }) {
  // Open the first lesson that isn't done yet.
  const [open, setOpen] = useState<string | null>(lessons.find((l) => !l.done)?.id ?? null);
  const next = (id: string) => {
    const i = lessons.findIndex((l) => l.id === id);
    const after = lessons.slice(i + 1).find((l) => !l.done);
    setOpen(after?.id ?? null);
  };

  return (
    <ol className="space-y-3">
      {lessons.map((l, i) => {
        const Icon = ICON[l.kind];
        const isOpen = open === l.id;
        return (
          <li key={l.id} className="overflow-hidden rounded-xl border border-border">
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", l.done ? "bg-success text-background" : "bg-surface-muted text-muted-foreground")}>
                {l.done ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-foreground">
                  {i + 1}. {l.title}
                </span>
                <span className="block text-[12px] text-subtle-foreground">
                  {l.done ? "Done" : l.kind === "quiz" ? `Quiz · pass mark ${l.passMark}%` : "To do"}
                  {l.bestScore !== null && ` · best score ${l.bestScore}%`}
                </span>
              </span>
              <ChevronDown className={cn("size-4 text-subtle-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
            </button>
            {isOpen && (
              <div className="space-y-4 border-t border-border px-4 py-4">
                {l.kind === "quiz" ? (
                  <Quiz courseId={courseId} enrollmentId={enrollmentId} lesson={l} onPassed={() => next(l.id)} />
                ) : (
                  <>
                    {l.kind === "video" && l.videoUrl && <VideoBlock url={l.videoUrl} title={l.title} />}
                    {l.kind === "pdf" &&
                      (l.pdfUrl ? (
                        <a href={l.pdfUrl} target="_blank" rel="noopener" className={buttonClasses({ variant: "secondary" })}>
                          <FileText className="size-4" aria-hidden /> Open the PDF
                        </a>
                      ) : (
                        <p className="text-sm text-danger">The file couldn&apos;t be found. Tell HR.</p>
                      ))}
                    {l.content && <Paragraphs text={l.content} />}
                    <DoneButton courseId={courseId} enrollmentId={enrollmentId} lesson={l} onDone={() => next(l.id)} />
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function VideoBlock({ url, title }: { url: string; title: string }) {
  const embed = embedUrl(url);
  if (!embed) {
    return (
      <a href={url} target="_blank" rel="noopener" className={buttonClasses({ variant: "secondary" })}>
        <ExternalLink className="size-4" aria-hidden /> Watch the video
      </a>
    );
  }
  return (
    <div className="aspect-video overflow-hidden rounded-lg bg-black">
      <iframe src={embed} title={title} className="size-full" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
    </div>
  );
}

function DoneButton({ courseId, enrollmentId, lesson, onDone }: { courseId: string; enrollmentId: string; lesson: PlayerLesson; onDone: () => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (lesson.done) return <p className="text-[13px] text-subtle-foreground">You&apos;ve done this lesson.</p>;
  return (
    <Button
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await completeLesson(courseId, enrollmentId, lesson.id);
          if (r.error) return void toast.error(r.error);
          onDone();
          router.refresh();
        })
      }
    >
      <Check className="size-4" aria-hidden /> I&apos;ve done this
    </Button>
  );
}

function Quiz({ courseId, enrollmentId, lesson, onPassed }: { courseId: string; enrollmentId: string; lesson: PlayerLesson; onPassed: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const verdict = new Map((result?.results ?? []).map((r) => [r.question_id, r]));
  const unanswered = lesson.questions.filter((q) => !answers[q.id]?.length).length;

  const pick = (qid: string, oid: string, multiple: boolean) => {
    if (result) setResult(null);
    setAnswers((a) => {
      const cur = a[qid] ?? [];
      return { ...a, [qid]: multiple ? (cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid]) : [oid] };
    });
  };

  if (lesson.done && !result) {
    return <p className="text-[13px] text-subtle-foreground">You passed this quiz{lesson.bestScore !== null ? ` with ${lesson.bestScore}%` : ""}.</p>;
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (unanswered) return void toast.error(`Answer every question (${unanswered} left).`);
        start(async () => {
          const r = await submitQuiz(courseId, enrollmentId, lesson.id, answers);
          if (r.error || !r.result) return void toast.error(r.error ?? "Something went wrong.");
          setResult(r.result);
          if (r.result.passed) {
            toast.success(`Passed with ${r.result.score}%.`);
            router.refresh();
          }
        });
      }}
    >
      {lesson.questions.map((q, i) => {
        const v = verdict.get(q.id);
        return (
          <fieldset key={q.id} className="space-y-2">
            <legend className="mb-1 text-[15px] text-foreground">
              {i + 1}. {q.question}
              {q.multiple && <span className="block text-[12px] text-subtle-foreground">Choose all that are right.</span>}
            </legend>
            {q.options.map((o) => {
              const chosen = answers[q.id]?.includes(o.id) ?? false;
              const right = v?.correct_ids?.includes(o.id);
              return (
                <label
                  key={o.id}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                    chosen ? "border-foreground" : "border-border",
                    right && "border-success",
                  )}
                >
                  <input
                    type={q.multiple ? "checkbox" : "radio"}
                    name={q.id}
                    checked={chosen}
                    onChange={() => pick(q.id, o.id, q.multiple)}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  <span className="flex-1">{o.text}</span>
                </label>
              );
            })}
            {v && (
              <p className={cn("flex items-center gap-1.5 text-[13px]", v.correct ? "text-success" : "text-danger")}>
                {v.correct ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                {v.correct ? "Right" : "Not quite"}
                {v.explanation && <span className="text-muted-foreground"> · {v.explanation}</span>}
              </p>
            )}
          </fieldset>
        );
      })}
      {result && !result.passed && (
        <p className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
          You scored {result.score}%. You need {result.pass_mark}% to pass. Change the answers marked &quot;Not quite&quot; and try again.
        </p>
      )}
      {result?.passed ? (
        <Button type="button" onClick={onPassed}>
          Next
        </Button>
      ) : (
        <Button type="submit" loading={pending}>
          Check my answers
        </Button>
      )}
    </form>
  );
}
