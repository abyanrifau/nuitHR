import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PageShell } from "@/components/marketing/page-shell";
import { HELP_ROLES, guidesFor, type HelpRole } from "@/content/help";

export function generateStaticParams() {
  return HELP_ROLES.map((r) => ({ role: r.key }));
}

export async function generateMetadata({ params }: PageProps<"/help/[role]">): Promise<Metadata> {
  const { role } = await params;
  const r = HELP_ROLES.find((x) => x.key === role);
  return { title: r ? `${r.title} · Help` : "Help" };
}

export default async function HelpRolePage({ params }: PageProps<"/help/[role]">) {
  const { role } = await params;
  const r = HELP_ROLES.find((x) => x.key === role);
  if (!r) notFound();
  const guides = guidesFor(r.key as HelpRole);

  return (
    <PageShell label="help" title={r.title} intro={r.summary} blobs={false}>
      <div className="mx-auto max-w-7xl px-[var(--space-gutter)] py-16">
        <Link href="/help" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> All help
        </Link>
        <ol className="mt-8 border-t border-border">
          {guides.map((g, i) => (
            <li key={g.slug}>
              <Link
                href={`/help/guides/${g.slug}`}
                className="group grid gap-2 border-b border-border py-6 md:grid-cols-[3rem_1fr_auto] md:items-baseline md:gap-6"
              >
                <span className="font-display text-[13px] text-subtle-foreground tabular">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="font-display block text-xl">{g.title}</span>
                  <span className="measure mt-1 block text-sm text-muted-foreground">{g.intro}</span>
                </span>
                <ArrowRight
                  className="hidden size-5 text-subtle-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground md:block"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-sm text-muted-foreground">More guides are added as each part of the product ships.</p>
      </div>
    </PageShell>
  );
}
