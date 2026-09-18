"use client";

import { useState, useTransition } from "react";
import { saveAnswers } from "@/lib/onboarding/actions";
import { SETUP_QUESTIONS, isComplete } from "@/modules/setup-questions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One question per card; each answer is a single tap. */
export function QuestionsForm({ initial }: { initial: Record<string, string> }) {
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const answered = SETUP_QUESTIONS.filter((q) => answers[q.key]).length;

  return (
    <div className="space-y-4">
      <ol className="grid gap-3 md:grid-cols-2">
        {SETUP_QUESTIONS.map((q, i) => (
          <li
            key={q.key}
            className={cn("rounded-xl border bg-surface p-5 transition-colors", answers[q.key] ? "border-border-strong" : "border-border")}
          >
            <fieldset>
              <legend className="w-full">
                <span className="font-display text-[13px] text-subtle-foreground tabular">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-display mt-2 block text-lg leading-snug text-foreground">{q.question}</span>
                {q.hint && <span className="mt-1 block text-[13px] text-subtle-foreground">{q.hint}</span>}
              </legend>
              <div className="mt-4 flex flex-wrap gap-2">
                {q.options.map((o) => {
                  const on = answers[q.key] === o.value;
                  return (
                    <label
                      key={o.value}
                      className={cn(
                        "cursor-pointer rounded-lg border px-3.5 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]",
                        on ? "border-foreground bg-foreground text-background" : "border-border-strong text-foreground hover:border-foreground/40",
                      )}
                    >
                      <input
                        type="radio"
                        name={q.key}
                        value={o.value}
                        checked={on}
                        onChange={() => setAnswers((a) => ({ ...a, [q.key]: o.value }))}
                        className="sr-only"
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <p className="text-[13px] text-subtle-foreground tabular">
          {answered} of {SETUP_QUESTIONS.length} answered
        </p>
        <Button
          size="lg"
          loading={pending}
          disabled={!isComplete(answers)}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await saveAnswers(answers);
              if (r?.error) setError(r.error);
            })
          }
        >
          See my recommended tools
        </Button>
      </div>
    </div>
  );
}
