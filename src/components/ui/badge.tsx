import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Small, muted badges. Colour only when it means something (status). */
const tones = {
  neutral: "border-border text-muted-foreground",
  accent: "border-border-strong text-foreground",
  success: "border-success/25 bg-success-soft text-success",
  warning: "border-warning/25 bg-warning-soft text-warning",
  danger: "border-danger/25 bg-danger-soft text-danger",
  info: "border-info/25 bg-info-soft text-info",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap", tones[tone], className)}
      {...props}
    />
  );
}
