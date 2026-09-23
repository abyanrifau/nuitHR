"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** A pop-up panel for short forms. Built on the browser dialog, so Esc closes it and focus stays inside. */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Put the cursor in the first box, not on the close button.
      requestAnimationFrame(() => d.querySelector<HTMLElement>("input:not([type=hidden]):not([type=checkbox]), textarea, select")?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        // Text settings are reset so a pop-up opened from a table cell doesn't inherit its alignment or no-wrap.
        "m-auto max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl text-left font-normal whitespace-normal border border-border-strong bg-surface-raised p-0 text-foreground backdrop:bg-black/60",
        wide ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg">{title}</h2>
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent-soft hover:text-foreground" aria-label="Close">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
