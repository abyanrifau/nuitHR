"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar, type SidebarSection } from "./sidebar";

/** Phones and tablets: the sidebar opens as a full-height panel. */
export function MobileNav({ sections }: { sections: SidebarSection[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="-ml-1 inline-flex size-9 items-center justify-center lg:hidden"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex w-72 max-w-[85vw] flex-col border-r border-border bg-background p-3">
            <div className="mb-2 flex justify-end">
              <button type="button" className="inline-flex size-9 items-center justify-center" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <Sidebar sections={sections} onNavigate={() => setOpen(false)} />
          </div>
          <button type="button" className="flex-1 bg-black/70" aria-label="Close menu" onClick={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
