import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { SurveyEditor } from "../survey-editor";
import { SurveyButtons } from "./survey-buttons";

export const metadata: Metadata = { title: "Survey" };

interface Results {
  responses: number;
  invited: number;
  hidden: boolean;
  min: number;
  questions: { id: string; question: string; kind: string; options: string[]; answered: number; average?: number; counts?: Record<string, number>; texts?: string[] }[];
}

function Bar({ label, n, total }: { label: string; n: number; total: number }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-[13px]">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
        <span className="block h-full bg-foreground" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right tabular text-muted-foreground">{n}</span>
    </div>
  );
}

export default async function SurveyPage(props: PageProps<"/app/reviews/surveys/[survey]">) {
  const { survey: id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "surveys", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to run surveys.
      </Alert>
    );
  }
  const supabase = await createClient();
  const { data: s } = await supabase.from("surveys").select("*").eq("id", id).eq("business_id", active.business_id).maybeSingle();
  if (!s) notFound();
  const canEdit = can(ctx, "surveys", "edit");

  if (s.status === "draft") {
    const [{ data: questions }, { data: departments }] = await Promise.all([
      supabase.from("survey_questions").select("question, kind, options, is_required, sort").eq("survey_id", id).order("sort"),
      supabase.from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
    ]);
    return (
      <div className="max-w-3xl">
        <PageHeader
          back={{ href: "/app/reviews/surveys", label: "Surveys" }}
          title={s.title}
          description="Draft. Staff can't see it until you open it."
          actions={canEdit ? <SurveyButtons id={s.id} status={s.status} /> : undefined}
        />
        {canEdit ? (
          <SurveyEditor
            departments={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
            initial={{
              id: s.id,
              title: s.title,
              description: s.description ?? "",
              is_anonymous: s.is_anonymous,
              min_responses_to_show: s.min_responses_to_show,
              closes_at: s.closes_at ? localDay(new Date(new Date(s.closes_at).getTime() - 1000), active.timezone) : "",
              department_ids: ((s.audience as { department_ids?: string[] })?.department_ids ?? []) as string[],
              questions: (questions ?? []).map((q) => ({ question: q.question, kind: q.kind, options: (q.options ?? []) as string[], is_required: q.is_required })),
            }}
          />
        ) : (
          <Alert tone="info">This survey hasn&apos;t been opened yet.</Alert>
        )}
      </div>
    );
  }

  const { data: raw, error } = await supabase.rpc("survey_results", { p_survey: id });
  const r = raw as Results | null;
  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/reviews/surveys", label: "Surveys" }}
        title={s.title}
        description={[
          s.status === "open" ? "Open" : "Closed",
          s.is_anonymous ? "anonymous" : "names shown",
          s.closes_at && s.status === "open" ? `closes ${formatDate(new Date(new Date(s.closes_at).getTime() - 1000).toISOString(), active.date_format, active.timezone)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={canEdit && s.status === "open" ? <SurveyButtons id={s.id} status={s.status} /> : undefined}
      />
      {error || !r ? (
        <Alert tone="danger">{error?.message ?? "Results couldn't be loaded."}</Alert>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            <span className="tabular text-foreground">{r.responses}</span> of <span className="tabular">{r.invited}</span> people replied
            {r.invited ? ` (${Math.round((r.responses / r.invited) * 100)}%)` : ""}.
          </p>
          {r.hidden ? (
            <Alert tone="info" title="Results are hidden for now">
              This survey is anonymous. Results show once at least {r.min} people have replied, so nobody can be picked out.
            </Alert>
          ) : (
            r.questions.map((q, i) => (
              <section key={q.id} className="space-y-3 rounded-xl border border-border p-4">
                <h2 className="text-[15px] text-foreground">
                  {i + 1}. {q.question}
                </h2>
                <p className="text-[12px] text-subtle-foreground">{q.answered} answered</p>
                {(q.kind === "scale" || q.kind === "nps") && (
                  <>
                    <p className="text-2xl tabular text-foreground">
                      {q.average ?? "—"}
                      <span className="text-sm text-muted-foreground"> average out of {q.kind === "scale" ? 5 : 10}</span>
                    </p>
                    <div className="space-y-1.5">
                      {Array.from({ length: q.kind === "scale" ? 5 : 11 }, (_, k) => (q.kind === "scale" ? k + 1 : k)).map((v) => (
                        <Bar key={v} label={String(v)} n={q.counts?.[String(v)] ?? 0} total={q.answered} />
                      ))}
                    </div>
                  </>
                )}
                {(q.kind === "single" || q.kind === "multiple") && (
                  <div className="space-y-1.5">
                    {q.options.map((o) => (
                      <Bar key={o} label={o} n={q.counts?.[o] ?? 0} total={q.answered} />
                    ))}
                  </div>
                )}
                {q.kind === "text" &&
                  (q.texts?.length ? (
                    <ul className="space-y-2">
                      {q.texts.map((t, k) => (
                        <li key={k} className="rounded-lg bg-surface-muted px-3 py-2 text-sm whitespace-pre-line">
                          {t}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No written answers.</p>
                  ))}
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
