"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { saveClaimTypes } from "@/lib/onboarding/actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox, Switch } from "@/components/ui/switch";

export interface ClaimTypeRow {
  id?: string;
  name: string;
  key: "transport" | "meals" | "travel" | "supplies" | "custom";
  cutoff_day: number | null;
  max_amount: number | null;
  requires_receipt: boolean;
  payout_method: "payroll" | "separate";
  is_active: boolean;
}

/** Claim types and the rules for each: cut-off day, limit, receipt, and how it's paid. */
export function ClaimTypesEditor({ initial, payrollOn, currency }: { initial: ClaimTypeRow[]; payrollOn: boolean; currency: string }) {
  const [rows, setRows] = useState<ClaimTypeRow[]>(initial);
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const update = (i: number, patch: Partial<ClaimTypeRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <div className="space-y-5">
      {!payrollOn && (
        <Alert tone="info" title="Payroll is off">
          Approved claims will show as &ldquo;to be paid&rdquo; so you can pay them yourself, and you can export the list. Switch on Payroll if
          you&apos;d like them added to pay runs.
        </Alert>
      )}
      <ul className="space-y-3">
        {rows.map((t, i) => (
          <li key={t.id ?? `new-${i}`} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {t.key !== "custom" && <Badge>built in</Badge>}
                {!t.is_active && <Badge tone="warning">hidden</Badge>}
              </div>
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                Available to staff
                <Switch checked={t.is_active} onChange={(v) => update(i, { is_active: v })} label={`${t.name || "Claim type"} available`} />
              </label>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Name" htmlFor={`ct-name-${i}`} className="lg:col-span-2">
                <Input id={`ct-name-${i}`} value={t.name} onChange={(e) => update(i, { name: e.target.value })} />
              </Field>
              <Field label="Cut-off day" htmlFor={`ct-cut-${i}`} hint="Later claims move to next month">
                <Input
                  id={`ct-cut-${i}`}
                  type="number"
                  min={1}
                  max={28}
                  placeholder="None"
                  value={t.cutoff_day ?? ""}
                  onChange={(e) => update(i, { cutoff_day: num(e.target.value) })}
                />
              </Field>
              <Field label={`Limit per claim (${currency})`} htmlFor={`ct-max-${i}`}>
                <Input
                  id={`ct-max-${i}`}
                  type="number"
                  min={1}
                  placeholder="No limit"
                  value={t.max_amount ?? ""}
                  onChange={(e) => update(i, { max_amount: num(e.target.value) })}
                />
              </Field>
              <Field label="Paid" htmlFor={`ct-pay-${i}`} className="lg:col-span-2">
                <Select
                  id={`ct-pay-${i}`}
                  value={t.payout_method}
                  onChange={(e) => update(i, { payout_method: e.target.value as ClaimTypeRow["payout_method"] })}
                  options={[
                    { value: "payroll", label: payrollOn ? "In the next payroll" : "In payroll (when Payroll is on)" },
                    { value: "separate", label: "Separately, outside payroll" },
                  ]}
                />
              </Field>
              <div className="flex items-end lg:col-span-2">
                <Checkbox label="Receipt photo required" checked={t.requires_receipt} onChange={(v) => update(i, { requires_receipt: v })} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          setRows((r) => [
            ...r,
            { name: "", key: "custom", cutoff_day: null, max_amount: null, requires_receipt: true, payout_method: "payroll", is_active: true },
          ])
        }
      >
        <Plus className="size-4" aria-hidden /> Add a claim type
      </Button>
      <div className="space-y-3 border-t border-border pt-5">
        {result?.error && <Alert tone="danger">{result.error}</Alert>}
        {result?.message && <Alert tone="success">{result.message}</Alert>}
        <Button
          size="lg"
          loading={pending}
          onClick={() =>
            start(async () => {
              setResult(null);
              setResult(await saveClaimTypes(rows.map((r) => ({ ...r, name: r.name.trim() }))));
            })
          }
        >
          Save claim types
        </Button>
      </div>
    </div>
  );
}
