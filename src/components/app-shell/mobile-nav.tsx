"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { AccountMenu, type AccountMenuUser } from "./account-menu";
import type { NavPrefs } from "./nav-prefs";
import { SidebarNav, saveNavPrefs, type SidebarSection } from "./sidebar";

/** Phones and tablets: the menu slides out from the left. */
export function MobileNav({ sections, userId, initial, user }: { sections: SidebarSection[]; userId: string; initial: NavPrefs; user: AccountMenuUser }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(initial);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  const toggle = (key: string) => {
    const next = { ...prefs, closed: prefs.closed.includes(key) ? prefs.closed.filter((k) => k !== key) : [...prefs.closed, key] };
    setPrefs(next);
    saveNavPrefs(userId, next);
  };

  return (
    <>
      <button type="button" className="-ml-1 inline-flex size-9 shrink-0 items-center justify-center lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
        <Menu className="size-5" aria-hidden />
      </button>
      <div className={cn("fixed inset-0 z-50 lg:hidden", !open && "pointer-events-none")} aria-hidden={!open} inert={!open}>
        <button
          type="button"
          tabIndex={-1}
          className={cn("absolute inset-0 bg-black/70 transition-opacity duration-200", open ? "opacity-100" : "opacity-0")}
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={cn(
            "absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-200",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="mb-1 flex items-center justify-between pl-3">
            <Logo href="/app" />
            <button type="button" className="inline-flex size-9 items-center justify-center" aria-label="Close menu" onClick={() => setOpen(false)}>
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SidebarNav sections={sections} closed={prefs.closed} onToggle={toggle} onNavigate={() => setOpen(false)} />
          </div>
          <div className="mt-2 border-t border-border pt-2">
            <AccountMenu user={user} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      </div>
    </>
  );
}
