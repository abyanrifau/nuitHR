import type { ReactNode } from "react";
import { Blobs } from "./blobs";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Marketing page: fixed nav, a header with colour blobs, then the page content. */
export function PageShell({
  label,
  title,
  intro,
  children,
  blobs = true,
}: {
  label: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  blobs?: boolean;
}) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <header className="relative isolate overflow-hidden border-b border-border">
          {blobs && <Blobs placement="header" />}
          <div className="mx-auto max-w-7xl px-[var(--space-gutter)] pt-40 pb-16 md:pb-20">
            <p className="section-label animate-rise">{label}</p>
            <h1 className="text-hero animate-rise mt-4 max-w-[16ch] md:text-[clamp(2.75rem,6vw,5rem)]" style={{ animationDelay: "80ms" }}>
              {title}
            </h1>
            {intro && (
              <div className="animate-rise mt-6 max-w-[55ch] text-lg text-muted-foreground" style={{ animationDelay: "160ms" }}>
                {intro}
              </div>
            )}
          </div>
        </header>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
