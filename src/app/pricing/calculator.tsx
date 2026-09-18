"use client";

import { useId, useMemo, useState } from "react";
import { appConfig } from "@/config/app.config";
import { formatMoney } from "@/lib/geo";
import { FOUNDATION_TOOLS, TOOL_STAGES, toolsInStage } from "@/modules/registry";
import { estimateMonthlyPrice, toolPrice } from "@/modules/pricing";
import type { ModuleKey } from "@/modules/types";
import { Switch } from "@/components/ui/switch";

/** How many people → which tools → monthly estimate. */
export function PricingCalculator() {
  const [people, setPeople] = useState(25);
  const [tools, setTools] = useState<ModuleKey[]>(["leave", "payroll"]);
  const estimate = useMemo(() => estimateMonthlyPrice(tools, people), [tools, people]);
  const sliderId = useId();
  const cur = appConfig.pricing.currency;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-12">
        <section>
          <label htmlFor={sliderId} className="font-display block text-2xl text-foreground">
            How many people work for you?
          </label>
          <div className="mt-6 flex items-center gap-6">
            <input
              id={sliderId}
              type="range"
              min={1}
              max={300}
              value={people}
              onChange={(e) => setPeople(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border-strong accent-[var(--foreground)]"
              aria-valuetext={`${people} people`}
            />
            <input
              type="number"
              min={1}
              max={2000}
              value={people}
              onChange={(e) => setPeople(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
              aria-label="Number of people"
              className="h-10 w-24 rounded-lg border border-border-strong bg-surface px-3 text-right text-sm tabular focus:border-foreground focus:outline-none"
            />
          </div>
        </section>

        <section>
          <h2 className="text-2xl">Which tools do you want?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Foundation is always included:{" "}
            {FOUNDATION_TOOLS.map((m) => m.name.toLowerCase())
              .join(", ")
              .replace(/, ([^,]*)$/, " and $1")}
            .
          </p>
          <div className="mt-8 space-y-8">
            {TOOL_STAGES.map((s) => (
              <div key={s.key}>
                <p className="section-label">{s.label.toLowerCase()}</p>
                <ul className="mt-2 divide-y divide-border border-y border-border">
                  {toolsInStage(s.key).map((m) => {
                    const on = tools.includes(m.key);
                    return (
                      <li key={m.key} className="flex items-center justify-between gap-4 py-3">
                        <label htmlFor={`price-${m.key}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="font-display block">{m.name}</span>
                          <span className="block text-[13px] text-subtle-foreground tabular">
                            + {formatMoney(toolPrice(m.key, people), cur)} / month
                          </span>
                        </label>
                        <Switch
                          id={`price-${m.key}`}
                          checked={on}
                          onChange={(v) => setTools((t) => (v ? [...t, m.key] : t.filter((x) => x !== m.key)))}
                          label={`${m.name}: ${on ? "included" : "not included"}`}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside>
        <div className="sticky top-24 rounded-xl border border-border bg-surface p-6" aria-live="polite">
          <p className="section-label">your estimate</p>
          <p className="font-display mt-3 text-5xl tabular">{formatMoney(estimate.monthlyTotal, cur)}</p>
          <p className="mt-1 text-[13px] text-subtle-foreground">per month for {people} people</p>
          <ul className="mt-6 space-y-2 border-t border-border pt-4 text-sm">
            {estimate.lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{l.key === "foundation" ? "Foundation (base fee)" : l.label}</span>
                <span className="shrink-0 tabular">{formatMoney(l.total, cur)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-border pt-4 text-[13px] text-muted-foreground">
            {appConfig.trial.days} days free, no card. Placeholder prices for now.
          </p>
        </div>
      </aside>
    </div>
  );
}
