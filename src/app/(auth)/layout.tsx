import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Byline } from "@/components/brand/byline";
import { Blobs } from "@/components/marketing/blobs";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Alert } from "@/components/ui/alert";
import { appConfig } from "@/config/app.config";
import { isSupabaseConfigured } from "@/lib/env";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <Blobs placement="auth" />
      <header className="flex h-16 items-center px-[var(--space-gutter)]">
        <span className="flex flex-col leading-tight">
          <Logo />
          <Byline location="login" />
        </span>
      </header>
      <main className="flex flex-1 items-start px-[var(--space-gutter)] pt-8 pb-16 sm:justify-center sm:pt-16">
        <div className="w-full max-w-md space-y-6">
          {!isSupabaseConfigured() && (
            <Alert tone="warning" title="Setup needed">
              This copy of the app isn&apos;t connected to Supabase yet, so signing in won&apos;t work. Follow{" "}
              <Link href="/setup" className="text-foreground underline underline-offset-4">
                the setup check
              </Link>
              .
            </Alert>
          )}
          {children}
        </div>
      </main>
      <footer className="flex items-center justify-between gap-4 border-t border-border bg-background/85 px-[var(--space-gutter)] py-5 text-[13px] text-subtle-foreground backdrop-blur-xl">
        <span>
          © {new Date().getFullYear()} {appConfig.brand.legalName}
        </span>
        <span className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-foreground">
            privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            terms
          </Link>
          <ThemeToggle />
        </span>
      </footer>
    </div>
  );
}
