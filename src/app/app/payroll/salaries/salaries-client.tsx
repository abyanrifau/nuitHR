"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TrendingUp } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { bulkChangeSalaries, deleteSalaryRow, salaryHistory, saveSalary, type BulkRow, type SalaryRow } from "@/lib/payroll/salary-actions";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };

const BASIS = [
  { value: "monthly", label: "Monthly" },
  { value: "daily", label: "Daily" },
  { value: "hourly", label: "Hourly" },
];

/** Change one person's salary from a date, and see every earlier salary. */
export function EditSalaryButton({
  employeeId,
  name,
  today,
  currency,
  current,
  scheduleId,
  schedules,
  dateFormat,
}: {
  employeeId: string;
  name: string;
  today: string;
  currency: string;
  current: { basic_salary: number; pay_basis: string } | null;
  scheduleId: string | null;
  schedules: Opt[];
  dateFormat: string;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<SalaryRow[] | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const load = () =>
    start(async () => {
      const r = await salaryHistory(employeeId);
      if (r.error) toast.error(r.error);
      setHistory(r.rows ?? []);
    });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        {current ? "Change" : "Add"}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${name}: salary`} description="A new salary starts on its date. Earlier salaries are kept.">
        <ActionForm
          action={saveSalary.bind(null, employeeId)}
          submitLabel="Save salary"
          onSuccess={() => {
            load();
            router.refresh();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <TextField name="basic_salary" label={`Basic salary (${currency})`} type="number" min={0} step="0.01" defaultValue={current?.basic_salary ?? ""} />
            <SelectField name="pay_basis" label="Paid" options={BASIS} defaultValue={current?.pay_basis ?? "monthly"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField name="effective_date" label="Starts on" type="date" defaultValue={today} />
            {schedules.length > 0 ? (
              <SelectField name="pay_schedule_id" label="Pay schedule" options={[{ value: "", label: "Company default" }, ...schedules]} defaultValue={scheduleId ?? ""} />
            ) : (
              <span />
            )}
          </div>
          <TextField name="reason" label="Reason" optional placeholder="For example yearly raise" />
        </ActionForm>
        <div className="mt-6">
          <p className="section-label mb-2">history</p>
          {history === null || pending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-24 shrink-0 text-muted-foreground tabular">{formatDate(h.effective_date, dateFormat)}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("tabular", h.effective_date > today && "text-info")}>{formatMoney(h.basic_salary, h.currency)}</span>
                    {h.pay_basis !== "monthly" && <span className="text-subtle-foreground"> · {titleCase(h.pay_basis)}</span>}
                    {h.effective_date > today && <span className="text-subtle-foreground"> · upcoming</span>}
                    {h.reason && <span className="block truncate text-[12px] text-subtle-foreground">{h.reason}</span>}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!confirm("Remove this salary from the history? Pay runs already finalized keep what they paid.")) return;
                      const r = await deleteSalaryRow(employeeId, h.id);
                      if (r.error) return void toast.error(r.error);
                      toast.success(r.message ?? "Removed.");
                      load();
                      router.refresh();
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No salary yet.</p>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Change a group's salaries at once, for example raise a department by 5% from a date. Shows each change before saving. */
export function BulkSalaryButton({
  today,
  currency,
  matching,
  everyone,
  departments,
  branches,
}: {
  today: string;
  currency: string;
  matching: string[];
  everyone: { id: string; department_id: string | null; branch_id: string | null }[];
  departments: Opt[];
  branches: Opt[];
}) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("list");
  const [mode, setMode] = useState<"percent" | "add" | "set">("percent");
  const [value, setValue] = useState("5");
  const [effective, setEffective] = useState(today);
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const ids = () => {
    if (who === "list") return matching;
    if (who === "all") return everyone.map((e) => e.id);
    const [kind, id] = who.split(":");
    return everyone.filter((e) => (kind === "dept" ? e.department_id : e.branch_id) === id).map((e) => e.id);
  };
  const whoOpts = [
    { value: "list", label: `The ${matching.length} ${matching.length === 1 ? "person" : "people"} in the list now` },
    { value: "all", label: `Everyone (${everyone.length})` },
    ...departments.map((d) => ({ value: `dept:${d.value}`, label: `Department: ${d.label}` })),
    ...(branches.length > 1 ? branches.map((b) => ({ value: `branch:${b.value}`, label: `Location: ${b.label}` })) : []),
  ];
  const input = () => ({ ids: ids(), mode, value, effective, reason });
  const reset = () => {
    setRows(null);
    setError(null);
  };
  const previewIt = () =>
    start(async () => {
      setError(null);
      const r = await bulkChangeSalaries(input(), true);
      if (r.error) return setError(r.error);
      setRows(r.rows ?? []);
    });
  const apply = () =>
    start(async () => {
      const r = await bulkChangeSalaries(input(), false);
      if (r.error) return setError(r.error);
      toast.success(r.message ?? "Saved.");
      setOpen(false);
      reset();
      router.refresh();
    });
  const changing = (rows ?? []).filter((r) => !r.skipped);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <TrendingUp className="size-4" aria-hidden /> Change several
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Change several salaries" description="Each person gets a new salary from the date you choose. Their earlier salaries are kept." wide>
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Who" htmlFor="bulk-who">
            <Select
              id="bulk-who"
              options={whoOpts}
              value={who}
              onChange={(e) => {
                setWho(e.target.value);
                reset();
              }}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Change" htmlFor="bulk-mode">
              <Select
                id="bulk-mode"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  reset();
                }}
                options={[
                  { value: "percent", label: "Raise by a percentage" },
                  { value: "add", label: "Add an amount" },
                  { value: "set", label: "Set everyone to" },
                ]}
              />
            </Field>
            <Field label={mode === "percent" ? "Percent" : currency} htmlFor="bulk-value">
              <Input
                id="bulk-value"
                type="number"
                step="0.01"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  reset();
                }}
              />
            </Field>
            <Field label="Starts on" htmlFor="bulk-date">
              <Input
                id="bulk-date"
                type="date"
                value={effective}
                onChange={(e) => {
                  setEffective(e.target.value);
                  reset();
                }}
              />
            </Field>
          </div>
          <Field label="Reason" htmlFor="bulk-reason" optional>
            <Input id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example 2027 yearly raise" />
          </Field>
          {rows && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-subtle-foreground">
                    <th className="px-3 py-2 font-normal">Person</th>
                    <th className="px-3 py-2 text-right font-normal">Now</th>
                    <th className="px-3 py-2 text-right font-normal">From {formatDate(effective)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employee_id} className="border-t border-border">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-right tabular text-muted-foreground">{r.old === null ? "–" : formatMoney(r.old, currency)}</td>
                      <td className={cn("px-3 py-1.5 text-right tabular", r.skipped && "text-subtle-foreground")}>
                        {r.skipped ? r.skipped : formatMoney(r.new, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {rows ? (
              <>
                <Button loading={pending} disabled={!changing.length} onClick={apply}>
                  Save {changing.length} {changing.length === 1 ? "change" : "changes"}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  Back
                </Button>
              </>
            ) : (
              <Button loading={pending} onClick={previewIt}>
                Show the changes
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
