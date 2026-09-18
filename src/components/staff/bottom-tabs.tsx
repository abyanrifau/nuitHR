"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModuleIcon } from "@/modules/icons";
import type { IconName } from "@/modules/types";
import { cn } from "@/lib/utils";

/** The staff app's bottom tabs. Big targets for one-handed use, and room for the phone's home bar. */
export function BottomTabs({ tabs }: { tabs: { label: string; href: string; icon: IconName }[] }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/staff" ? path === "/staff" : path === href || path.startsWith(href + "/"));
  return (
    <nav aria-label="Staff app" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[11px]", active ? "text-foreground" : "text-subtle-foreground hover:text-muted-foreground")}
              >
                <ModuleIcon name={t.icon} className="size-5" />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
