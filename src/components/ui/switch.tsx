"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** An on/off toggle: white track when on, hairline outline when off. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  id,
  className,
}: {
  checked: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
  /** Accessible name when there is no visible label element. */
  label?: string;
  id?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-foreground bg-foreground" : "border-border-strong bg-transparent",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block size-[18px] rounded-full transition-transform",
          checked ? "translate-x-[1.3rem] bg-background" : "translate-x-[3px] bg-subtle-foreground",
        )}
      />
    </button>
  );
}

/** A checkbox with its label (black & white, with a small check). */
export function Checkbox({
  name,
  label,
  description,
  defaultChecked,
  checked,
  onChange,
}: {
  name?: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <label className="group flex cursor-pointer items-start gap-2.5 text-sm">
      <span className="relative mt-0.5 inline-flex size-4 shrink-0">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          checked={checked}
          onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
          className="peer size-4 appearance-none rounded-[4px] border border-border-strong bg-surface transition-colors checked:border-foreground checked:bg-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        />
        <Check className="pointer-events-none absolute inset-0 m-auto hidden size-3 text-background peer-checked:block" strokeWidth={3} aria-hidden />
      </span>
      <span>
        <span className="text-foreground">{label}</span>
        {description && <span className="block text-xs text-subtle-foreground">{description}</span>}
      </span>
    </label>
  );
}
