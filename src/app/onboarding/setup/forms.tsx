"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { SetupConfig } from "@/modules/setup-defaults";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox, Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { SetupActions } from "./setup-actions";

type FormProps<M extends "employees" | "leave" | "attendance" | "payroll" | "transport" | "performance"> = {
  initial: SetupConfig<M>;
  nextLabel: string;
  note?: string;
};

const num = (v: string) => (v === "" ? ("" as unknown as number) : Number(v));

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="ghost" size="sm" aria-label={label} onClick={onClick} disabled={disabled}>
      <Trash2 className="size-4" aria-hidden />
    </Button>
  );
}

// ---------------------------------------------------------------------
// Departments & positions
// ---------------------------------------------------------------------
export function EmployeesSetupForm({ initial, nextLabel }: FormProps<"employees">) {
  const [depts, setDepts] = useState(initial.departments);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const update = (i: number, patch: Partial<(typeof depts)[number]>) => setDepts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments &amp; positions</CardTitle>
        <CardDescription>We&apos;ve suggested a starting structure for your industry. Rename, remove or add anything.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {depts.map((d, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="flex gap-2">
              <Input
                aria-label={`Department ${i + 1} name`}
                value={d.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Department name"
              />
              <RemoveButton
                label={`Remove ${d.name || "department"}`}
                onClick={() => setDepts((x) => x.filter((_, j) => j !== i))}
                disabled={depts.length === 1}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {d.positions.map((p, k) => (
                <span key={p + k} className="inline-flex items-center gap-1 rounded-lg border border-border py-1 pr-1 pl-3 text-sm">
                  {p}
                  <button
                    type="button"
                    aria-label={`Remove position ${p}`}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent-soft hover:text-foreground"
                    onClick={() => update(i, { positions: d.positions.filter((_, m) => m !== k) })}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = (draft[i] ?? "").trim();
                  if (v && !d.positions.includes(v)) update(i, { positions: [...d.positions, v] });
                  setDraft((x) => ({ ...x, [i]: "" }));
                }}
              >
                <Input
                  aria-label={`Add a position to ${d.name || "this department"}`}
                  className="h-8 w-44"
                  placeholder="Add a position…"
                  value={draft[i] ?? ""}
                  onChange={(e) => setDraft((x) => ({ ...x, [i]: e.target.value }))}
                />
                <Button type="submit" size="sm" variant="secondary" aria-label="Add position">
                  <Plus className="size-4" aria-hidden />
                </Button>
              </form>
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => setDepts((d) => [...d, { name: "", positions: [] }])}>
          <Plus className="size-4" aria-hidden /> Add department
        </Button>
        <SetupActions module="employees" nextLabel={nextLabel} getConfig={() => ({ departments: depts.filter((d) => d.name.trim()) })} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Leave types & holidays
// ---------------------------------------------------------------------
export function LeaveSetupForm({ initial, nextLabel }: FormProps<"leave">) {
  const [types, setTypes] = useState(initial.leave_types);
  const [holidays, setHolidays] = useState(initial.holidays);
  const update = (i: number, patch: Partial<(typeof types)[number]>) => setTypes((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Leave types &amp; entitlements</CardTitle>
          <CardDescription>
            Days per year for each type. These starting values follow common Maldives practice. Please check them against your contracts and the
            Employment Act.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden grid-cols-[1fr_5rem_8rem_6rem_7rem_auto] gap-2 px-1 text-xs text-muted-foreground md:grid">
            <span>Leave type</span>
            <span>Days/year</span>
            <span>How it builds up</span>
            <span>Carry over</span>
            <span>Who</span>
            <span />
          </div>
          {types.map((t, i) => (
            <div key={i} className="rounded-lg border border-border p-3 md:border-0 md:p-0">
              <div className="grid gap-2 md:grid-cols-[1fr_5rem_8rem_6rem_7rem_auto] md:items-center">
                <Input aria-label="Leave type name" value={t.name} onChange={(e) => update(i, { name: e.target.value })} />
                <Input
                  aria-label={`${t.name}: days per year`}
                  type="number"
                  min={0}
                  value={t.days}
                  onChange={(e) => update(i, { days: num(e.target.value) })}
                />
                <Select
                  aria-label={`${t.name}: accrual`}
                  value={t.accrual}
                  onChange={(e) => update(i, { accrual: e.target.value as typeof t.accrual })}
                  options={[
                    { value: "upfront", label: "All at once" },
                    { value: "monthly", label: "Monthly" },
                    { value: "yearly", label: "Yearly" },
                    { value: "none", label: "No balance" },
                  ]}
                />
                <Input
                  aria-label={`${t.name}: days carried over`}
                  type="number"
                  min={0}
                  value={t.carry_forward}
                  onChange={(e) => update(i, { carry_forward: num(e.target.value) })}
                />
                <Select
                  aria-label={`${t.name}: eligibility`}
                  value={t.gender}
                  onChange={(e) => update(i, { gender: e.target.value as typeof t.gender })}
                  options={[
                    { value: "any", label: "Everyone" },
                    { value: "female", label: "Women" },
                    { value: "male", label: "Men" },
                  ]}
                />
                <RemoveButton label={`Remove ${t.name}`} onClick={() => setTypes((x) => x.filter((_, j) => j !== i))} disabled={types.length === 1} />
              </div>
              <div className="mt-2 flex flex-wrap gap-4 md:mb-2">
                <Checkbox label="Paid" checked={t.paid} onChange={(v) => update(i, { paid: v })} />
                <Checkbox
                  label="Needs a document (e.g. medical certificate)"
                  checked={t.requires_document}
                  onChange={(v) => update(i, { requires_document: v })}
                />
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setTypes((t) => [
                ...t,
                {
                  code: `C${t.length + 1}`,
                  name: "",
                  days: 0,
                  paid: true,
                  accrual: "upfront",
                  carry_forward: 0,
                  gender: "any",
                  requires_document: false,
                },
              ])
            }
          >
            <Plus className="size-4" aria-hidden /> Add leave type
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Public holidays</CardTitle>
          <CardDescription>
            {holidays.length
              ? "Pre-loaded as a starting point. Islamic holidays depend on the moon, so check the dates against official announcements. You can edit the full calendar later."
              : "Add your public holidays later from the Leave calendar."}
          </CardDescription>
        </CardHeader>
        {holidays.length > 0 && (
          <CardContent>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {holidays.map((h, i) => (
                <li key={h.date + h.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="inline-block w-24 text-muted-foreground tabular">{h.date.split("-").reverse().join("/")}</span> {h.name}
                  </span>
                  <RemoveButton label={`Remove ${h.name}`} onClick={() => setHolidays((x) => x.filter((_, j) => j !== i))} />
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
      <SetupActions
        module="leave"
        nextLabel={nextLabel}
        getConfig={() => ({
          leave_types: types.map((t, i) => ({ ...t, code: t.code || `C${i + 1}` })),
          holidays,
        })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Shifts & attendance rules
// ---------------------------------------------------------------------
export function AttendanceSetupForm({ initial, nextLabel }: FormProps<"attendance">) {
  const [shifts, setShifts] = useState(initial.shifts);
  const [p, setP] = useState(initial.policy);
  const setPolicy = (patch: Partial<typeof p>) => setP((x) => ({ ...x, ...patch }));
  const updateShift = (i: number, patch: Partial<(typeof shifts)[number]>) => setShifts((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Shifts</CardTitle>
          <CardDescription>Your usual working hours. Night shifts that end the next morning are handled automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {shifts.map((s, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_7rem_7rem_auto] sm:items-end">
              <Field label="Name" htmlFor={`shift-name-${i}`} className="col-span-2 sm:col-span-1">
                <Input id={`shift-name-${i}`} value={s.name} onChange={(e) => updateShift(i, { name: e.target.value })} />
              </Field>
              <Field label="Starts" htmlFor={`shift-start-${i}`}>
                <Input id={`shift-start-${i}`} type="time" value={s.start} onChange={(e) => updateShift(i, { start: e.target.value })} />
              </Field>
              <Field label="Ends" htmlFor={`shift-end-${i}`}>
                <Input id={`shift-end-${i}`} type="time" value={s.end} onChange={(e) => updateShift(i, { end: e.target.value })} />
              </Field>
              <Field label="Break (min)" htmlFor={`shift-break-${i}`}>
                <Input
                  id={`shift-break-${i}`}
                  type="number"
                  min={0}
                  value={s.break_minutes}
                  onChange={(e) => updateShift(i, { break_minutes: num(e.target.value) })}
                />
              </Field>
              <RemoveButton
                label={`Remove ${s.name || "shift"}`}
                onClick={() => setShifts((x) => x.filter((_, j) => j !== i))}
                disabled={shifts.length === 1}
              />
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShifts((s) => [...s, { name: "", start: "09:00", end: "18:00", break_minutes: 60 }])}
          >
            <Plus className="size-4" aria-hidden /> Add shift
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>How lateness, half days and overtime are counted.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Grace period (minutes)" htmlFor="grace" hint="Late after this many minutes.">
            <Input id="grace" type="number" min={0} value={p.grace_minutes} onChange={(e) => setPolicy({ grace_minutes: num(e.target.value) })} />
          </Field>
          <Field label="Full day (hours)" htmlFor="full">
            <Input
              id="full"
              type="number"
              min={1}
              step="0.5"
              value={p.full_day_hours}
              onChange={(e) => setPolicy({ full_day_hours: num(e.target.value) })}
            />
          </Field>
          <Field label="Half day if fewer than (hours)" htmlFor="half">
            <Input
              id="half"
              type="number"
              min={0}
              step="0.5"
              value={p.half_day_min_hours}
              onChange={(e) => setPolicy({ half_day_min_hours: num(e.target.value) })}
            />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-3">
            <Switch id="ot" checked={p.overtime_enabled} onChange={(v) => setPolicy({ overtime_enabled: v })} />
            <label htmlFor="ot" className="text-sm">
              Count overtime
            </label>
          </div>
          {p.overtime_enabled && (
            <>
              <Field label="Overtime starts after (minutes)" htmlFor="ot-after">
                <Input
                  id="ot-after"
                  type="number"
                  min={0}
                  value={p.overtime_after_minutes}
                  onChange={(e) => setPolicy({ overtime_after_minutes: num(e.target.value) })}
                />
              </Field>
              <Field label="Rate on work days (×)" htmlFor="ot-wd">
                <Input
                  id="ot-wd"
                  type="number"
                  min={1}
                  step="0.05"
                  value={p.overtime_rate_weekday}
                  onChange={(e) => setPolicy({ overtime_rate_weekday: num(e.target.value) })}
                />
              </Field>
              <Field label="Rate on rest days (×)" htmlFor="ot-rd">
                <Input
                  id="ot-rd"
                  type="number"
                  min={1}
                  step="0.05"
                  value={p.overtime_rate_rest_day}
                  onChange={(e) => setPolicy({ overtime_rate_rest_day: num(e.target.value) })}
                />
              </Field>
              <Field label="Rate on public holidays (×)" htmlFor="ot-ph">
                <Input
                  id="ot-ph"
                  type="number"
                  min={1}
                  step="0.05"
                  value={p.overtime_rate_holiday}
                  onChange={(e) => setPolicy({ overtime_rate_holiday: num(e.target.value) })}
                />
              </Field>
            </>
          )}
          <div className="space-y-2 sm:col-span-3">
            <Checkbox label="Record GPS location when staff clock in" checked={p.require_gps} onChange={(v) => setPolicy({ require_gps: v })} />
            <Checkbox label="Ask for a selfie when staff clock in" checked={p.require_selfie} onChange={(v) => setPolicy({ require_selfie: v })} />
          </div>
        </CardContent>
      </Card>
      <SetupActions module="attendance" nextLabel={nextLabel} getConfig={() => ({ shifts: shifts.filter((s) => s.name.trim()), policy: p })} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Pay cycle & statutory
// ---------------------------------------------------------------------
export function PayrollSetupForm({ initial, nextLabel }: FormProps<"payroll">) {
  const [schedule, setSchedule] = useState(initial.schedule);
  const [pension, setPension] = useState(initial.pension);
  const [tax, setTax] = useState(initial.tax);
  const [components, setComponents] = useState(initial.components);
  const updateBracket = (i: number, patch: Partial<(typeof tax.brackets)[number]>) =>
    setTax((t) => ({ ...t, brackets: t.brackets.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));

  return (
    <div className="space-y-6">
      <Alert tone="warning" title="Please check these rates">
        Pension and tax rates are starting points only and can change. Confirm them with MIRA and the Pension Office before running real payroll. You
        can change them anytime in Payroll settings.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Pay cycle</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="How often you pay" htmlFor="freq">
            <Select
              id="freq"
              value={schedule.frequency}
              onChange={(e) => setSchedule({ ...schedule, frequency: e.target.value as typeof schedule.frequency })}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "semi_monthly", label: "Twice a month" },
                { value: "weekly", label: "Weekly" },
              ]}
            />
          </Field>
          <Field label="Pay period starts on day" htmlFor="start" hint="e.g. 1 = 1st to end of month">
            <Input
              id="start"
              type="number"
              min={1}
              max={28}
              value={schedule.period_start_day}
              onChange={(e) => setSchedule({ ...schedule, period_start_day: num(e.target.value) })}
            />
          </Field>
          <Field label="Pay day (day of month)" htmlFor="payday">
            <Input
              id="payday"
              type="number"
              min={1}
              max={31}
              value={schedule.pay_day}
              onChange={(e) => setSchedule({ ...schedule, pay_day: num(e.target.value) })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pension</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <Field label="Scheme name" htmlFor="pname" className="sm:col-span-4">
            <Input id="pname" value={pension.name} onChange={(e) => setPension({ ...pension, name: e.target.value })} />
          </Field>
          <Field label="Employee pays (%)" htmlFor="pe">
            <Input
              id="pe"
              type="number"
              min={0}
              step="0.1"
              value={pension.employee_rate}
              onChange={(e) => setPension({ ...pension, employee_rate: num(e.target.value) })}
            />
          </Field>
          <Field label="Employer pays (%)" htmlFor="pr">
            <Input
              id="pr"
              type="number"
              min={0}
              step="0.1"
              value={pension.employer_rate}
              onChange={(e) => setPension({ ...pension, employer_rate: num(e.target.value) })}
            />
          </Field>
          <Field label="Applies to" htmlFor="pa" className="sm:col-span-2">
            <Select
              id="pa"
              value={pension.applies_to}
              onChange={(e) => setPension({ ...pension, applies_to: e.target.value as typeof pension.applies_to })}
              options={[
                { value: "locals", label: "Local staff only" },
                { value: "all", label: "All staff" },
                { value: "expatriates", label: "Expatriate staff only" },
              ]}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Income tax brackets ({tax.basis === "monthly" ? "per month" : "per year"})</CardTitle>
          <CardDescription>Tax is charged at each rate only on the part of income inside that band.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {tax.brackets.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_6rem_auto] items-center gap-2">
              <Input
                aria-label={`Band ${i + 1} from`}
                type="number"
                min={0}
                value={b.lower}
                onChange={(e) => updateBracket(i, { lower: num(e.target.value) })}
              />
              <Input
                aria-label={`Band ${i + 1} up to`}
                type="number"
                min={0}
                placeholder="No limit"
                value={b.upper ?? ""}
                onChange={(e) => updateBracket(i, { upper: e.target.value === "" ? null : Number(e.target.value) })}
              />
              <Input
                aria-label={`Band ${i + 1} rate %`}
                type="number"
                min={0}
                step="0.1"
                value={b.rate}
                onChange={(e) => updateBracket(i, { rate: num(e.target.value) })}
              />
              <RemoveButton
                label={`Remove band ${i + 1}`}
                onClick={() => setTax((t) => ({ ...t, brackets: t.brackets.filter((_, j) => j !== i) }))}
                disabled={tax.brackets.length === 1}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Columns: from · up to · rate %</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTax((t) => ({ ...t, brackets: [...t.brackets, { lower: t.brackets.at(-1)?.upper ?? 0, upper: null, rate: 0 }] }))}
          >
            <Plus className="size-4" aria-hidden /> Add band
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowances &amp; deductions</CardTitle>
          <CardDescription>Common pay items to start with. Amounts are set per employee later.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {components.map((c, i) => (
            <div key={c.code} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span>
                {c.name} <span className="text-xs text-muted-foreground">({c.kind === "earning" ? "added to pay" : "taken from pay"})</span>
              </span>
              <RemoveButton label={`Remove ${c.name}`} onClick={() => setComponents((x) => x.filter((_, j) => j !== i))} />
            </div>
          ))}
        </CardContent>
      </Card>
      <SetupActions module="payroll" nextLabel={nextLabel} getConfig={() => ({ schedule, pension, tax, components })} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Transport claim cut-off
// ---------------------------------------------------------------------
export function TransportSetupForm({ initial, nextLabel }: FormProps<"transport">) {
  const [day, setDay] = useState(initial.claims_cutoff_day);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim cut-off day</CardTitle>
        <CardDescription>
          Transport claims approved by this day each month are paid in that month&apos;s payroll. Later claims move to the next payroll. Staff get a
          reminder a few days before.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Field label="Cut-off day of the month" htmlFor="cutoff" hint="Between 1 and 28, so it exists in every month.">
          <Input id="cutoff" type="number" min={1} max={28} className="w-32" value={day} onChange={(e) => setDay(num(e.target.value))} />
        </Field>
        <SetupActions module="transport" nextLabel={nextLabel} getConfig={() => ({ claims_cutoff_day: day })} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// First review cycle
// ---------------------------------------------------------------------
export function PerformanceSetupForm({ initial, nextLabel, note }: FormProps<"performance">) {
  const [c, setC] = useState(initial.cycle);
  const set = (patch: Partial<typeof c>) => setC((x) => ({ ...x, ...patch }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your first review cycle</CardTitle>
        <CardDescription>
          We&apos;ll use a simple, ready-made review form (self review, then manager review). The cycle is saved as a draft; you open it for staff
          when you&apos;re ready.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {note && <Alert tone="info">{note}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="cname" className="sm:col-span-2">
            <Input id="cname" value={c.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="How often" htmlFor="ptype">
            <Select
              id="ptype"
              value={c.period_type}
              onChange={(e) => set({ period_type: e.target.value as typeof c.period_type })}
              options={[
                { value: "quarterly", label: "Every quarter" },
                { value: "half_yearly", label: "Every six months" },
                { value: "annual", label: "Once a year" },
              ]}
            />
          </Field>
          <div />
          <Field label="Covers work from" htmlFor="pstart">
            <Input id="pstart" type="date" value={c.period_start} onChange={(e) => set({ period_start: e.target.value })} />
          </Field>
          <Field label="Until" htmlFor="pend">
            <Input id="pend" type="date" value={c.period_end} onChange={(e) => set({ period_end: e.target.value })} />
          </Field>
          <Field label="Self reviews due" htmlFor="sdue" optional>
            <Input id="sdue" type="date" value={c.self_review_due ?? ""} onChange={(e) => set({ self_review_due: e.target.value })} />
          </Field>
          <Field label="Manager reviews due" htmlFor="mdue" optional>
            <Input id="mdue" type="date" value={c.manager_review_due ?? ""} onChange={(e) => set({ manager_review_due: e.target.value })} />
          </Field>
        </div>
        <SetupActions module="performance" nextLabel={nextLabel} getConfig={() => ({ cycle: c })} />
      </CardContent>
    </Card>
  );
}
