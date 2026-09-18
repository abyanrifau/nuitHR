import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { Byline } from "@/components/brand/byline";
import { Blobs } from "@/components/marketing/blobs";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { getOnboardingState, WIZARD_STEPS } from "@/lib/onboarding/state";
import { ProgressBar } from "./progress-bar";

export const metadata: Metadata = { title: "Set up your company space" };

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const state = await getOnboardingState();
  const furthest = Math.max(state.draft.furthest ?? 2, state.currentStep);

  return (
    <div className="relative isolate min-h-dvh overflow-hidden">
      <Blobs placement="wizard" className="fixed" />
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-[var(--space-gutter)]">
        <span className="flex flex-col leading-tight">
          <Logo href="/onboarding" />
          <Byline location="login" />
        </span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" title="Your progress is saved. Sign back in to continue.">
              save &amp; exit
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-[var(--space-gutter)] pt-6 pb-16">
        <ProgressBar steps={WIZARD_STEPS.map(({ n, label, href }) => ({ n, label, href }))} furthest={furthest} />
        <main className="mt-8 rounded-xl border border-border bg-background/80 p-5 backdrop-blur-xl sm:p-8 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
