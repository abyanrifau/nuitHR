"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { MODULE_MAP } from "@/modules/registry";
import { recommendTools, SETUP_QUESTIONS, type SetupAnswers } from "@/modules/setup-questions";
import { cn } from "@/lib/utils";

const DEMO_KEYS = ["work_pattern", "reimburse", "permits"];

/** Three real setup questions; answering one shows the tool it recommends. */
export function SetupDemo() {
  const [answers, setAnswers] = useState<SetupAnswers>({});
  const questions = SETUP_QUESTIONS.filter((q) => DEMO_KEYS.includes(q.key));
  const recs = recommendTools(answers);

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {questions.map((q, i) => {
        const rec = recs.find((r) =>
          q.key === "work_pattern" ? r.key === "attendance" : q.key === "reimburse" ? r.key === "claims" : r.key === "compliance",
        );
        return (
          <div
            key={q.key}
            className={cn(
              "flex flex-col rounded-xl border bg-surface p-5 transition-colors",
              answers[q.key] ? "border-border-strong" : "border-border",
            )}
          >
            <span className="font-display text-[13px] text-subtle-foreground tabular">{String(i + 1).padStart(2, "0")}</span>
            <p className="font-display mt-2 text-lg leading-snug">{q.question}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {q.options.map((o) => {
                const on = answers[q.key] === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAnswers((a) => ({ ...a, [q.key]: o.value }))}
                    className={cn(
                      "font-body rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      on ? "border-foreground bg-foreground text-background" : "border-border-strong text-foreground hover:border-foreground/40",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-auto pt-6" aria-live="polite">
              {rec ? (
                <p key={rec.key} className="animate-rise flex items-center gap-2 text-sm">
                  <span className="inline-flex size-4 items-center justify-center rounded-full bg-foreground" aria-hidden>
                    <Check className="size-3 text-background" strokeWidth={3} />
                  </span>
                  <span className="text-foreground">{MODULE_MAP[rec.key].name}</span>
                  <span className="text-subtle-foreground">recommended</span>
                </p>
              ) : (
                <p className="text-sm text-subtle-foreground">{answers[q.key] ? "Nothing extra needed" : "Pick an answer"}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
