import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { JumpTo, type JumpItem } from "@/components/app-shell/jump-to";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { NAV_COOKIE, readNavPrefs } from "@/components/app-shell/nav-prefs";
import { AppSidebar, type SidebarSection } from "@/components/app-shell/sidebar";
import { getActiveBusiness, getMyBusinesses, getMyPlan, getUnreadCount, requireUser, toAccessContext } from "@/lib/auth/session";
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
  // All at once; the plan banner reads the same (cached) plan below.
  const supabase = await createClient();
  const [unread, , { data: profile }, { data: me }, cookieStore] = await Promise.all([
    getUnreadCount(user.id, active.business_id),
    active.support ? null : getMyPlan(active.business_id),
    supabase.from("profiles").select("full_name, avatar_path").eq("id", user.id).maybeSingle(),
    active.employee_id ? supabase.from("employees").select("photo_path").eq("id", active.employee_id).maybeSingle() : Promise.resolve({ data: null }),
    cookies(),
  ]);
  const navPrefs = readNavPrefs(cookieStore.get(NAV_COOKIE)?.value, user.id);
  const account = {
    name: profile?.full_name || user.email || "You",
    email: user.email,
    role: active.role_name,
    avatarPath: profile?.avatar_path ?? me?.photo_path ?? null,
  };

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
      <AppSidebar sections={sections} userId={user.id} initial={navPrefs} user={account} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-border bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav sections={sections} userId={user.id} initial={navPrefs} user={account} />
            <BusinessSwitcher
              current={{ id: active.business_id, name: active.business_name, role: active.role_name }}
              businesses={businesses.map((b) => ({ id: b.business_id, name: b.business_name, role: b.role_name }))}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <JumpTo items={jumpItems} />
            <NotificationBell unread={unread ?? 0} />
          </div>
        </header>
        <PlanBanner active={active} />
        <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
