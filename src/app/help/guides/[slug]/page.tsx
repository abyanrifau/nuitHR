import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { HELP_GUIDES, HELP_ROLES, getGuide } from "@/content/help";

export function generateStaticParams() {
  return HELP_GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/help/guides/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const g = getGuide(slug);
  return { title: g ? `${g.title} · Help` : "Help", description: g?.intro };
}

export default async function GuidePage({ params }: PageProps<"/help/guides/[slug]">) {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) notFound();
  const firstRole = HELP_ROLES.find((r) => r.key === g.roles[0])!;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-[var(--space-gutter)] pt-36 pb-[var(--space-section)]">
        <Link href={`/help/${firstRole.key}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> {firstRole.title}
        </Link>
        <p className="section-label mt-10">guide</p>
        <h1 className="text-section mt-3">{g.title}</h1>
        <p className="measure mt-5 text-lg text-muted-foreground">{g.intro}</p>

        <ol className="mt-12 border-t border-border">
          {g.steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-border py-5">
              <span className="font-display text-foreground tabular">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <aside aria-labelledby="wrong" className="mt-12 rounded-xl border border-border bg-surface p-6">
          <h2 id="wrong" className="text-lg">
            If something looks wrong
          </h2>
          <ul className="mt-4 space-y-3 text-muted-foreground">
            {g.wrong.map((w) => (
              <li key={w} className="flex gap-3">
                <span className="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                <span>{w}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[13px] text-subtle-foreground">
            Still stuck?{" "}
            <Link href="/contact" className="text-foreground underline underline-offset-4">
              Contact us
            </Link>
            .
          </p>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
