"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { switchBusiness } from "@/lib/auth/actions";
import { startNewBusiness } from "@/lib/onboarding/actions";
import { cn } from "@/lib/utils";

type B = { id: string; name: string; role: string };

/** Top-bar menu to move between businesses (e.g. an accountant with several clients). */
export function BusinessSwitcher({ current, businesses }: { current: B; businesses: B[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[16rem] items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left hover:bg-surface-muted"
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-sm">{current.name}</span>
          <span className="font-body block truncate text-xs text-muted-foreground">{current.role}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-30 mt-1 w-72 rounded-xl border border-border bg-surface-raised p-1">
          <p className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">Your businesses</p>
          {businesses.map((b) => (
            <form key={b.id} action={switchBusiness}>
              <input type="hidden" name="business_id" value={b.id} />
              <button
                type="submit"
                role="menuitem"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-muted",
                  b.id === current.id && "",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{b.name}</span>
                  <span className="font-body block truncate text-xs text-muted-foreground">{b.role}</span>
                </span>
                {b.id === current.id && <Check className="size-4 text-foreground" aria-label="Current" />}
              </button>
            </form>
          ))}
          <div className="my-1 border-t border-border" />
          <form action={startNewBusiness}>
            <button type="submit" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-surface-muted">
              <Plus className="size-4" aria-hidden /> Set up another business
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
