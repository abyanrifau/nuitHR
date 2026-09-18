import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NuitLink } from "@/components/brand/byline";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { appConfig } from "@/config/app.config";
import { FOOTER_LINKS } from "./nav-links";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-[var(--space-gutter)] py-12 md:flex-row md:items-end md:justify-between">
        <div className="space-y-5">
          <Logo />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {FOOTER_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>
          <p className="max-w-md text-[13px] text-subtle-foreground">
            {appConfig.brand.name} is designed and built by <NuitLink location="footer" />, a web design studio in the Maldives.{" "}
            <NuitLink location="footer" className="underline">
              Need a website? Visit {appConfig.brand.byline.studio}
            </NuitLink>
          </p>
        </div>
        <div className="flex items-center justify-between gap-6 md:flex-col md:items-end">
          <ThemeToggle />
          <p className="text-[13px] text-subtle-foreground">
            © {new Date().getFullYear()} {appConfig.brand.legalName}
          </p>
        </div>
      </div>
    </footer>
  );
}
