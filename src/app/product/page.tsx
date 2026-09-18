import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { PageShell } from "@/components/marketing/page-shell";
import { ToolMock } from "@/components/marketing/mocks";
import { Reveal } from "@/components/marketing/reveal";
import { appConfig } from "@/config/app.config";
import { STAGES, toolsInStage } from "@/modules/registry";

export const metadata: Metadata = {
  title: "Product",
  description: "Every tool, grouped by hire, run, pay and grow, plus the foundation every plan includes.",
};

const ORDER = ["hire", "run", "pay", "grow", "foundation"] as const;
const STAGE_INTRO: Record<(typeof ORDER)[number], string> = {
  hire: "From the first CV to a finished first week.",
  run: "The daily side: who's working, who's off, and what's about to expire.",
  pay: "Salaries, overtime and money owed back to staff, worked out together.",
  grow: "Help people get better at the job and tell you how it's going.",
  foundation: "Included in every plan, whatever else you switch on.",
};

export default function ProductPage() {
  const stages = ORDER.map((k) => STAGES.find((s) => s.key === k)!);

  return (
    <PageShell
      label="product"
      title="Every tool, in the order you'd use it"
      intro="Pick the stages that matter to you. Each tool works on its own and gets better alongside the others."
    >
      <div className="mx-auto grid max-w-7xl gap-12 px-[var(--space-gutter)] py-16 lg:grid-cols-[13rem_1fr] lg:py-24">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24 space-y-6">
            {stages.map((s) => (
              <div key={s.key}>
                <a href={`#stage-${s.key}`} className="font-display text-sm text-foreground">
                  {s.label}
                </a>
                <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
                  {toolsInStage(s.key).map((m) => (
                    <li key={m.key}>
                      <a href={`#${m.key}`} className="text-[13px] text-muted-foreground hover:text-foreground">
                        {m.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="space-y-24">
          {stages.map((s) => (
            <section key={s.key} id={`stage-${s.key}`} aria-labelledby={`h-${s.key}`} className="scroll-mt-24">
              <Reveal>
                <p className="section-label">{s.key === "foundation" ? "included" : "stage"}</p>
                <h2 id={`h-${s.key}`} className="text-section mt-3">
                  {s.label}
                </h2>
                <p className="mt-3 max-w-[52ch] text-muted-foreground">{STAGE_INTRO[s.key as (typeof ORDER)[number]]}</p>
              </Reveal>
              <div className="mt-10 border-t border-border">
                {toolsInStage(s.key).map((m) => (
                  <article
                    key={m.key}
                    id={m.key}
                    className="grid scroll-mt-24 gap-10 border-b border-border py-12 md:grid-cols-[1fr_minmax(0,22rem)]"
                  >
                    <Reveal>
                      <h3 className="text-3xl">{m.name}</h3>
                      <p className="measure mt-3 text-lg text-muted-foreground">{m.tagline}</p>
                      <ul className="mt-8 space-y-3">
                        {m.outcomes.map((o) => (
                          <li key={o} className="flex gap-4">
                            <span className="mt-[0.7rem] h-px w-4 shrink-0 bg-foreground/60" aria-hidden />
                            <span>{o}</span>
                          </li>
                        ))}
                      </ul>
                    </Reveal>
                    <Reveal delay={120} className="self-center">
                      <ToolMock tool={m.key} />
                    </Reveal>
                  </article>
                ))}
              </div>
            </section>
          ))}

          <Reveal className="border-t border-border pt-12">
            <h2 className="text-section max-w-[18ch]">Pick your tools in a few questions.</h2>
            <Link href="/signup" className={buttonClasses({ size: "lg", className: "mt-8" })}>
              Start free for {appConfig.trial.days} days
            </Link>
          </Reveal>
        </div>
      </div>
    </PageShell>
  );
}
