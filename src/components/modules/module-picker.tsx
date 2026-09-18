"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ChevronUp, Info, Lock, Sparkles, X } from "lucide-react";
import { appConfig } from "@/config/app.config";
import { formatMoney } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { MODULE_CATEGORIES, MODULE_MAP, MODULES } from "@/modules/registry";
import { applyBundle, bundlesForIndustry, disableModule, enableModule, normalizeSelection, previewDisable, type Industry } from "@/modules/selection";
import { estimateMonthlyPrice } from "@/modules/pricing";
import { ModuleIcon } from "@/modules/icons";
import type { ModuleKey } from "@/modules/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";

export interface ModulePickerProps {
  industry?: Industry;
  initialSelected: string[];
  employeeCount: number;
  mode: "wizard" | "settings";
  onSave: (selected: ModuleKey[]) => Promise<{ error?: string; message?: string } | void>;
}

export function ModulePicker({ industry, initialSelected, employeeCount, mode, onSave }: ModulePickerProps) {
  const [saved, setSaved] = useState(() => normalizeSelection(initialSelected));
  const [selected, setSelected] = useState<ModuleKey[]>(saved);
  const [notes, setNotes] = useState<string[]>([]);
  const [pendingOff, setPendingOff] = useState<{ key: ModuleKey; also: ModuleKey[] } | null>(null);
  const [activeBundle, setActiveBundle] = useState<string | null>(null);
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const estimate = useMemo(() => estimateMonthlyPrice(selected, employeeCount), [selected, employeeCount]);
  const optionalSelected = selected.filter((k) => !MODULE_MAP[k].core);
  const dirty = mode === "settings" && [...saved].sort().join() !== [...selected].sort().join();
  const turnedOff = saved.filter((k) => !selected.includes(k));

  const toggle = (key: ModuleKey, on: boolean) => {
    setResult(null);
    setActiveBundle(null);
    if (on) {
      const r = enableModule(selected, key);
      setSelected(r.selected);
      setNotes(r.autoEnabled.map((n) => n.message));
      return;
    }
    const p = previewDisable(selected, key);
    if (!p.allowed) return;
    if (p.alsoDisabled.length) setPendingOff({ key, also: p.alsoDisabled });
    else {
      setSelected(disableModule(selected, key).selected);
      setNotes([]);
    }
  };

  const pickBundle = (key: string) => {
    const r = applyBundle(key);
    setSelected(r.selected);
    setActiveBundle(key);
    setNotes(r.autoEnabled.map((n) => n.message));
    setResult(null);
  };

  const save = () =>
    startTransition(async () => {
      const r = await onSave(selected);
      if (r) setResult(r);
      if (r && !r.error) setSaved(selected);
    });

  const summary = (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Estimated monthly price</p>
        <p className="font-display text-3xl tabular">{formatMoney(estimate.monthlyTotal, estimate.currency)}</p>
        <p className="text-xs text-muted-foreground">for about {estimate.employees} employees · placeholder prices</p>
      </div>
      <ul className="space-y-1.5 text-sm">
        {estimate.lines.map((l) => (
          <li key={l.key} className="flex justify-between gap-3">
            <span className="text-muted-foreground">{l.key === "core" ? "Core (always included)" : MODULE_MAP[l.key as ModuleKey].name}</span>
            <span className="shrink-0 tabular">{formatMoney(l.total, estimate.currency)}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-lg border border-border p-3 text-sm">
        <p className="font-display text-foreground">{appConfig.trial.days}-day free trial</p>
        <p className="text-muted-foreground">No card needed. Change modules anytime.</p>
      </div>
      {mode === "settings" && turnedOff.length > 0 && (
        <Alert tone="info">
          Turning off {turnedOff.map((k) => MODULE_MAP[k].name).join(", ")} hides {turnedOff.length > 1 ? "them" : "it"} from menus. All data is kept,
          and switching back on restores everything.
        </Alert>
      )}
      {result?.error && <Alert tone="danger">{result.error}</Alert>}
      {result?.message && !dirty && <Alert tone="success">{result.message}</Alert>}
      <Button size="lg" className="w-full" onClick={save} loading={isPending} disabled={mode === "settings" && !dirty}>
        {mode === "wizard" ? "Continue" : dirty ? "Save changes" : "No changes"}
      </Button>
      {mode === "settings" && dirty && (
        <Button variant="ghost" className="w-full" onClick={() => setSelected(saved)}>
          Undo changes
        </Button>
      )}
    </div>
  );

  return (
    <div className="grid gap-8 pb-28 lg:grid-cols-[1fr_20rem] lg:pb-0">
      <div className="space-y-8">
        {/* Bundles */}
        <section aria-labelledby="bundles-heading" className="space-y-3">
          <h2 id="bundles-heading" className="text-sm tracking-wide text-muted-foreground uppercase">
            Start from a bundle
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {bundlesForIndustry(industry).map(({ bundle, recommended }) => (
              <button
                key={bundle.key}
                type="button"
                onClick={() => pickBundle(bundle.key)}
                aria-pressed={activeBundle === bundle.key}
                className={cn(
                  "rounded-xl border bg-surface p-5 text-left transition-colors",
                  activeBundle === bundle.key ? "border-foreground" : "border-border hover:border-border-strong",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display">{bundle.name}</span>
                  {recommended && (
                    <Badge tone="accent">
                      <Sparkles className="size-3" aria-hidden /> recommended
                    </Badge>
                  )}
                </span>
                <span className="font-body mt-1 block text-sm text-muted-foreground">{bundle.description}</span>
                <span className="font-body mt-2 block text-xs text-subtle-foreground">
                  {bundle.modules.length ? bundle.modules.map((m) => MODULE_MAP[m].name).join(" · ") : "Core modules only"}
                </span>
              </button>
            ))}
          </div>
        </section>

        {notes.length > 0 && (
          <div className="flex gap-3 rounded-lg border border-border-strong bg-surface p-4 text-sm" role="status">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex-1 space-y-1">
              {notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
            <button type="button" onClick={() => setNotes([])} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* Module cards by category */}
        {MODULE_CATEGORIES.map((cat) => (
          <section key={cat.key} aria-labelledby={`cat-${cat.key}`} className="space-y-3">
            <div>
              <h2 id={`cat-${cat.key}`} className="text-2xl">
                {cat.label}
              </h2>
              <p className="text-sm text-muted-foreground">{cat.description}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {MODULES.filter((m) => m.category === cat.key).map((m) => {
                const on = selected.includes(m.key);
                const recs = m.recommends.filter((r) => !selected.includes(r));
                return (
                  <article
                    key={m.key}
                    className={cn(
                      "flex flex-col rounded-xl border bg-surface p-5 transition-colors",
                      on ? "border-foreground" : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                          on ? "border-border-strong text-foreground" : "border-border text-subtle-foreground",
                        )}
                      >
                        <ModuleIcon name={m.icon} className="size-5" />
                      </span>
                      {m.core ? (
                        <Badge tone="neutral" title="Core modules can't be turned off">
                          <Lock className="size-3" aria-hidden /> always included
                        </Badge>
                      ) : (
                        <Switch checked={on} onChange={(v) => toggle(m.key, v)} label={`${m.name}: ${on ? "on" : "off"}`} />
                      )}
                    </div>
                    <h3 className="mt-4 flex items-center gap-2 text-lg" id={`mod-${m.key}`}>
                      {on && (
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground" aria-hidden>
                          <Check className="size-3 text-background" strokeWidth={3} />
                        </span>
                      )}
                      {m.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">{m.tagline}</p>
                    <ul className="mt-3 space-y-1 text-sm">
                      {m.features.map((f) => (
                        <li key={f} className="flex gap-2.5 text-muted-foreground">
                          <span className="mt-[0.6rem] h-px w-3 shrink-0 bg-subtle-foreground" aria-hidden />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                      <span>For: {m.whoFor}</span>
                      {m.requires.length > 0 && <Badge tone="info">Needs {m.requires.map((r) => MODULE_MAP[r].name).join(", ")}</Badge>}
                      {on && recs.length > 0 && <Badge tone="neutral">Works well with {recs.map((r) => MODULE_MAP[r].name).join(", ")}</Badge>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Summary: sticky panel on desktop */}
      <aside className="hidden lg:block">
        <div className="sticky top-6 rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-1">Your selection</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Core + {optionalSelected.length} module{optionalSelected.length === 1 ? "" : "s"}
          </p>
          {summary}
        </div>
      </aside>

      {/* Summary: bottom sheet on mobile */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface lg:hidden">
        {sheetOpen && <div className="max-h-[60vh] overflow-y-auto border-b border-border p-4">{summary}</div>}
        <div className="flex items-center gap-3 p-3">
          <button
            type="button"
            onClick={() => setSheetOpen((o) => !o)}
            className="flex flex-1 items-center gap-2 text-left"
            aria-expanded={sheetOpen}
          >
            <ChevronUp className={cn("size-5 text-muted-foreground transition-transform", sheetOpen && "rotate-180")} aria-hidden />
            <span>
              <span className="block text-xs text-muted-foreground">
                Core + {optionalSelected.length} module{optionalSelected.length === 1 ? "" : "s"} · {appConfig.trial.days}-day free trial
              </span>
              <span className="block tabular">{formatMoney(estimate.monthlyTotal, estimate.currency)} / month</span>
            </span>
          </button>
          {!sheetOpen && (
            <Button onClick={save} loading={isPending} disabled={mode === "settings" && !dirty}>
              {mode === "wizard" ? "Continue" : "Save"}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingOff}
        title={pendingOff ? `Turn off ${MODULE_MAP[pendingOff.key].name}?` : ""}
        confirmLabel="Turn them off"
        onCancel={() => setPendingOff(null)}
        onConfirm={() => {
          if (pendingOff) {
            setSelected(disableModule(selected, pendingOff.key).selected);
            setNotes([]);
          }
          setPendingOff(null);
        }}
      >
        {pendingOff && (
          <div className="space-y-2">
            <p>These modules need {MODULE_MAP[pendingOff.key].name}, so they will be turned off too:</p>
            <ul className="list-disc pl-5 text-foreground">
              {pendingOff.also.map((k) => (
                <li key={k}>{MODULE_MAP[k].name}</li>
              ))}
            </ul>
            <p>No data is deleted. Turning them back on restores everything.</p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
