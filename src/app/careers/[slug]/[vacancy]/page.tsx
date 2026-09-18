import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EMPLOYMENT, getCareers } from "@/lib/hiring/careers";
import { formatDate, formatMoney } from "@/lib/format";
import { ApplyForm } from "./apply-form";

export async function generateMetadata(props: PageProps<"/careers/[slug]/[vacancy]">): Promise<Metadata> {
  const { slug, vacancy } = await props.params;
  const c = await getCareers(slug);
  const v = c?.vacancies.find((x) => x.slug === vacancy);
  return { title: v && c ? `${v.title} at ${c.business.name}` : "Job", description: v?.description.slice(0, 160) };
}

export default async function VacancyPublicPage(props: PageProps<"/careers/[slug]/[vacancy]">) {
  const { slug, vacancy } = await props.params;
  const c = await getCareers(slug);
  const v = c?.vacancies.find((x) => x.slug === vacancy);
  if (!c || !v) notFound();
  const salary =
    v.salary_min || v.salary_max
      ? [v.salary_min && formatMoney(v.salary_min, v.currency), v.salary_max && formatMoney(v.salary_max, v.currency)].filter(Boolean).join(" to ") + " a month"
      : null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <Link href={`/careers/${slug}`} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> All roles at {c.business.name}
      </Link>
      <h1 className="text-4xl">{v.title}</h1>
      <p className="mt-2 text-muted-foreground">
        {[EMPLOYMENT[v.employment_type], v.department, v.branch, salary, v.deadline && `apply by ${formatDate(v.deadline)}`].filter(Boolean).join(" · ")}
      </p>
      {v.description && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg">About the role</h2>
          <p className="measure whitespace-pre-line text-muted-foreground">{v.description}</p>
        </section>
      )}
      {v.requirements && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg">What we&apos;re looking for</h2>
          <p className="measure whitespace-pre-line text-muted-foreground">{v.requirements}</p>
        </section>
      )}
      <section className="mt-12 rounded-2xl border border-border-strong p-5 sm:p-8">
        <h2 className="mb-5 text-2xl">Apply</h2>
        <ApplyForm slug={slug} vacancyId={v.id} />
      </section>
    </main>
  );
}
