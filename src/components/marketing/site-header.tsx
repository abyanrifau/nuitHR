"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MARKETING_LINKS } from "./nav-links";

/**
 * Fixed top navigation: transparent over the hero, black with a hairline
 * once you scroll. On phones a menu button opens a full-screen overlay.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 border-b transition-colors duration-300",
          scrolled ? "border-border bg-background/95 backdrop-blur" : "border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-[var(--space-gutter)]">
          <div className="flex items-center gap-10">
            <Logo />
            <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
              {MARKETING_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <Link href="/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              log in
            </Link>
            <Link href="/signup" className={buttonClasses({ size: "sm" })}>
              start free trial
            </Link>
          </div>
          <button
            type="button"
            className="-mr-2 inline-flex size-10 items-center justify-center text-foreground md:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-50 flex flex-col bg-background px-[var(--space-gutter)] md:hidden"
        >
          <div className="flex h-16 items-center justify-between">
            <Logo />
            <button
              type="button"
              className="-mr-2 inline-flex size-10 items-center justify-center"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <nav aria-label="Main" className="mt-10 flex flex-col">
            {[...MARKETING_LINKS, { label: "log in", href: "/login" }].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-display border-b border-border py-5 text-4xl tracking-[-0.03em] text-foreground"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <Link href="/signup" onClick={() => setOpen(false)} className={buttonClasses({ size: "lg", className: "mt-10 w-full" })}>
            start free trial
          </Link>
        </div>
      )}
    </>
  );
}
