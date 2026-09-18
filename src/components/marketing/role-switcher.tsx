"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RoleTab {
  key: string;
  label: string;
  points: string[];
  preview: ReactNode;
}

/** "Built for everyone on your team": one tab per role, with what they get and a peek at their screen. */
export function RoleSwitcher({ roles }: { roles: RoleTab[] }) {
  const [active, setActive] = useState(roles[0].key);
  const current = roles.find((r) => r.key === active)!;

  return (
    <div>
      <div role="tablist" aria-label="Choose a role" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {roles.map((r) => (
          <button
            key={r.key}
            role="tab"
            type="button"
            id={`role-tab-${r.key}`}
            aria-selected={r.key === active}
            aria-controls={`role-panel-${r.key}`}
            onClick={() => setActive(r.key)}
            onKeyDown={(e) => {
              const i = roles.findIndex((x) => x.key === active);
              if (e.key === "ArrowRight") setActive(roles[(i + 1) % roles.length].key);
              if (e.key === "ArrowLeft") setActive(roles[(i - 1 + roles.length) % roles.length].key);
            }}
            className={cn(
              "relative -mb-px shrink-0 border-b px-4 py-3 text-[15px] transition-colors",
              r.key === active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`role-panel-${current.key}`}
        aria-labelledby={`role-tab-${current.key}`}
        key={current.key}
        className="animate-rise grid gap-10 pt-10 md:grid-cols-[1fr_1.1fr] md:items-center"
      >
        <ol className="space-y-6">
          {current.points.map((p, i) => (
            <li key={p} className="flex gap-5">
              <span className="font-display text-[13px] text-subtle-foreground tabular">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-lg text-foreground">{p}</span>
            </li>
          ))}
        </ol>
        <div className="max-w-md">{current.preview}</div>
      </div>
    </div>
  );
}
