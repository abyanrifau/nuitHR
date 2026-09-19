import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { TwoStepPanel } from "@/app/app/account/account-forms";
import { signOut } from "@/lib/auth/actions";
import { getAdminGate, syncPlatformAdmins } from "@/lib/platform/guard";
import { AdminNav } from "./admin-nav";

// No admin wording here: this is also what a refused visitor's 404 gets.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Harbor's own admin area. The check runs on the server for every request:
 * anyone who isn't a platform admin gets a plain 404, so the area stays hidden.
 * Each page and action checks again.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const gate = await getAdminGate();
  if (gate.kind === "none") notFound();
  if (gate.kind === "needs_2fa_verify") redirect("/two-step?next=/admin");

  if (gate.kind === "needs_2fa_setup") {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <p className="section-label mb-2">platform admin</p>
        <h1 className="text-2xl">Set up two-step sign-in first</h1>
        <p className="mt-2 mb-8 text-sm text-muted-foreground">
          The admin area can see every company on Harbor, so it needs a code from an authenticator app (such as Google Authenticator or 1Password) as well as your
          password. Set it up below, then sign out and back in, and open the admin area again.
        </p>
        <TwoStepPanel />
        <form action={signOut} className="mt-8">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  await syncPlatformAdmins();
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border px-3 py-4 lg:flex">
        <div className="px-3 pb-1">
          <Wordmark />
        </div>
        <p className="mb-5 px-3">
          <span className="inline-block rounded-full border border-foreground px-2 py-0.5 text-[11px] tracking-wide text-foreground">Platform admin</span>
        </p>
        <AdminNav />
        <div className="mt-auto space-y-1 border-t border-border px-3 pt-3 text-[12px] text-subtle-foreground">
          <p className="truncate" title={gate.admin.email}>
            {gate.admin.email}
          </p>
          <Link href="/app" className="block hover:text-foreground">
            Back to Harbor
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <Wordmark />
            <span className="rounded-full border border-foreground px-2 py-0.5 text-[11px] text-foreground">Platform admin</span>
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
                <LogOut className="size-4" aria-hidden />
              </Button>
            </form>
          </div>
        </header>
        <div className="border-b border-border px-4 py-2 lg:hidden">
          <AdminNav horizontal />
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
