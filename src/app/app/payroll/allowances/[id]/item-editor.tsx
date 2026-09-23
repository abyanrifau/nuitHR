"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { ActionForm, TextField } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/lib/format";
import { FORMULA_FUNCTIONS, PAY_VARIABLES, parseFormula } from "@/lib/payroll/formula";
import { METHODS, OCCURRENCE_VARIABLES, OPERATORS, OUTCOMES, unreachableRules, type PayRule } from "@/lib/payroll/pay-items";
import { previewPayItems, removePayItemOverride, savePayItem, savePayItemOverride, type PreviewResult } from "@/lib/payroll/component-actions";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };
type TargetType = "department" | "position" | "branch" | "employee";

export interface ItemValues {
  name: string;
  description: string;
  kind: "earning" | "deduction";
  is_taxable: boolean;
  is_pensionable: boolean;
  effective_from: string;
  effective_to: string;
  method: string;
  default_amount: number;
  default_percent: number | null;
  prorate_basis: "calendar" | "working";
  occurrence_var: string | null;
  occurrence_after: number;
  formula: string;
  rules_mode: "none" | "builder" | "formula";
  rules: PayRule[];
  rules_formula: string;
  applies_to: "all" | "selected";
  targets: { target_type: TargetType; target_id: string }[];
  template_key: string | null;
}

export interface Override {
  id: string;
  employee_id: string;
  name: string;
  amount: number | null;
  percent: number | null;
  start_date: string;
  end_date: string | null;
}

