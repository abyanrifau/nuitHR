import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Blobs } from "@/components/marketing/blobs";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { featuresGroupHref } from "@/components/marketing/nav-links";
import { appConfig } from "@/config/app.config";
import { MODULE_CATEGORIES, MODULES } from "@/modules/registry";
import { cn } from "@/lib/utils";

const FLOW = [
  { step: "01", title: "Clock in", caption: "Staff clock in from their phone, with optional location and selfie." },
  { step: "02", title: "Approve", caption: "Managers approve leave and claims from one inbox." },
  { step: "03", title: "Run payroll", caption: "Hours, unpaid leave and claims flow in. Check, then lock." },
  { step: "04", title: "Send payslips", caption: "Payslips go to staff. The journal goes to your accountant." },
];

export default function HomePage() {
  const trial = `Start your ${appConfig.trial.days}-day free trial`;

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative isolate overflow-hidden">
          <Blobs placement="hero" />
          <div className="mx-auto flex min-h-[92svh] max-w-7xl flex-col justify-center px-[var(--space-gutter)] pt-32 pb-24 md:justify-start md:pt-[30vh]">
            <h1 className="text-hero animate-rise max-w-[15ch]">
              {appConfig.brand.tagline.replace(/-/g, "‑") /* non-breaking hyphen keeps "clock-in" together */}
            </h1>
            <p className="animate-rise mt-8 max-w-[55ch] text-lg text-muted-foreground md:text-xl" style={{ animationDelay: "120ms" }}>
              Attendance, leave, payroll and the rest, for businesses in the Maldives and beyond. Choose only the modules you need.
            </p>
            <div className="animate-rise mt-10 flex flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
              <Link href="/signup" className={buttonClasses({ size: "lg" })}>
                {trial}
              </Link>
              <Link href="/login" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                Log in
              </Link>
            </div>
          </div>
        </section>

        {/* Modules */}
        <section id="modules" className="mx-auto max-w-7xl scroll-mt-16 px-[var(--space-gutter)] py-[var(--space-section)]">
          <Reveal>
            <p className="section-label">modules</p>
            <h2 className="text-section mt-4 max-w-[20ch]">Pick what you need. Add the rest later.</h2>
          </Reveal>
          <ul className="mt-16 border-b border-border">
            {MODULE_CATEGORIES.map((cat, i) => {
              const href = featuresGroupHref(cat.key);
              const mods = MODULES.filter((m) => m.category === cat.key);
              const row = (
                <div className="grid gap-4 py-8 md:grid-cols-[minmax(12rem,1.1fr)_1.2fr_1.4fr_1.5rem] md:gap-10 md:py-10">
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-[1.75rem] text-muted-foreground transition-colors duration-300 group-hover:text-foreground md:text-[2rem]">
                      {cat.label}
                    </h3>
                    {cat.key === "core" && <span className="section-label whitespace-nowrap">always included</span>}
                  </div>
                  <p className="measure text-muted-foreground transition-colors duration-300 group-hover:text-foreground">{cat.description}</p>
                  <ul className="space-y-1 text-[13px] text-subtle-foreground transition-colors duration-300 group-hover:text-muted-foreground">
                    {mods.map((m) => (
                      <li key={m.key}>{m.name}</li>
                    ))}
                  </ul>
                  {href && (
                    <ArrowRight
                      className="hidden size-5 -translate-x-2 self-center text-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 md:block"
                      aria-hidden
                    />
                  )}
                </div>
              );
              return (
                <Reveal
                  as="li"
                  key={cat.key}
                  delay={i * 80}
                  className="group border-t border-border transition-colors duration-300 hover:border-border-strong"
                >
                  {href ? (
                    <Link href={href} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </Reveal>
              );
            })}
          </ul>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-16 px-[var(--space-gutter)] pb-[var(--space-section)]">
          <Reveal>
            <p className="section-label">how it works</p>
            <h2 className="text-section mt-4 max-w-[22ch]">One flow, from the first clock-in to the last payslip.</h2>
          </Reveal>
          <ol className="mt-16 grid border-t border-border sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map((f, i) => (
              <Reveal
                as="li"
                key={f.step}
                delay={i * 80}
                className={cn(
                  "border-b border-border py-8 sm:pr-8 lg:border-b-0 lg:py-10",
                  i > 0 && "lg:border-l lg:pl-8",
                  i % 2 === 1 && "sm:border-l sm:pl-8 lg:pl-8",
                )}
              >
                <span className="font-display text-[13px] text-subtle-foreground tabular">{f.step}</span>
                <h3 className="mt-6 text-2xl">{f.title}</h3>
                <p className="mt-3 max-w-[30ch] text-sm text-muted-foreground">{f.caption}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* Call to action */}
        <section className="relative isolate overflow-hidden border-t border-border">
          <Blobs placement="cta" />
          <div className="mx-auto max-w-7xl px-[var(--space-gutter)] py-[var(--space-section)]">
            <Reveal>
              <h2 className="text-section max-w-[18ch] md:text-[3.5rem]">Start with the basics. Grow into the rest.</h2>
              <p className="mt-6 max-w-[55ch] text-lg text-muted-foreground">
                {appConfig.trial.days} days free. No card needed. Turn modules on or off whenever you like.
              </p>
              <Link href="/signup" className={buttonClasses({ size: "lg", className: "mt-10" })}>
                {trial}
              </Link>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
