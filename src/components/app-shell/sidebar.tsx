"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ModuleIcon } from "@/modules/icons";
import type { IconName } from "@/modules/types";
import { cn } from "@/lib/utils";
import { appConfig } from "@/config/app.config";
import { NuitLink } from "@/components/brand/byline";
import { Logo } from "@/components/brand/logo";
import { AccountMenu, type AccountMenuUser } from "./account-menu";
import { navPrefsCookie, type NavPrefs } from "./nav-prefs";

export interface SidebarSection {
  key: string;
  label: string | null;
  items: { label: string; href: string; icon: IconName }[];
}

export function saveNavPrefs(userId: string, prefs: NavPrefs) {
  document.cookie = navPrefsCookie(userId, prefs);
}

/** The link for the page you're on: the longest match wins, so /app/workspace/tools doesn't also light up /app. */
function useActiveHref(sections: SidebarSection[]) {
  const pathname = usePathname();
  const all = sections.flatMap((s) => s.items.map((i) => i.href));
  return all.filter((h) => pathname === h || pathname.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
}

/**
 * The menu itself: Home and Requests, then a folding section per stage
 * (People, Hire, Run, Pay, Grow) and Workspace at the bottom. Every section
 * starts open; the one holding the current page can't be folded away.
 */
export function SidebarNav({
  sections,
  closed,
  onToggle,
  mini = false,
  onNavigate,
}: {
  sections: SidebarSection[];
  closed: string[];
  onToggle: (key: string) => void;
  mini?: boolean;
  onNavigate?: () => void;
}) {
  const active = useActiveHref(sections);
  const activeSection = sections.find((s) => s.items.some((i) => i.href === active))?.key;
  const workspace = sections.find((s) => s.key === "workspace");

  const renderItems = (s: SidebarSection) => (
    <ul id={`nav-${s.key}`} className="space-y-0.5">
      {s.items.map((i) => {
        const on = i.href === active;
        return (
          <li key={i.href}>
            <Link
              href={i.href}
              onClick={onNavigate}
              aria-current={on ? "page" : undefined}
              aria-label={mini ? i.label : undefined}
              title={mini ? i.label : undefined}
              className={cn(
                "relative flex items-center rounded-lg text-sm transition-colors",
                mini ? "mx-auto size-10 justify-center" : "gap-2.5 px-3 py-2",
                on ? "bg-accent-soft text-foreground" : "text-muted-foreground hover:bg-accent-soft hover:text-foreground",
              )}
            >
              {on && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-foreground" aria-hidden />}
              <ModuleIcon name={i.icon} className="size-4 shrink-0" />
              {!mini && <span className="truncate">{i.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const renderSection = (s: SidebarSection) => {
    if (!s.label) return <div key={s.key}>{renderItems(s)}</div>;
    if (mini) {
      return (
        <div key={s.key} role="group" aria-label={s.label}>
          <div className="mx-3 my-2 border-t border-border" aria-hidden />
          {renderItems(s)}
        </div>
      );
    }
    const holdsCurrent = activeSection === s.key;
    const open = holdsCurrent || !closed.includes(s.key);
    return (
      <div key={s.key}>
        <button
          type="button"
          onClick={() => !holdsCurrent && onToggle(s.key)}
          aria-expanded={open}
          aria-controls={`nav-${s.key}`}
          title={holdsCurrent ? "The page you're on is in this section" : undefined}
          className="section-label flex w-full items-center justify-between rounded-md px-3 pt-4 pb-1.5 text-left hover:text-foreground"
        >
          {s.label.toLowerCase()}
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90", holdsCurrent && "opacity-40")} aria-hidden />
        </button>
        {open && renderItems(s)}
      </div>
    );
  };

  return (
    <nav aria-label="Main" className="flex min-h-full flex-col">
      <div>{sections.filter((s) => s.key !== "workspace").map(renderSection)}</div>
      {workspace && <div className="mt-auto pt-2">{renderSection(workspace)}</div>}
    </nav>
  );
}

/** Desktop sidebar: the menu, your account at the bottom, and a button to shrink it to icons. */
export function AppSidebar({ sections, userId, initial, user }: { sections: SidebarSection[]; userId: string; initial: NavPrefs; user: AccountMenuUser }) {
  const [prefs, setPrefs] = useState(initial);
  const update = (next: NavPrefs) => {
    setPrefs(next);
    saveNavPrefs(userId, next);
  };
  const toggle = (key: string) => update({ ...prefs, closed: prefs.closed.includes(key) ? prefs.closed.filter((k) => k !== key) : [...prefs.closed, key] });
  const mini = prefs.mini;

  return (
    <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border py-4 lg:flex", mini ? "w-16 px-2" : "w-60 px-3")}>
      <div className={cn("flex items-center pb-3", mini ? "justify-center" : "justify-between pl-3")}>
        {!mini && <Logo href="/app" />}
        <button
          type="button"
          onClick={() => update({ ...prefs, mini: !mini })}
          aria-label={mini ? "Show the full menu" : "Show icons only"}
          title={mini ? "Show the full menu" : "Show icons only"}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent-soft hover:text-foreground"
        >
          {mini ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav sections={sections} closed={prefs.closed} onToggle={toggle} mini={mini} />
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <AccountMenu user={user} mini={mini} />
        {!mini && (
          <p className="px-3 pt-2 text-[11px] text-subtle-foreground">
            {appConfig.brand.name} by <NuitLink location="app-sidebar" />
          </p>
        )}
      </div>
    </aside>
  );
}
