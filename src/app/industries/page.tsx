import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { PageShell } from "@/components/marketing/page-shell";
import { Reveal } from "@/components/marketing/reveal";
import { appConfig } from "@/config/app.config";
import { MODULE_MAP } from "@/modules/registry";
import type { ModuleKey } from "@/modules/types";

export const metadata: Metadata = {
  title: "Industries",
  description: "How resorts, guesthouses, restaurants, shops, offices and building firms use the tools.",
};

const INDUSTRIES: { key: string; name: string; situation: string; tools: ModuleKey[] }[] = [
  {
    key: "hospitality",
    name: "Resorts and guesthouses",
    situation:
      "Teams work round the clock across front office, housekeeping, kitchen and boats, often on an island far from the office. Many staff come from abroad on permits, and transport to and from Malé adds up every month.",
    tools: ["attendance", "leave", "payroll", "claims", "compliance", "onboarding"],
  },
  {
    key: "food",
    name: "Restaurants and cafés",
    situation:
      "Split shifts, late closes and a roster that changes every week. Kitchen teams often include expatriate cooks, so permits and medical checks need watching.",
    tools: ["attendance", "leave", "payroll", "compliance"],
  },
  {
    key: "retail",
    name: "Retail",
    situation:
      "Several shops, each with its own opening hours and a small team. Owners want to know who's covering which counter and what the month's wages will be.",
    tools: ["attendance", "leave", "payroll"],
  },
  {
    key: "office",
    name: "Offices",
    situation:
      "Fixed hours, fewer shifts, and more attention on hiring well, keeping skills current and running fair reviews. Leave and payroll still need to be right every month.",
    tools: ["leave", "payroll", "recruitment", "learning", "performance"],
  },
  {
    key: "construction",
    name: "Construction",
    situation:
      "Crews move between sites, many workers are on permits, and site costs such as fuel and small supplies are paid back every week. Attendance by site matters for both pay and billing.",
    tools: ["attendance", "leave", "payroll", "compliance", "claims"],
  },
];

export default function IndustriesPage() {
  return (
    <PageShell
      label="industries"
      title="What usually matters, by type of business"
      intro="These are starting points. Setup asks how you actually work and suggests tools from your answers."
    >
      <div className="mx-auto max-w-7xl px-[var(--space-gutter)] py-16 lg:py-24">
        <div className="border-t border-border">
          {INDUSTRIES.map((ind, i) => (
            <Reveal key={ind.key} delay={i * 60}>
              <section
                id={ind.key}
                aria-labelledby={`ind-${ind.key}`}
                className="grid scroll-mt-24 gap-6 border-b border-border py-12 md:grid-cols-[1fr_1.3fr] md:gap-12"
              >
                <h2 id={`ind-${ind.key}`} className="text-3xl md:text-4xl">
                  {ind.name}
                </h2>
                <div>
                  <p className="measure text-muted-foreground">{ind.situation}</p>
                  <p className="section-label mt-8">usually matters most</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {ind.tools.map((t) => (
                      <li key={t}>
                        <Link
                          href={`/product#${t}`}
                          className="inline-block rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:border-foreground/40"
                        >
                          {MODULE_MAP[t].name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            </Reveal>
          ))}
        </div>
        <Reveal className="pt-16">
          <h2 className="text-section max-w-[20ch]">Not on the list? Setup works for any business.</h2>
          <Link href="/signup" className={buttonClasses({ size: "lg", className: "mt-8" })}>
            Start free for {appConfig.trial.days} days
          </Link>
        </Reveal>
      </div>
    </PageShell>
  );
}
