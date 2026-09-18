"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitSurvey } from "@/lib/reviews/actions";
import { cn } from "@/lib/utils";

interface Q {
  id: string;
  question: string;
  kind: "scale" | "nps" | "single" | "multiple" | "text";
  options: string[];
  required: boolean;
}
type Value = number | string | string[];

function Numbers({ from, to, value, onChange, label, low, high }: { from: number; to: number; value: number | undefined; onChange: (v: number) => void; label: string; low: string; high: string }) {
  return (
    <div>
      <div className={cn("grid gap-1.5", to - from > 5 ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-5")} role="radiogroup" aria-label={label}>
        {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={cn("h-11 rounded-lg border text-sm tabular", value === n ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[12px] text-subtle-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

export function SurveyForm({ surveyId, questions }: { surveyId: string; questions: Q[] }) {
  const [answers, setAnswers] = useState<Record<string, Value>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (id: string, v: Value) => setAnswers((a) => ({ ...a, [id]: v }));
  const empty = (v: Value | undefined) => v === undefined || v === "" || (Array.isArray(v) && !v.length);

  return (
    <form
      className="space-y-7"
      onSubmit={(e) => {
        e.preventDefault();
        const missing = questions.filter((q) => q.required && empty(answers[q.id])).length;
        if (missing) return void toast.error(`Answer the questions marked as required (${missing} left).`);
        start(async () => {
          const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => !empty(v)).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
          const r = await submitSurvey(surveyId, clean);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Thanks.");
          router.push("/staff/surveys");
        });
      }}
    >
      {questions.map((q, i) => {
        const v = answers[q.id];
        return (
          <fieldset key={q.id} className="space-y-3">
            <legend className="mb-2 text-[15px] text-foreground">
              {i + 1}. {q.question}
              {q.required ? <span className="ml-1 text-[12px] text-subtle-foreground">(required)</span> : <span className="ml-1 text-[12px] text-subtle-foreground">(optional)</span>}
            </legend>
            {q.kind === "scale" && <Numbers from={1} to={5} value={v as number | undefined} onChange={(n) => set(q.id, n)} label={q.question} low="Not at all" high="Very much" />}
            {q.kind === "nps" && <Numbers from={0} to={10} value={v as number | undefined} onChange={(n) => set(q.id, n)} label={q.question} low="Not likely" high="Very likely" />}
            {q.kind === "single" &&
              q.options.map((o) => (
                <label key={o} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", v === o ? "border-foreground" : "border-border")}>
                  <input type="radio" name={q.id} checked={v === o} onChange={() => set(q.id, o)} className="size-4 accent-[var(--color-accent)]" />
                  {o}
                </label>
              ))}
            {q.kind === "multiple" &&
              q.options.map((o) => {
                const list = (v as string[] | undefined) ?? [];
                const on = list.includes(o);
                return (
                  <label key={o} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", on ? "border-foreground" : "border-border")}>
                    <input type="checkbox" checked={on} onChange={() => set(q.id, on ? list.filter((x) => x !== o) : [...list, o])} className="size-4 accent-[var(--color-accent)]" />
                    {o}
                  </label>
                );
              })}
            {q.kind === "text" && <Textarea aria-label={q.question} rows={4} maxLength={4000} value={(v as string | undefined) ?? ""} onChange={(e) => set(q.id, e.target.value)} />}
          </fieldset>
        );
      })}
      <Button type="submit" loading={pending}>
        Send my answers
      </Button>
    </form>
  );
}
