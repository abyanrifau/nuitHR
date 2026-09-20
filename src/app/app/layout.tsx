import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { House, LogOut, Smartphone, UserRound } from "lucide-react";
import { appConfig } from "@/config/app.config";
import { Logo } from "@/components/brand/logo";
import { JumpTo, type JumpItem } from "@/components/app-shell/jump-to";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { Sidebar, type SidebarSection } from "@/components/app-shell/sidebar";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { getActiveBusiness, getMyBusinesses, requireUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { adminNavigation } from "@/modules/access";
import { PlanBanner } from "@/components/app-shell/plan-banner";
import { BusinessSwitcher } from "./business-switcher";

/** Signed-in app: sidebar (Home, Requests, Hire / Run / Pay / Grow, Workspace) and a top bar. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser("/app");
  const [businesses, active] = await Promise.all([getMyBusinesses(), getActiveBusiness()]);
  if (!active) redirect("/onboarding");
  if (active.is_owner && !active.onboarding_completed_at) redirect("/onboarding");
  // Staff use the phone app; the office view is for people who manage something.
  if (active.role_key === "employee") redirect("/staff");
  const supabase = await createClient();
  const { count: unread } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("business_id", active.business_id)
    .is("read_at", null);

  // Only pages that exist are shown; each build phase adds more.
  const nav = adminNavigation(toAccessContext(active), { onlyBuilt: true });
  const sections: SidebarSection[] = nav.map((s) => ({
    key: s.key,
    label: s.label,
    items: s.items.map(({ label, href, icon }) => ({ label, href, icon })),
  }));
  const jumpItems: JumpItem[] = nav.flatMap((s) => s.items.map((i) => ({ label: i.label, href: i.href, icon: i.icon, group: s.label ?? "Main" })));

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border px-3 py-4 lg:flex">
        <div className="px-3 pb-4">
          <Logo href="/app" />
        </div>
        <Sidebar sections={sections} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <MobileNav sections={sections} />
            <BusinessSwitcher
              current={{ id: active.business_id, name: active.business_name, role: active.role_name }}
              businesses={businesses.map((b) => ({ id: b.business_id, name: b.business_name, role: b.role_name }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <JumpTo items={jumpItems} />
            <NotificationBell unread={unread ?? 0} />
            <Link
              href="/"
              aria-label={`${appConfig.brand.name} home page`}
              title={`${appConfig.brand.name} home page`}
              className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent-soft hover:text-foreground"
            >
              <House className="size-4" aria-hidden />
            </Link>
            <Link
              href="/staff"
              aria-label="Staff app"
              title="Staff app"
              className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent-soft hover:text-foreground"
            >
              <Smartphone className="size-4" aria-hidden />
            </Link>
            <ThemeToggle className="hidden sm:inline-flex" />
            <Link
              href="/app/account"
              aria-label="Your account"
              className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent-soft hover:text-foreground"
            >
              <UserRound className="size-4" aria-hidden />
            </Link>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
                <LogOut className="size-4" aria-hidden />
              </Button>
            </form>
          </div>
        </header>
        <PlanBanner active={active} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
