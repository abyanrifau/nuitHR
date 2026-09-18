import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Faq } from "@/components/marketing/faq";
import { PageShell } from "@/components/marketing/page-shell";
import { Reveal } from "@/components/marketing/reveal";
import { appConfig } from "@/config/app.config";
import { formatMoney } from "@/lib/geo";
import { PricingCalculator } from "./calculator";

export const metadata: Metadata = {
  title: "Pricing",
  description: "A base fee for the foundation, then pay only for the tools you add.",
};

export default function PricingPage() {
  const f = appConfig.pricing.foundation;
  const cur = appConfig.pricing.currency;
  const faq = [
    {
      q: "What does the base fee cover?",
      a: `The foundation: the people directory, requests, letters and files, access and roles, and the staff app. It's ${formatMoney(f.base, cur)} a month plus ${formatMoney(f.perPerson, cur)} per person.`,
    },
    { q: "Who counts as a person?", a: "Anyone on your staff list who is active, on probation or on leave. People who have left don't count." },
    { q: "Can I change tools later?", a: "Yes, at any time from Workspace → Tools. Your price follows the tools that are switched on." },
    { q: "Is there a contract?", a: "No. You pay month by month and can stop whenever you like." },
    { q: "What do I pay during the trial?", a: `Nothing. The first ${appConfig.trial.days} days are free and you don't need a card to start.` },
  ];

  return (
    <PageShell
      label="pricing"
      title="Pay for the tools you use"
      intro={`A base fee covers the foundation. Each tool you add is priced by the number of people. ${appConfig.trial.days} days free.`}
    >
      <div className="mx-auto max-w-7xl px-[var(--space-gutter)] py-16 lg:py-24">
        <PricingCalculator />

        <Reveal className="mt-24 grid gap-10 lg:grid-cols-[1fr_1.5fr]">
          <div>
            <p className="section-label">questions</p>
            <h2 className="text-section mt-4">About pricing</h2>
          </div>
          <Faq items={faq} />
        </Reveal>

        <Reveal className="mt-24 border-t border-border pt-12">
          <h2 className="text-section max-w-[18ch]">See what it costs for your team, then try it free.</h2>
          <Link href="/signup" className={buttonClasses({ size: "lg", className: "mt-8" })}>
            Start free for {appConfig.trial.days} days
          </Link>
        </Reveal>
      </div>
    </PageShell>
  );
}
