"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Calculator, ChevronDown, Download, FileText, Lock, Mail, Plus, Trash2, Undo2 } from "lucide-react";
import { ActionForm, CheckboxField, SelectField, TextField } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { addAdjustment, approveRun, deleteRun, finalizeRun, markPaid, recalculate, removeAdjustment, reverseRun, setPersonStatus, unapproveRun } from "@/lib/payroll/actions";
import { emailPayslips } from "@/lib/payroll/payslip-email";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RunActions({
  run,
  can,
}: {
  run: { id: string; status: string; errors: number; emailed: boolean };
  can: { edit: boolean; approve: boolean; del: boolean; exp: boolean; owner: boolean };
}) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<"approve" | "finalize" | "delete" | "reverse" | "paid" | "email" | null>(null);
  const [reason, setReason] = useState("");
  const router = useRouter();
  const go = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setConfirm(null);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Done.");
      if (after) after();
      else router.refresh();
    });
  const open = run.status === "draft" || run.status === "calculated";
  const done = run.status === "finalized" || run.status === "paid";

  return (
    <>
      {can.exp && run.status !== "draft" && (
        <details className="relative">
          <summary className={cn(buttonClasses({ variant: "secondary" }), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
            <Download className="size-4" aria-hidden /> Download <ChevronDown className="size-3.5" aria-hidden />
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-border-strong bg-surface-raised text-sm">
            {[
              ["bank", "Bank transfer file (CSV)"],
              ["summary", "Pay summary (CSV)"],
              ["journal", "Payroll journal for the accountant (CSV)"],
              ["pension", "Pension report (CSV)"],
              ["tax", "Tax report (CSV)"],
            ].map(([k, label]) => (
              <a key={k} href={`/app/payroll/${run.id}/export?type=${k}`} className="block px-4 py-2.5 hover:bg-accent-soft">
                {label}
              </a>
            ))}
          </div>
        </details>
      )}
      {open && can.edit && (
        <Button variant="secondary" loading={pending} onClick={() => go(() => recalculate(run.id))}>
          <Calculator className="size-4" aria-hidden /> Calculate again
        </Button>
      )}
      {run.status === "calculated" && can.approve && (
        <Button disabled={pending || run.errors > 0} onClick={() => setConfirm("approve")}>
          <BadgeCheck className="size-4" aria-hidden /> Approve
        </Button>
      )}
      {run.status === "approved" && can.approve && (
        <>
          <Button variant="ghost" loading={pending} onClick={() => go(() => unapproveRun(run.id))}>
            <Undo2 className="size-4" aria-hidden /> Undo approval
          </Button>
          <Button disabled={pending} onClick={() => setConfirm("finalize")}>
            <Lock className="size-4" aria-hidden /> Finalize
          </Button>
        </>
      )}
      {done && can.edit && (
        <Button variant="secondary" disabled={pending} onClick={() => setConfirm("email")}>
          <Mail className="size-4" aria-hidden /> {run.emailed ? "Email payslips again" : "Email payslips"}
        </Button>
      )}
      {run.status === "finalized" && can.approve && (
        <Button disabled={pending} onClick={() => setConfirm("paid")}>
          Mark as paid
        </Button>
      )}
      {(open || run.status === "approved") && can.del && (
        <Button variant="ghost" disabled={pending} onClick={() => setConfirm("delete")} aria-label="Delete pay run">
          <Trash2 className="size-4" aria-hidden />
        </Button>
      )}
      {done && can.owner && (
        <Button variant="danger" disabled={pending} onClick={() => setConfirm("reverse")}>
          Reverse
        </Button>
      )}

      <ConfirmDialog
        open={confirm === "approve"}
        tone="primary"
        title="Approve this pay run?"
        confirmLabel="Approve"
        onCancel={() => setConfirm(null)}
        onConfirm={() => go(() => approveRun(run.id))}
      >
        It can&apos;t be changed or calculated again after this, unless you undo the approval. Finalizing comes next.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "email"}
        tone="primary"
        title={run.emailed ? "Email payslips again?" : "Email everyone their payslip?"}
        confirmLabel={run.emailed ? "Send to people not sent yet" : "Send payslips"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => go(() => emailPayslips(run.id, run.emailed))}
      >
        Each person gets an email with their payslip attached as a PDF, to their work email (or personal email, or the email they sign in with).
        {run.emailed && " Only people who haven't been sent theirs yet get one."}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "finalize"}
        tone="primary"
        title="Finalize this pay run?"
        confirmLabel="Finalize"
        onCancel={() => setConfirm(null)}
        onConfirm={() => go(() => finalizeRun(run.id))}
      >
        It&apos;s locked for good after this. Payslips appear in everyone&apos;s staff app, loan repayments are recorded, and claims are marked paid. People on hold are left out. Only the owner can reverse it.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "paid"} tone="primary" title="Mark as paid?" confirmLabel="Mark as paid" onCancel={() => setConfirm(null)} onConfirm={() => go(() => markPaid(run.id))}>
        Do this once the bank transfers have gone out.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this pay run?"
        confirmLabel="Delete"
        onCancel={() => setConfirm(null)}
        onConfirm={() => go(() => deleteRun(run.id), () => router.push("/app/payroll"))}
      >
        Nothing has been paid yet, so nothing else changes.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "reverse"} title="Reverse this pay run?" confirmLabel="Reverse" onCancel={() => setConfirm(null)} onConfirm={() => go(() => reverseRun(run.id, reason))}>
        <p className="mb-2">Payslips stay on record, marked reversed. Loan repayments and claims go back so you can run the period again.</p>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why, for example wrong allowance for two people" aria-label="Reason" />
      </ConfirmDialog>
    </>
  );
}

