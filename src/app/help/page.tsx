import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageShell } from "@/components/marketing/page-shell";
import { Reveal } from "@/components/marketing/reveal";
import { HELP_ROLES, getGuide } from "@/content/help";
import { HelpSearch } from "./help-search";

export const metadata: Metadata = { title: "Help", description: "Guides for owners, HR, managers and staff." };

export default function HelpPage() {
  const start = getGuide("getting-started")!;
  return (
    <PageShell label="help" title="How can we help?" intro={<HelpSearch />}>
      <div className="mx-auto max-w-7xl px-[var(--space-gutter)] py-16 lg:py-24">
        <Reveal>
          <p className="section-label">start with your role</p>
          <ul className="mt-6 grid border-t border-border md:grid-cols-2">
            {HELP_ROLES.map((r, i) => (
              <li key={r.key} className={i % 2 === 1 ? "md:border-l md:border-border md:pl-8" : "md:pr-8"}>
                <Link href={`/help/${r.key}`} className="group flex items-start justify-between gap-6 border-b border-border py-8">
                  <span>
                    <span className="font-display block text-2xl">{r.title}</span>
                    <span className="mt-2 block text-muted-foreground">{r.summary}</span>
                  </span>
                  <ArrowRight
                    className="mt-2 size-5 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="mt-20 grid gap-6 rounded-xl border border-border bg-surface p-8 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="section-label">new here</p>
            <h2 className="mt-2 text-2xl">{start.title}</h2>
            <p className="measure mt-2 text-muted-foreground">{start.intro}</p>
          </div>
          <Link href={`/help/guides/${start.slug}`} className="font-display inline-flex items-center gap-2 text-foreground">
            Read the guide <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Reveal>

        <p className="mt-16 text-sm text-muted-foreground">
          Can&apos;t find it?{" "}
          <Link href="/contact" className="text-foreground underline underline-offset-4">
            Get in touch
          </Link>
          .
        </p>
      </div>
    </PageShell>
  );
}
