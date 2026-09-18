"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveSurvey } from "@/lib/reviews/actions";

type Opt = { value: string; label: string };
type Kind = "scale" | "nps" | "single" | "multiple" | "text";
export interface SurveyDraft {
  id: string | null;
  title: string;
  description: string;
  is_anonymous: boolean;
  min_responses_to_show: number;
  closes_at: string;
  department_ids: string[];
  questions: { question: string; kind: Kind; options: string[]; is_required: boolean }[];
}

const KINDS: { value: Kind; label: string }[] = [
  { value: "scale", label: "Rating 1 to 5" },
  { value: "nps", label: "Would recommend, 0 to 10" },
  { value: "single", label: "Pick one" },
  { value: "multiple", label: "Pick any" },
  { value: "text", label: "Written answer" },
];

export const STARTER: SurveyDraft["questions"] = [
  { question: "How happy are you at work these days?", kind: "scale", options: [], is_required: true },
  { question: "How likely are you to recommend working here to a friend?", kind: "nps", options: [], is_required: true },
  { question: "Do you have what you need to do your job well?", kind: "scale", options: [], is_required: true },
  { question: "What one thing would make work better?", kind: "text", options: [], is_required: false },
];

export function SurveyEditor({ initial, departments }: { initial: SurveyDraft; departments: Opt[] }) {
  const [s, setS] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const setQ = (i: number, patch: Partial<SurveyDraft["questions"][number]>) => setS((x) => ({ ...x, questions: x.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const move = (i: number, d: -1 | 1) =>
    setS((x) => {
      const qs = [...x.questions];
      [qs[i], qs[i + d]] = [qs[i + d], qs[i]];
      return { ...x, questions: qs };
    });

  return (
    <div className="space-y-6">
      <Field label="Title" htmlFor="sv-title">
        <Input id="sv-title" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} placeholder="For example Quick check-in" />
      </Field>
      <Field label="Note to staff" htmlFor="sv-desc" optional>
        <Textarea id="sv-desc" rows={2} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Closes after" htmlFor="sv-close" optional hint="Leave empty to close it yourself.">
          <Input id="sv-close" type="date" value={s.closes_at} onChange={(e) => setS({ ...s, closes_at: e.target.value })} />
        </Field>
        {s.is_anonymous && (
          <Field label="Show results after" htmlFor="sv-min" hint="Answers stay hidden until this many people reply, so nobody can be picked out.">
            <Input id="sv-min" type="number" min={1} max={50} value={s.min_responses_to_show} onChange={(e) => setS({ ...s, min_responses_to_show: Number(e.target.value) || 1 })} className="w-24" />
          </Field>
        )}
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={s.is_anonymous} onChange={(e) => setS({ ...s, is_anonymous: e.target.checked })} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
        <span>
          <span className="text-foreground">Anonymous</span>
          <span className="block text-xs text-subtle-foreground">Nobody, including you, can see who gave which answer. You only see who has replied.</span>
        </span>
      </label>
      {departments.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm text-foreground">Who gets it</legend>
          <p className="mb-2 text-[12px] text-subtle-foreground">Leave all unticked to send it to everyone.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {departments.map((d) => (
              <label key={d.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.department_ids.includes(d.value)}
                  onChange={(e) => setS({ ...s, department_ids: e.target.checked ? [...s.department_ids, d.value] : s.department_ids.filter((x) => x !== d.value) })}
                  className="size-4 accent-[var(--color-accent)]"
                />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <section className="space-y-3">
        <h2 className="text-lg">Questions</h2>
        <ol className="space-y-3">
          {s.questions.map((q, i) => (
            <li key={i} className="space-y-3 rounded-xl border border-border p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_13rem]">
                <Input aria-label={`Question ${i + 1}`} value={q.question} onChange={(e) => setQ(i, { question: e.target.value })} placeholder="Your question" />
                <Select
                  aria-label={`Question ${i + 1} type`}
                  options={KINDS}
                  value={q.kind}
                  onChange={(e) => {
                    const kind = e.target.value as Kind;
                    setQ(i, { kind, options: (kind === "single" || kind === "multiple") && q.options.length < 2 ? ["", ""] : q.options });
                  }}
                />
              </div>
              {(q.kind === "single" || q.kind === "multiple") && (
                <div className="space-y-2 pl-1">
                  {q.options.map((o, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <Input aria-label={`Question ${i + 1} option ${j + 1}`} value={o} onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} placeholder={`Option ${j + 1}`} />
                      {q.options.length > 2 && (
                        <Button variant="ghost" size="sm" aria-label={`Remove option ${j + 1}`} onClick={() => setQ(i, { options: q.options.filter((_, k) => k !== j) })}>
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                  ))}
                  {q.options.length < 10 && (
                    <Button variant="ghost" size="sm" onClick={() => setQ(i, { options: [...q.options, ""] })}>
                      <Plus className="size-3.5" aria-hidden /> Add an option
                    </Button>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <input type="checkbox" checked={q.is_required} onChange={(e) => setQ(i, { is_required: e.target.checked })} className="size-4 accent-[var(--color-accent)]" /> Must answer
                </label>
                <span className="flex">
                  <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === s.questions.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Remove question ${i + 1}`} onClick={() => setS((x) => ({ ...x, questions: x.questions.filter((_, j) => j !== i) }))}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="sm" onClick={() => setS((x) => ({ ...x, questions: [...x.questions, { question: "", kind: "scale", options: [], is_required: true }] }))}>
          <Plus className="size-3.5" aria-hidden /> Add a question
        </Button>
      </section>

      <Button
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await saveSurvey(s.id, {
              title: s.title,
              description: s.description,
              is_anonymous: s.is_anonymous,
              min_responses_to_show: s.min_responses_to_show,
              closes_at: s.closes_at || null,
              department_ids: s.department_ids,
              questions: s.questions.map((q) => ({ ...q, options: q.kind === "single" || q.kind === "multiple" ? q.options.map((o) => o.trim()) : [] })),
            });
            if (r.error) return void toast.error(r.error);
            toast.success(r.message ?? "Saved.");
            if (!s.id && r.id) router.push(`/app/reviews/surveys/${r.id}`);
            else router.refresh();
          })
        }
      >
        Save survey
      </Button>
    </div>
  );
}
