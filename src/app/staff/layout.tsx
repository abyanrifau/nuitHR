import { PlanBanner } from "@/components/app-shell/plan-banner";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, LayoutDashboard } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { BottomTabs } from "@/components/staff/bottom-tabs";
import { appConfig } from "@/config/app.config";
import { getActiveBusiness, requireUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { portalTabs } from "@/modules/access";

export const metadata: Metadata = {
  title: { default: "Staff app", template: `%s | ${appConfig.brand.shortName}` },
  appleWebApp: { capable: true, title: appConfig.brand.shortName, statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/180.png" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
};

/** The staff app: a phone-first layout with bottom tabs (Home, Time, Requests, Pay, Me). */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireUser("/staff");
  const active = await getActiveBusiness();
  if (!active) redirect("/onboarding");
  if (active.is_owner && !active.onboarding_completed_at) redirect("/onboarding");
  const ctx = toAccessContext(active);
  const tabs = portalTabs(ctx, { onlyBuilt: true }).map(({ label, href, icon }) => ({ label, href, icon }));
  // Staff only use this app; everyone else gets a link back to the office view.
  const hasOfficeView = active.role_key !== "employee";
  const supabase = await createClient();
  const { count: unread } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("business_id", active.business_id)
    .is("read_at", null);

  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-3 px-4">
          <Link href="/staff" className="min-w-0">
            <Wordmark className="text-base" />
            <span className="block truncate text-[11px] text-subtle-foreground">{active.business_name}</span>
          </Link>
          <div className="flex items-center gap-1">
            {hasOfficeView && (
              <Link href="/app" aria-label="Office view" className="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-accent-soft hover:text-foreground">
                <LayoutDashboard className="size-5" aria-hidden />
              </Link>
            )}
            <Link
              href="/staff/notifications"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              className="relative grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-accent-soft hover:text-foreground"
            >
              <Bell className="size-5" aria-hidden />
              {unread ? (
                <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] leading-4 text-accent-foreground tabular">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>
      <PlanBanner active={active} />
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
      <BottomTabs tabs={tabs} />
    </div>
  );
}
