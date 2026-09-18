"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { saveReview } from "@/lib/reviews/actions";
import { cn } from "@/lib/utils";

export interface ReviewQuestion {
  id: string;
  section: string | null;
  question: string;
  kind: "rating" | "text" | "rating_text";
  is_required: boolean;
}
export interface ReviewAnswer {
  rating: number | null;
  answer: string | null;
}
export type Scale = { value: number; label: string }[];

/** Ratings 1 to 5 as a row of buttons, with the label of the chosen one. */
function Rating({ value, onChange, scale, disabled, label }: { value: number | null; onChange?: (v: number) => void; scale: Scale; disabled?: boolean; label: string }) {
  return (
    <div>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {scale.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={value === s.value}
            aria-label={`${s.value}: ${s.label}`}
            title={s.label}
            disabled={disabled}
            onClick={() => onChange?.(s.value)}
            className={cn(
              "grid size-10 place-items-center rounded-lg border text-sm tabular transition-colors",
              value === s.value ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
              !disabled && value !== s.value && "hover:border-border-strong",
            )}
          >
            {s.value}
          </button>
        ))}
      </div>
      <p className="mt-1 h-4 text-[12px] text-subtle-foreground">{value ? scale.find((s) => s.value === value)?.label : ""}</p>
    </div>
  );
}

/** Read-only answer from the other side (the person's self review, or the manager's). */
function Answer({ who, a, scale }: { who: string; a: ReviewAnswer | undefined; scale: Scale }) {
  if (!a || (a.rating === null && !a.answer)) return <p className="text-[13px] text-subtle-foreground">{who}: no answer.</p>;
  return (
    <div className="rounded-lg bg-surface-muted px-3 py-2 text-[13px]">
      <p className="text-subtle-foreground">{who}</p>
      {a.rating !== null && (
        <p className="text-foreground">
          <span className="tabular">{a.rating}</span> · {scale.find((s) => s.value === a.rating)?.label}
        </p>
      )}
      {a.answer && <p className="whitespace-pre-line text-foreground">{a.answer}</p>}
    </div>
  );
}

export function ReviewForm({
  reviewId,
  role,
  questions,
  scale,
  mine,
  other,
  otherLabel,
  editable,
  manager,
}: {
  reviewId: string;
  role: "self" | "manager";
  questions: ReviewQuestion[];
  scale: Scale;
  mine: Record<string, ReviewAnswer>;
  other?: Record<string, ReviewAnswer>;
  otherLabel?: string;
  editable: boolean;
  manager?: { overall: number | null; summary: string; meetingNotes: string };
}) {
  const [answers, setAnswers] = useState<Record<string, ReviewAnswer>>(mine);
  const [overall, setOverall] = useState<number | null>(manager?.overall ?? null);
  const [summary, setSummary] = useState(manager?.summary ?? "");
  const [notes, setNotes] = useState(manager?.meetingNotes ?? "");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const set = (id: string, patch: Partial<ReviewAnswer>) => setAnswers((a) => ({ ...a, [id]: { ...(a[id] ?? { rating: null, answer: null }), ...patch } }));
  const send = (submit: boolean) =>
    start(async () => {
      const r = await saveReview(reviewId, {
        answers: questions.map((q) => ({ question_id: q.id, rating: answers[q.id]?.rating ?? null, answer: answers[q.id]?.answer?.trim() || null })),
        submit,
        overall,
        summary,
        meetingNotes: notes,
      });
      setConfirm(false);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Saved.");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      {questions.map((q, i) => {
        const header = q.section && q.section !== questions[i - 1]?.section ? q.section : null;
        const a = answers[q.id];
        return (
          <div key={q.id} className="space-y-3">
            {header && <h2 className="section-label pt-2">{header.toLowerCase()}</h2>}
            <p className="text-[15px] text-foreground">
              {q.question}
              {!q.is_required && <span className="ml-1 text-[12px] text-subtle-foreground">(optional)</span>}
            </p>
            {other && <Answer who={otherLabel ?? "Them"} a={other[q.id]} scale={scale} />}
            {q.kind !== "text" && <Rating label={q.question} value={a?.rating ?? null} scale={scale} disabled={!editable} onChange={(v) => set(q.id, { rating: v })} />}
            {q.kind !== "rating" &&
              (editable ? (
                <Textarea
                  aria-label={`${q.question}, comments`}
                  rows={3}
                  value={a?.answer ?? ""}
                  onChange={(e) => set(q.id, { answer: e.target.value })}
                  placeholder={q.kind === "rating_text" ? "Add a comment or example" : undefined}
                />
              ) : (
                a?.answer && <p className="whitespace-pre-line text-sm text-foreground">{a.answer}</p>
              ))}
          </div>
        );
      })}

      {role === "manager" && (
        <div className="space-y-4 border-t border-border pt-6">
          <div className="space-y-2">
            <p className="text-[15px] text-foreground">Overall rating</p>
            <Rating label="Overall rating" value={overall} scale={scale} disabled={!editable} onChange={setOverall} />
          </div>
          <Field label="Summary for them" htmlFor="rv-summary" optional>
            <Textarea id="rv-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Notes from your conversation" htmlFor="rv-notes" optional hint="They see these too, once you share the review.">
            <Textarea id="rv-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
          </Field>
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setConfirm(true)} disabled={pending}>
            {role === "self" ? "Send to my manager" : "Finish review"}
          </Button>
          <Button variant="secondary" loading={pending} onClick={() => send(false)}>
            Save for later
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={role === "self" ? "Send your review?" : "Finish this review?"}
        confirmLabel={role === "self" ? "Send" : "Finish"}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => send(true)}
      >
        {role === "self" ? "You can't change your answers after sending." : "You can share it with them afterwards."}
      </ConfirmDialog>
    </div>
  );
}
