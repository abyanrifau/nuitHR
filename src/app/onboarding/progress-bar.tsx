"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Step {
  n: number;
  label: string;
  href: string;
}

/**
 * Wizard progress: a thin white line that fills as you go. Finished steps
 * are links, so you can go back to any of them.
 */
export function ProgressBar({ steps, furthest }: { steps: Step[]; furthest: number }) {
  const pathname = usePathname();
  const current = steps.findLast((s) => s.n > 1 && pathname.startsWith(s.href))?.n ?? 2;
  const pct = (current / steps.length) * 100;

  return (
    <nav aria-label="Setup progress" className="w-full">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="text-[13px] text-subtle-foreground">
          <span className="font-display text-foreground tabular">{String(current).padStart(2, "0")}</span> / {String(steps.length).padStart(2, "0")}
          <span className="ml-3 text-muted-foreground">{steps[current - 1]?.label}</span>
        </p>
        <ol className="hidden items-center gap-5 md:flex">
          {steps.map((s) => {
            const active = s.n === current;
            const reachable = s.n > 1 && s.n <= furthest && !active && s.n !== 6;
            const cls = cn(
              "text-[13px] transition-colors",
              active ? "text-foreground" : s.n < current ? "text-muted-foreground" : "text-subtle-foreground",
            );
            return (
              <li key={s.n}>
                {reachable ? (
                  <Link href={s.href} className={cn(cls, "hover:text-foreground")} aria-label={`Go back to step ${s.n}: ${s.label}`}>
                    {s.label}
                  </Link>
                ) : (
                  <span className={cls} aria-current={active ? "step" : undefined}>
                    {s.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div
        className="h-px w-full bg-border"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={current}
        aria-label="Setup progress"
      >
        <div className="h-px bg-foreground transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </nav>
  );
}
