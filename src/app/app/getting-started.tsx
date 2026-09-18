import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleIcon } from "@/modules/icons";
import { isRouteAvailable } from "@/modules/routes";
import type { IconName } from "@/modules/types";

export interface ChecklistGroup {
  module: string;
  icon: IconName;
  items: { key: string; label: string; href: string; done: boolean }[];
}

/** Dashboard widget that tracks what's left to set up, per enabled module. */
export function GettingStarted({ groups }: { groups: ChecklistGroup[] }) {
  const all = groups.flatMap((g) => g.items);
  const doneCount = all.filter((i) => i.done).length;
  const pct = all.length ? Math.round((doneCount / all.length) * 100) : 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle>Getting started</CardTitle>
          <span className="text-sm text-muted-foreground tabular">
            {doneCount} of {all.length} done
          </span>
        </div>
        <CardDescription>A few things to set up so everything runs smoothly.</CardDescription>
        <div
          className="mt-4 h-px overflow-hidden bg-border"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
        >
          <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.module} aria-label={g.module}>
            <h3 className="mb-2 flex items-center gap-2 text-sm">
              <ModuleIcon name={g.icon} className="size-4 text-muted-foreground" />
              {g.module}
            </h3>
            <ul className="space-y-1.5">
              {g.items.map((i) => (
                <li key={i.key} className="flex items-start gap-2 text-sm">
                  {i.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-label="To do" />
                  )}
                  {!i.done && isRouteAvailable(i.href) ? (
                    <Link href={i.href} className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
                      {i.label}
                    </Link>
                  ) : (
                    <span className={i.done ? "text-muted-foreground line-through" : undefined}>{i.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
