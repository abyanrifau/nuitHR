import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { EMPLOYMENT, getCareers } from "@/lib/hiring/careers";

export async function generateMetadata(props: PageProps<"/careers/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const c = await getCareers(slug);
  return { title: c ? `Jobs at ${c.business.name}` : "Jobs", robots: c ? undefined : { index: false } };
}

/** A company's public job list. No sign-in needed. */
export default async function CareersPage(props: PageProps<"/careers/[slug]">) {
  const { slug } = await props.params;
  const c = await getCareers(slug);
  if (!c) notFound();
  return (
    <div className="min-h-dvh">
      <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        {c.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived private link
          <img src={c.logoUrl} alt={c.business.name} className="mb-8 max-h-14 max-w-48 rounded bg-white object-contain p-1" />
        ) : null}
        <p className="section-label">careers</p>
        <h1 className="mt-2 text-4xl sm:text-5xl">Work at {c.business.name}</h1>
        {c.business.intro && <p className="measure mt-4 whitespace-pre-line text-muted-foreground">{c.business.intro}</p>}
        <h2 className="mt-12 mb-4 text-xl">{c.vacancies.length ? "Open roles" : "No open roles right now"}</h2>
        {c.vacancies.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {c.vacancies.map((v) => (
              <li key={v.id}>
                <Link href={`/careers/${slug}/${v.slug}`} className="flex items-center gap-4 px-5 py-4 hover:bg-accent-soft">
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">{v.title}</span>
                    <span className="block text-[13px] text-subtle-foreground">{[EMPLOYMENT[v.employment_type], v.department, v.branch].filter(Boolean).join(" · ")}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Check back soon.</p>
        )}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-[12px] text-subtle-foreground">
        Hiring with <Wordmark className="text-[12px]" />
      </footer>
    </div>
  );
}
