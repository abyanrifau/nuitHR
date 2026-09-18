"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ChevronUp, Info, X } from "lucide-react";
import { appConfig } from "@/config/app.config";
import { formatMoney } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { FOUNDATION_TOOLS, MODULE_MAP, TOOL_STAGES, toolsInStage } from "@/modules/registry";
import { disableModule, enableModule, normalizeSelection, previewDisable } from "@/modules/selection";
import { estimateMonthlyPrice } from "@/modules/pricing";
import { ModuleIcon } from "@/modules/icons";
import type { ModuleKey } from "@/modules/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";

export interface ToolPickerProps {
  initialSelected: string[];
  people: number;
  mode: "setup" | "workspace";
  /** Short reasons for recommended tools, e.g. "Because your staff work shifts". */
  reasons?: Partial<Record<ModuleKey, string>>;
  readOnly?: boolean;
  onSave: (selected: ModuleKey[]) => Promise<{ error?: string; message?: string } | void>;
}

/** Tools grouped by Hire / Run / Pay / Grow, each with a switch, plus a live monthly estimate. */
export function ToolPicker({ initialSelected, people, mode, reasons = {}, readOnly, onSave }: ToolPickerProps) {
  const [saved, setSaved] = useState(() => normalizeSelection(initialSelected));
  const [selected, setSelected] = useState<ModuleKey[]>(saved);
  const [notes, setNotes] = useState<string[]>([]);
  const [pendingOff, setPendingOff] = useState<{ key: ModuleKey; also: ModuleKey[] } | null>(null);
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const estimate = useMemo(() => estimateMonthlyPrice(selected, people), [selected, people]);
  const addOns = selected.filter((k) => !MODULE_MAP[k].core);
  const dirty = [...saved].sort().join() !== [...selected].sort().join();
  const turnedOff = saved.filter((k) => !selected.includes(k));

  const toggle = (key: ModuleKey, on: boolean) => {
    setResult(null);
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

  const save = () =>
    startTransition(async () => {
      const r = await onSave(selected);
      if (r) setResult(r);
      if (r && !r.error) setSaved(selected);
    });

  const canSave = !readOnly && (mode === "setup" || dirty);
  const saveLabel = mode === "setup" ? "Continue" : dirty ? "Save changes" : "No changes";

  const summary = (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] text-muted-foreground">Estimated per month</p>
        <p className="font-display text-4xl tabular">{formatMoney(estimate.monthlyTotal, estimate.currency)}</p>
        <p className="text-xs text-subtle-foreground">For {estimate.people} people. Placeholder prices.</p>
      </div>
      <ul className="space-y-1.5 border-t border-border pt-4 text-sm">
        {estimate.lines.map((l) => (
          <li key={l.key} className="flex justify-between gap-3">
            <span className="text-muted-foreground">{l.label}</span>
            <span className="shrink-0 tabular">{formatMoney(l.total, estimate.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border pt-4 text-[13px] text-muted-foreground">
        Free for {appConfig.trial.days} days. No card. Change your tools whenever you like.
      </p>
      {mode === "workspace" && turnedOff.length > 0 && (
        <Alert tone="info">
          Switching off {turnedOff.map((k) => MODULE_MAP[k].name).join(", ")} hides {turnedOff.length > 1 ? "them" : "it"} from menus. Nothing is
          deleted, and switching back on brings everything back.
        </Alert>
      )}
      {result?.error && <Alert tone="danger">{result.error}</Alert>}
      {result?.message && !dirty && <Alert tone="success">{result.message}</Alert>}
      {!readOnly && (
        <Button size="lg" className="w-full" onClick={save} loading={isPending} disabled={!canSave}>
          {saveLabel}
        </Button>
      )}
      {mode === "workspace" && dirty && (
        <Button variant="ghost" className="w-full" onClick={() => setSelected(saved)}>
          Undo changes
        </Button>
      )}
    </div>
  );

  return (
    <div className="grid gap-10 pb-28 lg:grid-cols-[1fr_20rem] lg:pb-0">
      <div className="space-y-10">
        <section aria-label="Included in every plan" className="rounded-xl border border-border p-5">
          <p className="section-label">included</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Every plan includes{" "}
            {FOUNDATION_TOOLS.map((m) => m.name.toLowerCase())
              .join(", ")
              .replace(/, ([^,]*)$/, " and $1")}
            .
          </p>
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

        {TOOL_STAGES.map((stage) => (
          <section key={stage.key} aria-labelledby={`stage-${stage.key}`}>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <h2 id={`stage-${stage.key}`} className="text-2xl">
                {stage.label}
              </h2>
              <p className="text-[13px] text-subtle-foreground">{stage.summary}</p>
            </div>
            <ul className="divide-y divide-border">
              {toolsInStage(stage.key).map((m) => {
                const on = selected.includes(m.key);
                const reason = reasons[m.key];
                return (
                  <li key={m.key} className="flex gap-4 py-5">
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                        on ? "border-border-strong text-foreground" : "border-border text-subtle-foreground",
                      )}
                    >
                      <ModuleIcon name={m.icon} className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="flex items-center gap-2 text-lg" id={`tool-${m.key}`}>
                            {on && (
                              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground" aria-hidden>
                                <Check className="size-3 text-background" strokeWidth={3} />
                              </span>
                            )}
                            {m.name}
                          </h3>
                          {reason && <p className="mt-0.5 text-[13px] text-foreground">{reason}</p>}
                        </div>
                        <Switch checked={on} disabled={readOnly} onChange={(v) => toggle(m.key, v)} label={`${m.name}: ${on ? "on" : "off"}`} />
                      </div>
                      <p className="measure mt-1 text-sm text-muted-foreground">{m.tagline}</p>
                      <p className="mt-2 text-[13px] text-subtle-foreground">{m.features.join(" · ")}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-6 rounded-xl border border-border bg-surface p-6">
          <p className="section-label">your plan</p>
          <p className="mt-2 mb-5 text-sm text-muted-foreground">
            Foundation + {addOns.length} tool{addOns.length === 1 ? "" : "s"}
          </p>
          {summary}
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background lg:hidden">
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
              <span className="font-body block text-xs text-muted-foreground">
                Foundation + {addOns.length} tool{addOns.length === 1 ? "" : "s"} · {appConfig.trial.days} days free
              </span>
              <span className="block tabular">{formatMoney(estimate.monthlyTotal, estimate.currency)} / month</span>
            </span>
          </button>
          {!sheetOpen && !readOnly && (
            <Button onClick={save} loading={isPending} disabled={!canSave}>
              {mode === "setup" ? "Continue" : "Save"}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingOff}
        title={pendingOff ? `Switch off ${MODULE_MAP[pendingOff.key].name}?` : ""}
        confirmLabel="Switch them off"
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
            <p>These tools need {MODULE_MAP[pendingOff.key].name}, so they&apos;ll switch off too:</p>
            <ul className="list-disc pl-5 text-foreground">
              {pendingOff.also.map((k) => (
                <li key={k}>{MODULE_MAP[k].name}</li>
              ))}
            </ul>
            <p>Nothing is deleted. Switching them back on brings everything back.</p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
