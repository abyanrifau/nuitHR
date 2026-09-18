import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Blobs } from "@/components/marketing/blobs";
import { ClockInMock, HrMock, ManagerMock, OwnerMock, RequestsMock, StaffMock } from "@/components/marketing/mocks";
import { Reveal } from "@/components/marketing/reveal";
import { RoleSwitcher } from "@/components/marketing/role-switcher";
import { SetupDemo } from "@/components/marketing/setup-demo";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Faq } from "@/components/marketing/faq";
import { appConfig } from "@/config/app.config";
import { FOUNDATION_TOOLS, TOOL_STAGES, toolsInStage } from "@/modules/registry";
import { cn } from "@/lib/utils";

const ROLES = [
  {
    key: "owners",
    label: "Owners",
    points: [
      "See what needs you today, not everything at once.",
      "Know the month's staff cost before pay day.",
      "Decide exactly who can see salaries.",
    ],
    preview: <OwnerMock />,
  },
  {
    key: "hr",
    label: "HR",
    points: [
      "Every profile, contract and permit in one directory.",
      "Letters on your letterhead in about a minute.",
      "Leave balances that keep themselves up to date.",
    ],
    preview: <HrMock />,
  },
  {
    key: "managers",
    label: "Managers",
    points: [
      "See who's in, late or off before the shift starts.",
      "Answer time off and claims from your phone.",
      "Your team only, nothing else in the way.",
    ],
    preview: <ManagerMock />,
  },
  {
    key: "staff",
    label: "Staff",
    points: ["Clock in with one tap.", "Ask for time off and check what's left.", "Payslips and claims in your pocket."],
    preview: <StaffMock />,
  },
];

const LOCAL = [
  { title: "MVR and your own pay cycle", text: "Monthly, twice a month or weekly, on the pay day you already use." },
  {
    title: "Pension and tax, ready to file",
    text: "Figures laid out for the pension office and MIRA. You confirm the rates; the sums are done for you.",
  },
  {
    title: "Permits for expatriate staff",
    text: "Permit numbers, deposits, insurance and expiry dates, with reminders well ahead of each deadline.",
  },
  { title: "Islands and several locations", text: "A Malé office and an island property can each have their own shifts and clock-in area." },
  { title: "Light on mobile data", text: "The staff app is small and quick, so it works on an ordinary phone connection." },
];

const FAQ = [
  {
    q: "Do I have to pay for every tool?",
    a: "No. Every plan includes the foundation. Add tools one by one and switch any of them off later; what you entered stays put.",
  },
  {
    q: "Do my staff need to download an app?",
    a: "No. The staff app opens in the phone's browser and can be added to the home screen with one tap.",
  },
  {
    q: "Is our information kept apart from other companies?",
    a: "Yes. Each company space is sealed off in the database itself, and inside it people only see what their role allows.",
  },
  {
    q: "Are tax and pension rates filled in?",
    a: "Starting rates for the Maldives are filled in. Rates change, so you confirm them before your first payroll and can edit them whenever you need to.",
  },
  {
    q: "What happens when the free month ends?",
    a: `You decide whether to carry on with the tools you use. The first ${appConfig.trial.days} days cost nothing and you don't need a card to begin.`,
  },
];

