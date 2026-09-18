"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";

/**
 * A confirmation pop-up for actions that remove or turn things off.
 * Uses the browser's built-in dialog, so Esc closes it and focus is trapped.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface-raised p-0 text-foreground backdrop:bg-black/70"
    >
      <div className="space-y-3 p-6">
        <h2 className="text-lg">{title}</h2>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