/** A formula box that checks what's typed as you go and lets you click variables in. */
function FormulaInput({ id, value, onChange, hint }: { id: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const result = value.trim() ? parseFormula(value) : null;
  const insert = (text: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const next = value.slice(0, at) + text + value.slice(el?.selectionEnd ?? at);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };
  return (
    <div className="space-y-2">
      <Textarea
        ref={ref}
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={cn("font-mono text-[13px]", result && !result.ok && "border-danger")}
        placeholder="IF(unapproved_absences >= 3, amount * 0.5, amount)"
        aria-invalid={result && !result.ok ? true : undefined}
        aria-describedby={`${id}-check`}
      />
      <p id={`${id}-check`} className={cn("flex items-start gap-1.5 text-[13px]", !result ? "text-subtle-foreground" : result.ok ? "text-success" : "text-danger")} aria-live="polite">
        {!result ? (
          hint
        ) : result.ok ? (
          <>
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden /> The formula is valid.
          </>
        ) : (
          <>
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {result.error}
          </>
        )}
      </p>
      <details className="text-[12px]">
        <summary className="cursor-pointer text-muted-foreground">Variables and functions you can use</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PAY_VARIABLES.map((v) => (
            <button key={v.key} type="button" title={v.hint} onClick={() => insert(v.key)} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent-soft">
              {v.key}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FORMULA_FUNCTIONS.map((f) => (
            <button key={f.name} type="button" title={f.hint} onClick={() => insert(`${f.name}(`)} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent-soft">
              {f.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-subtle-foreground">Use + − * / and brackets, and compare with &gt;= &gt; &lt;= &lt; = !=. Write 50% as * 0.5. Point at a variable to see what it means.</p>
      </details>
    </div>
  );
}

function TargetPicker({
  type,
  label,
  options,
  chosen,
  toggle,
}: {
  type: TargetType;
  label: string;
  options: Opt[];
  chosen: Set<string>;
  toggle: (type: TargetType, id: string) => void;
}) {
  const [q, setQ] = useState("");
  if (!options.length) return null;
  const shown = options.filter((o) => chosen.has(`${type}|${o.value}`) || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-[13px] text-muted-foreground">{label}</legend>
      {options.length > 8 && <Input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />}
      <div className="max-h-44 space-y-1.5 overflow-y-auto">
        {shown.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={chosen.has(`${type}|${o.value}`)} onChange={() => toggle(type, o.value)} className="size-4 accent-[var(--color-accent)]" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RuleCard({
  rule,
  index,
  count,
  warning,
  currency,
  onChange,
  onMove,
  onRemove,
}: {
  rule: PayRule;
  index: number;
  count: number;
  warning?: string;
  currency: string;
  onChange: (r: PayRule) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const outcome = OUTCOMES.find((o) => o.value === rule.outcome.type)!;
  const setClause = (i: number, patch: Partial<PayRule["clauses"][number]>) => onChange({ ...rule, clauses: rule.clauses.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <li className={cn("rounded-lg border p-3", warning ? "border-warning" : "border-border")}>
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] tabular">{index + 1}</span>
        <Input aria-label={`Rule ${index + 1} name`} value={rule.label} onChange={(e) => onChange({ ...rule, label: e.target.value })} placeholder="Name, for example 3 or more absences" className="h-8" />
        <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp className="size-3.5" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown className="size-3.5" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove rule ${index + 1}`}>
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </div>
      <p className="mb-2 text-[13px] text-muted-foreground">If</p>
      <ul className="space-y-2">
        {rule.clauses.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            {i > 0 && (
              <Select
                aria-label="And or or"
                value={rule.join}
                onChange={(e) => onChange({ ...rule, join: e.target.value as "and" | "or" })}
                options={[
                  { value: "and", label: "and" },
                  { value: "or", label: "or" },
                ]}
                className="h-9 w-20"
              />
            )}
            <Select aria-label="Variable" value={c.var} onChange={(e) => setClause(i, { var: e.target.value as never })} options={PAY_VARIABLES.map((v) => ({ value: v.key, label: v.label }))} className="h-9 min-w-44 flex-1" />
            <Select aria-label="Compared how" value={c.op} onChange={(e) => setClause(i, { op: e.target.value as never })} options={OPERATORS.map((o) => ({ value: o.value, label: o.label }))} className="h-9 w-36" />
            <Input aria-label="Value" type="number" step="any" value={Number.isNaN(c.value) ? "" : c.value} onChange={(e) => setClause(i, { value: e.target.value === "" ? NaN : Number(e.target.value) })} className="h-9 w-24" />
            {rule.clauses.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...rule, clauses: rule.clauses.filter((_, j) => j !== i) })} aria-label="Remove condition">
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1"
        onClick={() => onChange({ ...rule, clauses: [...rule.clauses, { var: "unapproved_absences", op: ">=", value: 1 }] })}
        disabled={rule.clauses.length >= 10}
      >
        <Plus className="size-3.5" aria-hidden /> Add a condition
      </Button>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">then</span>
        <Select
          aria-label="Then"
          value={rule.outcome.type}
          onChange={(e) => onChange({ ...rule, outcome: { type: e.target.value as never, value: rule.outcome.value } })}
          options={OUTCOMES.map((o) => ({ value: o.value, label: o.label }))}
          className="h-9 w-48"
        />
        {outcome.needsValue && (
          <span className="flex items-center gap-1.5">
            <Input
              aria-label={rule.outcome.type === "percent" ? "Percent" : "Amount"}
              type="number"
              min={0}
              step="any"
              value={rule.outcome.value ?? ""}
              onChange={(e) => onChange({ ...rule, outcome: { ...rule.outcome, value: e.target.value === "" ? null : Number(e.target.value) } })}
              className="h-9 w-28"
            />
            <span className="text-[13px] text-muted-foreground">{rule.outcome.type === "percent" ? "%" : currency}</span>
          </span>
        )}
      </div>
      {warning && (
        <p className="mt-3 flex items-start gap-1.5 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {warning}
        </p>
      )}
    </li>
  );
}

export function PayItemEditor({
  id,
  initial,
  targets,
  overrides,
  people,
  currency,
  month,
  dateFormat,
  canEdit,
}: {
  id: string | null;
  initial: ItemValues;
  targets: Record<TargetType, Opt[]>;
  overrides: Override[];
  people: Opt[];
  currency: string;
  month: string;
  dateFormat: string;
  canEdit: boolean;
}) {
  const [v, setV] = useState<ItemValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [testPerson, setTestPerson] = useState(people[0]?.value ?? "");
  const [testMonth, setTestMonth] = useState(month);
  const [test, setTest] = useState<PreviewResult | null>(null);
  const router = useRouter();
  const set = <K extends keyof ItemValues>(k: K, value: ItemValues[K]) => setV((x) => ({ ...x, [k]: value }));
  const money = (n: number) => formatMoney(n, currency);
  const warnings = useMemo(() => new Map(unreachableRules(v.rules.filter((r) => r.clauses.every((c) => !Number.isNaN(c.value)))).map((w) => [w.index, w.reason])), [v.rules]);
  const chosen = useMemo(() => new Set(v.targets.map((t) => `${t.target_type}|${t.target_id}`)), [v.targets]);
  const toggle = (type: TargetType, tid: string) =>
    set("targets", chosen.has(`${type}|${tid}`) ? v.targets.filter((t) => !(t.target_type === type && t.target_id === tid)) : [...v.targets, { target_type: type, target_id: tid }]);
  const isDeduction = v.kind === "deduction";
  const amountLabel = { fixed: "Amount per month", per_day: "Rate per day attended", prorated: "Full amount for the month", per_occurrence: "Amount each time", formula: "Amount (use it as amount in the formula)" }[v.method] ?? "Amount";

  const payload = () => ({
    ...v,
    rules: v.rules.map((r) => ({ ...r, clauses: r.clauses.map((c) => ({ ...c, value: Number.isNaN(c.value) ? "" : c.value })) })),
  });

  const save = () =>
    startSave(async () => {
      setError(null);
      const r = await savePayItem(id, payload());
      if (r.error) {
        setError(r.error);
        return;
      }
      toast.success(r.message ?? "Saved.");
      if (!id && r.id) router.replace(`/app/payroll/allowances/${r.id}`);
      else router.refresh();
    });

  const runTest = () =>
    startTest(async () => {
      if (!testPerson) return void toast.error("Choose a person.");
      const r = await previewPayItems(testPerson, testMonth, { id, input: payload() });
      if (r.error) {
        setTest(null);
        return void toast.error(r.error);
      }
      setTest(r);
    });
  const mine = test?.items?.find((i) => i.draft);

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      <fieldset disabled={!canEdit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>The basics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
              <Field label="Name" htmlFor="pi-name">
                <Input id="pi-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="For example Attendance allowance" />
              </Field>
              <Field label="Type" htmlFor="pi-kind">
                <Select
                  id="pi-kind"
                  value={v.kind}
                  onChange={(e) => set("kind", e.target.value as ItemValues["kind"])}
                  options={[
                    { value: "earning", label: "Allowance (added to pay)" },
                    { value: "deduction", label: "Deduction (taken off pay)" },
                  ]}
                />
              </Field>
            </div>
            <Field label="Description" htmlFor="pi-desc" optional>
              <Input id="pi-desc" value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="What it's for" />
            </Field>
            {!isDeduction && (
              <div className="flex flex-wrap gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={v.is_taxable} onChange={(e) => set("is_taxable", e.target.checked)} className="size-4 accent-[var(--color-accent)]" /> Taxable
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={v.is_pensionable} onChange={(e) => set("is_pensionable", e.target.checked)} className="size-4 accent-[var(--color-accent)]" /> Counts toward pension
                </label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 sm:max-w-md">
              <Field label="In effect from" htmlFor="pi-from" optional>
                <Input id="pi-from" type="date" value={v.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
              </Field>
              <Field label="Until" htmlFor="pi-to" optional>
                <Input id="pi-to" type="date" value={v.effective_to} min={v.effective_from || undefined} onChange={(e) => set("effective_to", e.target.value)} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How it&apos;s worked out</CardTitle>
            <CardDescription>{METHODS.find((m) => m.value === v.method)?.hint}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Method" htmlFor="pi-method">
              <Select id="pi-method" value={v.method} onChange={(e) => set("method", e.target.value)} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} />
            </Field>
            {v.method === "percent" ? (
              <Field label="Percentage of basic salary" htmlFor="pi-pct">
                <Input id="pi-pct" type="number" min={0} step="any" value={v.default_percent ?? ""} onChange={(e) => set("default_percent", e.target.value === "" ? null : Number(e.target.value))} className="max-w-40" />
              </Field>
            ) : (
              <Field label={`${amountLabel} (${currency})`} htmlFor="pi-amount">
                <Input id="pi-amount" type="number" min={0} step="0.01" value={Number.isNaN(v.default_amount) ? "" : v.default_amount} onChange={(e) => set("default_amount", e.target.value === "" ? NaN : Number(e.target.value))} className="max-w-48" />
              </Field>
            )}
            {v.method === "prorated" && (
              <Field label="Measured against" htmlFor="pi-basis" hint={v.prorate_basis === "working" ? "Amount × days present ÷ working days in the month." : "Amount × days in the month they weren't missing from work ÷ days in the month."}>
                <Select
                  id="pi-basis"
                  value={v.prorate_basis}
                  onChange={(e) => set("prorate_basis", e.target.value as ItemValues["prorate_basis"])}
                  options={[
                    { value: "working", label: "Working days in the month" },
                    { value: "calendar", label: "Calendar days in the month" },
                  ]}
                  className="max-w-72"
                />
              </Field>
            )}
            {v.method === "per_occurrence" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Counted" htmlFor="pi-occ">
                  <Select id="pi-occ" value={v.occurrence_var ?? ""} onChange={(e) => set("occurrence_var", e.target.value)} options={OCCURRENCE_VARIABLES.map((o) => ({ value: o.value, label: o.label }))} placeholder="Choose" />
                </Field>
                <Field label="Only after this many in the month" htmlFor="pi-after" hint="0 counts from the first one. 3 means the 4th and later.">
                  <Input id="pi-after" type="number" min={0} step={1} value={v.occurrence_after} onChange={(e) => set("occurrence_after", Number(e.target.value) || 0)} className="max-w-32" />
                </Field>
              </div>
            )}
            {v.method === "formula" && (
              <Field label="Formula" htmlFor="pi-formula">
                <FormulaInput id="pi-formula" value={v.formula} onChange={(x) => set("formula", x)} hint="For example ROUND(basic_salary / working_days * unapproved_absences, 2)" />
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rules</CardTitle>
            <CardDescription>Change the result when something happens. Rules are checked from the top; the first one that fits is used.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              {(
                [
                  ["none", "No rules"],
                  ["builder", "Simple rules"],
                  ["formula", "Rule formula (advanced)"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5", v.rules_mode === k ? "border-foreground" : "border-border text-muted-foreground")}>
                  <input
                    type="radio"
                    name="rules_mode"
                    checked={v.rules_mode === k}
                    onChange={() => {
                      set("rules_mode", k);
                      if (k === "builder" && !v.rules.length)
                        set("rules", [{ label: "", join: "and", clauses: [{ var: "unapproved_absences", op: ">=", value: 3 }], outcome: { type: "percent", value: 50 } }]);
                    }}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
            {v.rules_mode === "builder" && (
              <>
                <ol className="space-y-3">
                  {v.rules.map((r, i) => (
                    <RuleCard
                      key={i}
                      rule={r}
                      index={i}
                      count={v.rules.length}
                      warning={warnings.get(i)}
                      currency={currency}
                      onChange={(nr) => set("rules", v.rules.map((x, j) => (j === i ? nr : x)))}
                      onMove={(dir) => {
                        const next = [...v.rules];
                        [next[i], next[i + dir]] = [next[i + dir], next[i]];
                        set("rules", next);
                      }}
                      onRemove={() => set("rules", v.rules.filter((_, j) => j !== i))}
                    />
                  ))}
                </ol>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={v.rules.length >= 20}
                    onClick={() => set("rules", [...v.rules, { label: "", join: "and", clauses: [{ var: "late_count", op: ">=", value: 3 }], outcome: { type: "nothing" } }])}
                  >
                    <Plus className="size-3.5" aria-hidden /> Add a rule
                  </Button>
                  <p className="text-[13px] text-muted-foreground">Otherwise: {isDeduction ? "take off" : "pay"} the full result.</p>
                </div>
              </>
            )}
            {v.rules_mode === "formula" && (
              <Field label="Rule formula" htmlFor="pi-rules-formula" hint="Here amount is the result worked out above, before this rule.">
                <FormulaInput id="pi-rules-formula" value={v.rules_formula} onChange={(x) => set("rules_formula", x)} hint="For example IF(unapproved_absences >= 3, amount * 0.5, amount)" />
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Who gets it</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              aria-label="Who gets it"
              value={v.applies_to}
              onChange={(e) => set("applies_to", e.target.value as ItemValues["applies_to"])}
              options={[
                { value: "all", label: "All staff" },
                { value: "selected", label: "Only the departments, jobs, locations or people I choose" },
              ]}
              className="max-w-md"
            />
            {v.applies_to === "selected" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="text-sm text-muted-foreground sm:col-span-2">Someone gets it if they match any of what you tick, or have their own amount below.</p>
                <TargetPicker type="department" label="Departments" options={targets.department} chosen={chosen} toggle={toggle} />
                <TargetPicker type="position" label="Job titles" options={targets.position} chosen={chosen} toggle={toggle} />
                <TargetPicker type="branch" label="Locations" options={targets.branch} chosen={chosen} toggle={toggle} />
                <TargetPicker type="employee" label="People" options={targets.employee} chosen={chosen} toggle={toggle} />
              </div>
            )}
          </CardContent>
        </Card>
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
          <Button loading={saving} onClick={save}>
            {id ? "Save" : "Add item"}
          </Button>
          <p className="text-[12px] text-subtle-foreground">Pay runs already finalized never change. Every change is kept in the history.</p>
        </div>
      )}

      {id && (
        <Card>
          <CardHeader>
            <CardTitle>People with their own amount</CardTitle>
            <CardDescription>
              They get this item with their own amount{v.method === "percent" ? " or percentage" : ""}, even if it isn&apos;t for their group.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {overrides.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {overrides.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground">{o.name}</span>
                      <span className="block text-[12px] text-subtle-foreground">
                        {o.percent != null ? `${o.percent}%` : money(Number(o.amount))} from {formatDate(o.start_date, dateFormat)}
                        {o.end_date && ` until ${formatDate(o.end_date, dateFormat)}`}
                      </span>
                    </span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          const r = await removePayItemOverride(id, o.id);
                          if (r.error) return void toast.error(r.error);
                          toast.success(r.message ?? "Removed.");
                          router.refresh();
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <ActionForm action={savePayItemOverride.bind(null, id)} submitLabel="Add their amount" resetOnSuccess onSuccess={() => router.refresh()} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_9rem_10rem]">
                  <Field label="Person" htmlFor="ov-person">
                    <Select id="ov-person" name="employee_id" options={people} placeholder="Choose a person" />
                  </Field>
                  {v.method === "percent" ? (
                    <>
                      <TextField name="percent" label="Percent" type="number" min={0} step="any" />
                      <input type="hidden" name="amount" value="" />
                    </>
                  ) : (
                    <>
                      <TextField name="amount" label={currency} type="number" min={0} step="0.01" />
                      <input type="hidden" name="percent" value="" />
                    </>
                  )}
                  <TextField name="start_date" label="From" type="date" defaultValue={`${month}-01`} />
                </div>
                <input type="hidden" name="end_date" value="" />
              </ActionForm>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Try it</CardTitle>
          <CardDescription>See what this item gives someone for a month, with the changes above (even before saving).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Person" htmlFor="t-person" className="min-w-56 flex-1">
              <Select id="t-person" value={testPerson} onChange={(e) => setTestPerson(e.target.value)} options={people} />
            </Field>
            <Field label="Month" htmlFor="t-month">
              <Input id="t-month" type="month" value={testMonth} onChange={(e) => setTestMonth(e.target.value)} />
            </Field>
            <Button variant="secondary" loading={testing} onClick={runTest}>
              Work it out
            </Button>
          </div>
          {test && mine && (
            <div className="rounded-lg border border-border p-4">
              {mine.applies ? (
                <>
                  <p className="font-display text-2xl tabular">
                    {isDeduction && Number(mine.amount) > 0 ? "−" : ""}
                    {money(Number(mine.amount))}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{mine.explanation}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{mine.why_not}: this item isn&apos;t included for them that month.</p>
              )}
              {test.vars && (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
                  {PAY_VARIABLES.filter((x) => x.key !== "amount").map((x) => (
                    <div key={x.key} className="flex justify-between gap-2 border-b border-border py-1">
                      <dt className="text-subtle-foreground" title={x.hint}>
                        {x.label}
                      </dt>
                      <dd className="tabular">{x.key === "basic_salary" ? money(Number(test.vars![x.key])) : String(test.vars![x.key] ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
