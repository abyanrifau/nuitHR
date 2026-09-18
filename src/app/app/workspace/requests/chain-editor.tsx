"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveWorkflow } from "@/lib/requests/actions";

export interface Step {
  approver_type: "direct_manager" | "manager_of_manager" | "department_head" | "role" | "user";
  approver_role_id: string | null;
  approver_user_id: string | null;
  min_amount: number | null;
}

type Opt = { value: string; label: string };

const APPROVERS = [
  { value: "direct_manager", label: "Their manager" },
  { value: "manager_of_manager", label: "Their manager's manager" },
  { value: "department_head", label: "Head of their department" },
  { value: "role", label: "Anyone with a role" },
  { value: "user", label: "A specific person" },
];

export function ChainEditor({
  canEdit,
  currency,
  types,
  chains,
  roles,
  people,
}: {
  canEdit: boolean;
  currency: string;
  types: { key: string; label: string; usesAmount: boolean }[];
  chains: Record<string, Step[]>;
  roles: Opt[];
  people: Opt[];
}) {
  return (
    <div className="space-y-6">
      {types.map((t) => (
        <Chain key={t.key} type={t} initial={chains[t.key] ?? []} canEdit={canEdit} currency={currency} roles={roles} people={people} />
      ))}
    </div>
  );
}

function Chain({
  type,
  initial,
  canEdit,
  currency,
  roles,
  people,
}: {
  type: { key: string; label: string; usesAmount: boolean };
  initial: Step[];
  canEdit: boolean;
  currency: string;
  roles: Opt[];
  people: Opt[];
}) {
  const [steps, setSteps] = useState<Step[]>(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(steps) !== JSON.stringify(initial);
  const set = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  return (
    <section className="rounded-xl border border-border p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg">{type.label}</h2>
        {steps.length === 0 && <span className="text-[13px] text-subtle-foreground">Default: manager, then HR</span>}
      </div>
      {steps.length > 0 && (
        <ol className="mt-4 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
              <span className="w-14 text-[13px] text-subtle-foreground">Step {i + 1}</span>
              <div className="min-w-[12rem] flex-1">
                <Select
                  aria-label={`Step ${i + 1} approver`}
                  options={APPROVERS}
                  value={s.approver_type}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { approver_type: e.target.value as Step["approver_type"], approver_role_id: null, approver_user_id: null })}
                />
              </div>
              {s.approver_type === "role" && (
                <div className="min-w-[10rem] flex-1">
                  <Select aria-label="Role" options={roles} placeholder="Choose a role" value={s.approver_role_id ?? ""} disabled={!canEdit} onChange={(e) => set(i, { approver_role_id: e.target.value || null })} />
                </div>
              )}
              {s.approver_type === "user" && (
                <div className="min-w-[10rem] flex-1">
                  <Select aria-label="Person" options={people} placeholder="Choose a person" value={s.approver_user_id ?? ""} disabled={!canEdit} onChange={(e) => set(i, { approver_user_id: e.target.value || null })} />
                </div>
              )}
              {type.usesAmount && i > 0 && (
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  only from {currency}
                  <Input
                    type="number"
                    min={0}
                    className="w-28"
                    value={s.min_amount ?? ""}
                    disabled={!canEdit}
                    placeholder="any"
                    onChange={(e) => set(i, { min_amount: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </label>
              )}
              {canEdit && (
                <span className="ml-auto flex">
                  <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Remove step" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {type.usesAmount && steps.length > 1 && <p className="mt-3 text-[13px] text-subtle-foreground">Steps with an amount are skipped for smaller requests.</p>}
      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          {steps.length < 5 && (
            <Button variant="secondary" size="sm" onClick={() => setSteps((s) => [...s, { approver_type: "direct_manager", approver_role_id: null, approver_user_id: null, min_amount: null }])}>
              <Plus className="size-3.5" aria-hidden /> Add step
            </Button>
          )}
          {dirty && (
            <>
              <Button
                size="sm"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await saveWorkflow({ request_type: type.key, steps });
                    if (r.error) toast.error(r.error);
                    else toast.success(r.message ?? "Saved.");
                  })
                }
              >
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSteps(initial)}>
                Undo changes
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