export default function HomePage() {
  const start = `Start free for ${appConfig.trial.days} days`;

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* 1. Hero */}
        <section className="relative isolate overflow-hidden">
          <Blobs placement="hero" />
          <div className="mx-auto grid min-h-[92svh] max-w-7xl items-center gap-16 px-[var(--space-gutter)] pt-32 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
            <div>
              <h1 className="text-hero animate-rise max-w-[14ch]">{appConfig.brand.tagline}</h1>
              <p className="animate-rise mt-8 max-w-[52ch] text-lg text-muted-foreground md:text-xl" style={{ animationDelay: "120ms" }}>
                Staff clock in on their phone, managers answer requests, and payroll adds it all up. Made for businesses in the Maldives.
              </p>
              <div className="animate-rise mt-10 flex flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
                <Link href="/signup" className={buttonClasses({ size: "lg" })}>
                  {start}
                </Link>
                <a href="#how-it-works" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                  See how it works
                </a>
              </div>
            </div>
            <div
              className="animate-rise relative mx-auto flex w-full max-w-lg items-start justify-center gap-4 sm:justify-end"
              style={{ animationDelay: "320ms" }}
            >
              <ClockInMock className="animate-float shrink-0" />
              <RequestsMock className="animate-float mt-16 hidden shrink-0 [animation-delay:-3.5s] sm:block" />
            </div>
          </div>
        </section>

        {/* 2. Roles */}
        <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-16 px-[var(--space-gutter)] py-[var(--space-section)]">
          <Reveal>
            <p className="section-label">for your team</p>
            <h2 className="text-section mt-4 max-w-[18ch]">Built for everyone on your team</h2>
          </Reveal>
          <Reveal className="mt-12">
            <RoleSwitcher roles={ROLES} />
          </Reveal>
        </section>

        {/* 3. Stages */}
        <section className="mx-auto max-w-7xl px-[var(--space-gutter)] pb-[var(--space-section)]">
          <Reveal>
            <p className="section-label">the tools</p>
            <h2 className="text-section mt-4 max-w-[20ch]">Hire, run, pay, grow. Use the stages you need.</h2>
          </Reveal>
          <ol className="mt-14 grid border-t border-border md:grid-cols-2 lg:grid-cols-4">
            {TOOL_STAGES.map((s, i) => (
              <Reveal
                as="li"
                key={s.key}
                delay={i * 80}
                className={cn(
                  "border-b border-border py-8 md:pr-8 lg:border-b-0",
                  i > 0 && "lg:border-l lg:pl-8",
                  i % 2 === 1 && "md:border-l md:pl-8",
                )}
              >
                <h3 className="text-3xl">{s.label}</h3>
                <p className="mt-3 max-w-[28ch] text-sm text-muted-foreground">{s.summary}</p>
                <ul className="mt-6 space-y-1.5 text-[15px]">
                  {toolsInStage(s.key).map((m) => (
                    <li key={m.key}>
                      <Link href={`/product#${m.key}`} className="text-foreground hover:underline hover:underline-offset-4">
                        {m.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </ol>
          <p className="mt-8 text-sm text-muted-foreground">
            Every plan includes{" "}
            {FOUNDATION_TOOLS.map((m) => m.name.toLowerCase())
              .join(", ")
              .replace(/, ([^,]*)$/, " and $1")}
            .
          </p>
        </section>

        {/* 4. Setup */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-7xl px-[var(--space-gutter)] py-[var(--space-section)]">
            <Reveal className="grid gap-6 lg:grid-cols-2 lg:items-end">
              <div>
                <p className="section-label">setup</p>
                <h2 className="text-section mt-4 max-w-[16ch]">Setup takes a few questions</h2>
              </div>
              <p className="max-w-[48ch] text-muted-foreground lg:justify-self-end">
                There are no packages to compare. You answer eight plain questions about how your business works, and the tools that fit are switched
                on. Try three of them here.
              </p>
            </Reveal>
            <Reveal className="mt-12">
              <SetupDemo />
            </Reveal>
          </div>
        </section>

        {/* 5. Local */}
        <section className="mx-auto max-w-7xl px-[var(--space-gutter)] pb-[var(--space-section)]">
          <Reveal>
            <p className="section-label">local</p>
            <h2 className="text-section mt-4 max-w-[18ch]">Made for how businesses work here</h2>
          </Reveal>
          <ul className="mt-12 border-t border-border">
            {LOCAL.map((l, i) => (
              <Reveal as="li" key={l.title} delay={i * 60} className="grid gap-2 border-b border-border py-6 md:grid-cols-[1fr_1.4fr] md:gap-10">
                <h3 className="text-xl">{l.title}</h3>
                <p className="measure text-muted-foreground">{l.text}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* 6. FAQ */}
        <section className="mx-auto max-w-7xl px-[var(--space-gutter)] pb-[var(--space-section)]">
          <Reveal>
            <p className="section-label">questions</p>
            <h2 className="text-section mt-4">Asked often</h2>
          </Reveal>
          <Faq items={FAQ} className="mt-10" />
        </section>

        {/* 7. CTA */}
        <section className="relative isolate overflow-hidden border-t border-border">
          <Blobs placement="cta" />
          <div className="mx-auto max-w-7xl px-[var(--space-gutter)] py-[var(--space-section)]">
            <Reveal>
              <h2 className="text-section max-w-[16ch] md:text-[3.5rem]">Try it with your own team.</h2>
              <p className="mt-6 max-w-[50ch] text-lg text-muted-foreground">
                Answer a few questions and your company space is ready. {appConfig.trial.days} days free, no card.
              </p>
              <Link href="/signup" className={buttonClasses({ size: "lg", className: "mt-10" })}>
                {start}
              </Link>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
