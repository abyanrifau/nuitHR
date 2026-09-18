import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { getActiveBusiness, getMyBusinesses, requireUser, toAccessContext } from "@/lib/auth/session";
import { can } from "@/modules/access";
import { BusinessSwitcher } from "./business-switcher";

/**
 * Signed-in admin area. Phase 3 replaces this top bar with the full
 * sidebar, quick search and notifications.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser("/app");
  const [businesses, active] = await Promise.all([getMyBusinesses(), getActiveBusiness()]);
  if (!active) redirect("/onboarding");
  if (active.is_owner && !active.onboarding_completed_at) redirect("/onboarding");
  const ctx = toAccessContext(active);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <Logo href="/app" className="hidden sm:inline-flex" />
            <BusinessSwitcher
              current={{ id: active.business_id, name: active.business_name, role: active.role_name }}
              businesses={businesses.map((b) => ({ id: b.business_id, name: b.business_name, role: b.role_name }))}
            />
          </div>
          <div className="flex items-center gap-1">
            <nav className="mr-2 hidden items-center gap-1 text-sm md:flex" aria-label="Main">
              <Link href="/app" className="rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
                Dashboard
              </Link>
              {can(ctx, "modules", "view") && (
                <Link href="/app/settings/modules" className="rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
                  Modules
                </Link>
              )}
            </nav>
            <ThemeToggle className="hidden sm:inline-flex" />
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
                <LogOut className="size-4" aria-hidden /> <span className="hidden lg:inline">Sign out</span>
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