interface Person {
  id: string;
  employeeId: string;
  name: string;
  code: string | null;
  position: string | null;
  status: string;
  paidDays: number;
  periodDays: number;
  unpaid: number;
  gross: number;
  deductions: number;
  net: number;
  employer: number;
  exceptions: { code: string; message: string; severity: string }[];
  lines: { id: string; name: string; kind: string; amount: number; quantity: number | string | null; manual: boolean; explanation: string | null }[];
}

export function RunPeople({ runId, locked, canEdit, currency, people }: { runId: string; locked: boolean; canEdit: boolean; currency: string; people: Person[] }) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [adding, setAdding] = useState<Person | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const addAction = useCallback((s: ActionResult, f: FormData) => addAdjustment(runId, s, f), [runId]);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Done.");
      router.refresh();
    });

  if (!people.length) {
    return <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">Nobody on this run yet. Select Calculate again.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="hidden grid-cols-[1fr_7rem_8rem_8rem_8rem_2rem] gap-3 border-b border-border px-4 py-3 text-[11px] tracking-[0.12em] text-subtle-foreground uppercase md:grid">
        <span>Person</span>
        <span className="text-right">Days</span>
        <span className="text-right">Earnings</span>
        <span className="text-right">Deductions</span>
        <span className="text-right">Net pay</span>
        <span />
      </div>
      <ul>
        {people.map((p) => {
          const open = openRow === p.id;
          const held = p.status !== "included";
          return (
            <li key={p.id} className={cn("border-b border-border last:border-b-0", held && "opacity-60")}>
              <button
                type="button"
                onClick={() => setOpenRow(open ? null : p.id)}
                aria-expanded={open}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent-soft md:grid-cols-[1fr_7rem_8rem_8rem_8rem_2rem]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-foreground">
                    {p.name} {held && <Badge className="ml-1">On hold</Badge>}
                  </span>
                  <span className="block truncate text-[12px] text-subtle-foreground">
                    {[p.code, p.position].filter(Boolean).join(" · ")}
                    {p.exceptions.map((x) => (
                      <span key={x.code} className={cn("ml-2", x.severity === "error" ? "text-danger" : "text-warning")}>
                        {x.message}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="hidden text-right text-muted-foreground tabular md:block">
                  {p.paidDays.toFixed(1)}/{p.periodDays}
                </span>
                <span className="hidden text-right tabular md:block">{money(p.gross)}</span>
                <span className="hidden text-right text-muted-foreground tabular md:block">{money(p.deductions)}</span>
                <span className="text-right text-foreground tabular">
                  {money(p.net)}
                  <span className="block text-[11px] text-subtle-foreground md:hidden">net</span>
                </span>
                <ChevronDown className={cn("hidden size-4 text-subtle-foreground transition-transform md:block", open && "rotate-180")} aria-hidden />
              </button>
              {open && (
                <div className="grid gap-6 border-t border-border bg-surface-muted/30 px-4 py-4 text-sm md:grid-cols-2">
                  {(["earning", "deduction"] as const).map((kind) => (
                    <div key={kind}>
                      <p className="mb-2 text-[11px] tracking-[0.12em] text-subtle-foreground uppercase">{kind === "earning" ? "Earnings" : "Deductions"}</p>
                      <ul className="space-y-1">
                        {p.lines
                          .filter((l) => l.kind === kind)
                          .map((l) => (
                            <li key={l.id} className="flex items-start justify-between gap-2">
                              <span className="text-muted-foreground">
                                {l.name}
                                {l.explanation && <span className="block text-[12px] text-subtle-foreground">{l.explanation}</span>}
                                {l.manual && !locked && canEdit && (
                                  <button type="button" onClick={() => run(() => removeAdjustment(runId, l.id))} className="ml-2 text-[12px] text-danger underline underline-offset-2" disabled={pending}>
                                    remove
                                  </button>
                                )}
                              </span>
                              <span className="tabular">{money(l.amount)}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                  {p.employer > 0 && (
                    <p className="text-[13px] text-subtle-foreground md:col-span-2">
                      Employer pension on top: {currency} {money(p.employer)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    {locked ? (
                      <a href={`/staff/pay/payslip/${p.id}`} target="_blank" rel="noopener" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                        <FileText className="size-3.5" aria-hidden /> Payslip PDF
                      </a>
                    ) : (
                      canEdit && (
                        <>
                          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setAdding(p)}>
                            <Plus className="size-3.5" aria-hidden /> Add a one-off amount
                          </Button>
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setPersonStatus(runId, p.employeeId, held ? "included" : "on_hold"))}>
                            {held ? "Include in this run" : "Put on hold"}
                          </Button>
                          <a href={`/staff/pay/payslip/${p.id}`} target="_blank" rel="noopener" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                            <FileText className="size-3.5" aria-hidden /> Preview payslip
                          </a>
                        </>
                      )
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Modal open={Boolean(adding)} onClose={() => setAdding(null)} title={`One-off amount for ${adding?.name ?? ""}`} description="For this run only, for example a bonus, an advance or a correction. It stays when you calculate again.">
        {adding && (
          <ActionForm
            action={addAction}
            submitLabel="Add"
            onSuccess={() => {
              setAdding(null);
              router.refresh();
            }}
          >
            <input type="hidden" name="employee_id" value={adding.employeeId} />
            <TextField name="name" label="What it's for" placeholder="For example Eid bonus" />
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                name="kind"
                label="Type"
                options={[
                  { value: "earning", label: "Add to pay" },
                  { value: "deduction", label: "Take off pay" },
                ]}
                defaultValue="earning"
              />
              <TextField name="amount" label={`Amount (${currency})`} type="number" min={0} step="0.01" inputMode="decimal" />
            </div>
            <CheckboxField name="taxable" label="Taxable" defaultChecked />
            <CheckboxField name="pensionable" label="Counts for pension" />
            <TextField name="reason" label="Reason" placeholder="Why it's being added. Kept in the history." />
          </ActionForm>
        )}
      </Modal>
    </div>
  );
}
