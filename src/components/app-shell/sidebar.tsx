"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModuleIcon } from "@/modules/icons";
import type { IconName } from "@/modules/types";
import { cn } from "@/lib/utils";
import { appConfig } from "@/config/app.config";
import { NuitLink } from "@/components/brand/byline";

export interface SidebarSection {
  key: string;
  label: string | null;
  items: { label: string; href: string; icon: IconName }[];
}

/** Black sidebar: active item in white with a thin bar on the left. */
export function Sidebar({ sections, onNavigate }: { sections: SidebarSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const all = sections.flatMap((s) => s.items.map((i) => i.href));
  // The longest matching link wins, so /app/workspace/tools doesn't also light up /app.
  const active = all.filter((h) => pathname === h || pathname.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  const workspace = sections.find((s) => s.key === "workspace");
  const main = sections.filter((s) => s.key !== "workspace");

  const renderSection = (s: SidebarSection) => (
    <div key={s.key} className="space-y-0.5">
      {s.label && <p className="section-label px-3 pt-5 pb-1.5">{s.label.toLowerCase()}</p>}
      {s.items.map((i) => {
        const on = i.href === active;
        return (
          <Link
            key={i.href}
            href={i.href}
            onClick={onNavigate}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              on ? "text-foreground" : "text-muted-foreground hover:bg-accent-soft hover:text-foreground",
            )}
          >
            {on && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-foreground" aria-hidden />}
            <ModuleIcon name={i.icon} className="size-4 shrink-0" />
            {i.label}
          </Link>
        );
      })}
    </div>
  );

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex-1 space-y-1 overflow-y-auto">{main.map(renderSection)}</div>
      {workspace && <div className="border-t border-border pt-2">{renderSection(workspace)}</div>}
      <p className="px-3 pt-3 text-[11px] text-subtle-foreground">
        {appConfig.brand.name} by <NuitLink location="app-sidebar" />
      </p>
    </nav>
  );
}
