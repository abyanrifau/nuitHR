"use client";

import { Toaster as Sonner } from "sonner";

/** Success / error pop-ups, styled with the design tokens. Use `toast(...)` from "sonner". */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      // On phones, sit above the staff app's bottom tabs.
      mobileOffset={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !border-border !bg-surface-raised !text-foreground !font-[family-name:var(--font-body)] !shadow-none",
          description: "!text-muted-foreground",
          success: "[&_[data-icon]]:!text-success",
          error: "[&_[data-icon]]:!text-danger",
        },
      }}
    />
  );
}
