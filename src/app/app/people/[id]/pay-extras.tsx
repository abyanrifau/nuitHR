"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { addLoan, addPersonComponent, endPersonComponent, setLoanStatus } from "@/lib/payroll/actions";
import type { ActionResult } from "@/lib/errors";
import { today } from "@/lib/format";

interface Row {
  id: string;
  name: string;
  kind: string;
  amount: string;
  from: string;
  to: string | null;
}

interface Loan {
  id: string;
  kind: string;
  principal: string;
  installment: string;
  outstanding: string;
  from: string;
  status: string;
  reason: string | null;
}

/** Allowances, regular deductions and loans for one person. Used by every pay run. */
export function PayExtrasPanel({
  employeeId,
  canEdit,
  currency,
  components,
  rows,
  loans,
}: {
  employeeId: string;
  canEdit: boolean;
  currency: string;
  components: { value: string; label: string; kind: string; calc: string; amount: number }[];
  rows: Row[];
  loans: Loan[];
}) {
  const [adding, setAdding] = useState<"component" | "loan" | null>(null);
  const [picked, setPicked] = useState(components[0]?.value ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const compAction = useCallback((s: ActionResult, f: FormData) => addPersonComponent(employeeId, s, f), [employeeId]);
  const loanAction = useCallback((s: ActionResult, f: FormData) => addLoan(employeeId, s, f), [employeeId]);
  const done = () => {
    setAdding(null);
    router.refresh();
  };
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.message ?? "Done.");
        router.refresh();
      }
    });
  const current = rows.filter((r) => !r.to);
  const pickedComp = components.find((c) => c.value === picked);

  return (
    <>
      <section>
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-3">
          <h2 className="text-lg">Allowances and deductions</h2>
          {canEdit && components.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setAdding("component")}>
              <Plus className="size-3.5" aria-hidden /> Add
            </Button>
          )}
        </div>
        {components.length === 0 && (
          <p className="mb-4 text-[13px] text-subtle-foreground">
            No pay items set up yet. Add them, like housing or food allowance, in{" "}
            <Link href="/app/workspace/tools/payroll" className="underline underline-offset-4">
              Pay settings
            </Link>
            .
          </p>
        )}
        {current.length === 0 ? (
          <EmptyState title="Nothing regular" description="Allowances and deductions added here are included in every pay run until you stop them." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {current.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground">
                    {r.name} <Badge className="ml-1">{r.kind === "earning" ? "Added" : "Taken off"}</Badge>
                  </p>
                  <p className="text-[12px] text-subtle-foreground">From {r.from}</p>
                </div>
                <span className="tabular">{r.amount}</span>
                {canEdit && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => endPersonComponent(employeeId, r.id, today()))}>
                    Stop
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-3">
          <h2 className="text-lg">Loans and advances</h2>
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setAdding("loan")}>
              <Plus className="size-3.5" aria-hidden /> Add
            </Button>
          )}
        </div>
        {loans.length === 0 ? (
          <EmptyState title="No loans" description="Loans and salary advances are paid back a set amount each pay run." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {loans.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground">
                    {l.kind === "advance" ? "Salary advance" : "Loan"} of {l.principal} <Badge className="ml-1">{l.status === "active" ? "Being repaid" : l.status === "completed" ? "Repaid" : l.status === "paused" ? "Paused" : "Cancelled"}</Badge>
                  </p>
                  <p className="text-[12px] text-subtle-foreground">
                    {l.installment} a month from {l.from}
                    {l.reason && ` · ${l.reason}`}
                  </p>
                </div>
                <span className="text-right tabular">
                  {l.outstanding}
                  <span className="block text-[11px] text-subtle-foreground">left</span>
                </span>
                {canEdit && (l.status === "active" || l.status === "paused") && (
                  <span className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setLoanStatus(employeeId, l.id, l.status === "active" ? "paused" : "active"))}>
                      {l.status === "active" ? "Pause" : "Restart"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setLoanStatus(employeeId, l.id, "cancelled"))}>
                      Cancel
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={adding === "component"} onClose={() => setAdding(null)} title="Add an allowance or deduction">
        {adding === "component" && (
          <ActionForm action={compAction} onSuccess={done} submitLabel="Add">
            <SelectField name="component_id" label="Pay item" options={components} value={picked} onChange={(e) => setPicked(e.target.value)} />
            {pickedComp?.calc !== "percent_of_basic" && (
              <TextField
                name="amount"
                label={`Amount (${currency})${pickedComp?.calc === "per_day_present" ? " a day worked" : pickedComp?.calc === "per_hour_worked" ? " an hour worked" : " a month"}`}
                type="number"
                min={0}
                step="0.01"
                placeholder={pickedComp?.amount ? String(pickedComp.amount) : ""}
                hint="Leave empty to use the usual amount."
                optional
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <TextField name="start_date" label="From" type="date" defaultValue={today()} />
              <TextField name="end_date" label="Until" type="date" optional />
            </div>
          </ActionForm>
        )}
      </Modal>
      <Modal open={adding === "loan"} onClose={() => setAdding(null)} title="Add a loan or advance">
        {adding === "loan" && (
          <ActionForm action={loanAction} onSuccess={done} submitLabel="Add">
            <SelectField
              name="kind"
              label="Type"
              options={[
                { value: "loan", label: "Loan" },
                { value: "advance", label: "Salary advance" },
              ]}
              defaultValue="loan"
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField name="principal" label={`Amount (${currency})`} type="number" min={0} step="0.01" />
              <TextField name="installment_amount" label="Taken off each month" type="number" min={0} step="0.01" />
            </div>
            <TextField name="start_date" label="First pay run to take it from" type="date" defaultValue={today()} />
            <TextField name="reason" label="Reason" optional />
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
