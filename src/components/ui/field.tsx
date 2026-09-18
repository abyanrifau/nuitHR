import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A labelled form field (label above, in secondary text) with optional hint and error. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | string[];
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline justify-between text-[13px] text-muted-foreground">
        <span className="flex flex-1">{label}</span>
        {optional && <span className="text-xs text-subtle-foreground">Optional</span>}
      </label>
      {children}
      {message ? (
        <p id={`${htmlFor}-error`} className="text-[13px] text-danger" role="alert">
          {message}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-subtle-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
