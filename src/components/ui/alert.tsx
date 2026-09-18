import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Status colours appear only as a small dot and a faint tint, never as big blocks. */
const tones = {
  info: { box: "border-border bg-surface", dot: "bg-info" },
  success: { box: "border-success/25 bg-success-soft", dot: "bg-success" },
  warning: { box: "border-warning/25 bg-warning-soft", dot: "bg-warning" },
  danger: { box: "border-danger/30 bg-danger-soft", dot: "bg-danger" },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { box, dot } = tones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-3 text-sm", box, className)}>
      <span className={cn("mt-[0.45rem] size-1.5 shrink-0 rounded-full", dot)} aria-hidden />
      <div className="space-y-0.5">
        {title && <p className="font-display text-foreground">{title}</p>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
