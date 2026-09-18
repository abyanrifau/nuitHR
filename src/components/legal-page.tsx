import type { ReactNode } from "react";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Alert } from "@/components/ui/alert";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-[var(--space-gutter)] pt-40 pb-[var(--space-section)]">
        <p className="section-label">legal</p>
        <h1 className="text-section mt-4">{title}</h1>
        <p className="mt-4 text-[13px] text-subtle-foreground">Last updated {updated}</p>
        <div className="mt-12 max-w-[65ch] space-y-8">
          <Alert tone="warning" title="Placeholder text">
            Replace this page with your own wording, reviewed by a lawyer, before launching. Edit the file in src/app/
            {title === "Privacy policy" ? "privacy" : "terms"}/page.tsx.
          </Alert>
          <div className="space-y-5 text-muted-foreground [&_h2]:mt-12 [&_h2]:border-t [&_h2]:border-border [&_h2]:pt-8 [&_h2]:text-xl [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
            {children}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
