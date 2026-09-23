"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, SelectField, TextField } from "@/components/ui/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveLeaveType } from "@/lib/leave/setup-actions";
import { ENTITLEMENT_MODES, NOTICE_UNITS, SERVICE_UNITS } from "@/lib/leave/rules";

type Opt = { value: string; label: string };

export interface LeaveTypeValues {
  id: string | null;
  name: string;
  code: string;
  color: string;
  is_paid: boolean;
  entitlement_mode: string;
  entitlement_days: number;
  year_basis: string;
  notice_value: number;
  notice_unit: string;
  allow_after_the_fact: boolean;
  eligible_after_value: number;
  eligible_after_unit: string;
  allow_during_probation: boolean;
  applies_to: string;
  gender_eligibility: string;
  min_days_per_request: number | null;
  max_days_per_request: number | null;
  max_consecutive_days: number | null;
  max_off_per_department: number | null;
  allow_half_day: boolean;
  document_rule: string;
  document_over_days: number | null;
  document_later_allowed: boolean;
  document_deadline_days: number;
  birthday_window: string;
  birthday_window_days: number;
  targets: { target_type: string; target_id: string }[];
}

export interface TargetOptions {
  position: Opt[];
  department: Opt[];
  branch: Opt[];
  role: Opt[];
  employee: Opt[];
}

const TARGET_LABELS: [keyof TargetOptions, string][] = [
  ["role", "Roles"],
  ["position", "Job titles"],
  ["department", "Departments"],
  ["branch", "Locations"],
  ["employee", "People"],
];

const v = (x: number | null) => (x === null ? "" : String(x));

function TargetList({ kind, label, options, chosen }: { kind: keyof TargetOptions; label: string; options: Opt[]; chosen: Set<string> }) {
  const [q, setQ] = useState("");
  if (!options.length) return null;
  const shown = options.filter((o) => chosen.has(o.value) || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-[13px] text-muted-foreground">{label}</legend>
      {options.length > 8 && <Input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />}
      <div className="max-h-48 space-y-1.5 overflow-y-auto">
        {options.map((o) => (
          <label key={o.value} className={shown.includes(o) ? "flex items-center gap-2 text-sm" : "hidden"}>
            <input type="checkbox" name={`target_${kind}`} value={o.value} defaultChecked={chosen.has(o.value)} className="size-4 accent-[var(--color-accent)]" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Every rule for one type of time off, in plain sections. */
export function LeaveTypeForm({ initial, targets }: { initial: LeaveTypeValues; targets: TargetOptions }) {
  const [mode, setMode] = useState(initial.entitlement_mode);
  const [docRule, setDocRule] = useState(initial.document_rule);
  const [docLater, setDocLater] = useState(initial.document_later_allowed);
  const [appliesTo, setAppliesTo] = useState(initial.applies_to);
  const [birthdayWindow, setBirthdayWindow] = useState(initial.birthday_window);
  const chosen = (kind: string) => new Set(initial.targets.filter((t) => t.target_type === kind).map((t) => t.target_id));

  return (
    <ActionForm action={saveLeaveType.bind(null, initial.id)} submitLabel={initial.id ? "Save rules" : "Add type"} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>The basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem_5rem]">
            <TextField name="name" label="Name" defaultValue={initial.name} placeholder="For example Annual leave" />
            <TextField name="code" label="Short code" defaultValue={initial.code} maxLength={6} />
            <TextField name="color" label="Colour" type="color" defaultValue={initial.color} className="[&_input]:h-10 [&_input]:p-1" />
          </div>
          <CheckboxField name="is_paid" label="Paid" defaultChecked={initial.is_paid} hint="Unpaid days come off pay in payroll." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Days</CardTitle>
          <CardDescription>All the days are given at the start of each leave year. Nothing builds up month by month and nothing carries over.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SelectField name="entitlement_mode" label="How many days" options={ENTITLEMENT_MODES} value={mode} onChange={(e) => setMode(e.target.value)} />
          {(mode === "annual" || mode === "birthday") && (
            <TextField name="entitlement_days" label={mode === "birthday" ? "Days for the birthday" : "Days each leave year"} type="number" min={0} step="0.5" defaultValue={initial.entitlement_days} className="max-w-48" />
          )}
          {(mode === "unlimited" || mode === "granted") && <input type="hidden" name="entitlement_days" value="0" />}
          {mode === "granted" && <p className="text-sm text-muted-foreground">Give days to a person from Time off, then Granted leave. Only people with days given see this type.</p>}
          {mode === "birthday" ? (
            <>
              <input type="hidden" name="year_basis" value="calendar" />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  name="birthday_window"
                  label="When it can be used"
                  value={birthdayWindow}
                  onChange={(e) => setBirthdayWindow(e.target.value)}
                  options={[
                    { value: "month", label: "Any day in their birthday month" },
                    { value: "days_after", label: "Within some days from the birthday" },
                  ]}
                />
                {birthdayWindow === "days_after" ? (
                  <TextField name="birthday_window_days" label="Days from the birthday" type="number" min={1} max={366} defaultValue={initial.birthday_window_days} />
                ) : (
                  <input type="hidden" name="birthday_window_days" value={initial.birthday_window_days} />
                )}
              </div>
              <p className="text-sm text-muted-foreground">People need a date of birth on their profile to get it.</p>
            </>
          ) : (
            <>
              <input type="hidden" name="birthday_window" value={initial.birthday_window} />
              <input type="hidden" name="birthday_window_days" value={initial.birthday_window_days} />
              <SelectField
                name="year_basis"
                label="Leave year"
                defaultValue={initial.year_basis}
                hint="Changing this keeps everyone's current balances as they are."
                options={[
                  { value: "calendar", label: "Calendar year (1 January to 31 December)" },
                  { value: "anniversary", label: "Each person's year from their join date" },
                ]}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who can use it</CardTitle>
          <CardDescription>Staff never see types they can&apos;t use.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="applies_to"
              label="For"
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
              options={[
                { value: "all", label: "All staff" },
                { value: "selected", label: "Only the roles, jobs, teams or people I choose" },
              ]}
            />
            <SelectField
              name="gender_eligibility"
              label="Gender"
              defaultValue={initial.gender_eligibility}
              options={[
                { value: "any", label: "Anyone" },
                { value: "female", label: "Women only" },
                { value: "male", label: "Men only" },
              ]}
            />
          </div>
          {appliesTo === "selected" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="text-sm text-muted-foreground sm:col-span-2">Someone can use it if they match any of what you tick.</p>
              {TARGET_LABELS.map(([kind, label]) => (
                <TargetList key={kind} kind={kind} label={label} options={targets[kind]} chosen={chosen(kind)} />
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-[8rem_10rem]">
            <TextField name="eligible_after_value" label="After working" type="number" min={0} defaultValue={initial.eligible_after_value} hint="0 means from day one." />
            <SelectField name="eligible_after_unit" label="Unit" options={SERVICE_UNITS} defaultValue={initial.eligible_after_unit} />
          </div>
          <CheckboxField name="allow_during_probation" label="Can be used during probation" defaultChecked={initial.allow_during_probation} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Asking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[8rem_10rem]">
            <TextField name="notice_value" label="Notice" type="number" min={0} defaultValue={initial.notice_value} hint="0 means no notice." />
            <SelectField name="notice_unit" label="Unit" options={NOTICE_UNITS} defaultValue={initial.notice_unit} />
          </div>
          <CheckboxField name="allow_after_the_fact" label="Can be asked for after the day" hint="For example sick leave, up to 30 days back." defaultChecked={initial.allow_after_the_fact} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="min_days_per_request" label="Least days at a time" type="number" min={0.5} step="0.5" defaultValue={v(initial.min_days_per_request)} optional />
            <TextField name="max_days_per_request" label="Most days at a time" type="number" min={0.5} step="0.5" defaultValue={v(initial.max_days_per_request)} optional />
            <TextField name="max_consecutive_days" label="Most days in a row" type="number" min={1} defaultValue={v(initial.max_consecutive_days)} optional hint="Counts back-to-back requests together." />
            <TextField name="max_off_per_department" label="Most people off at once, per department" type="number" min={1} defaultValue={v(initial.max_off_per_department)} optional hint="Counts approved and waiting time off." />
          </div>
          <CheckboxField name="allow_half_day" label="Half days allowed" defaultChecked={initial.allow_half_day} />
          <p className="text-sm text-muted-foreground">Blackout dates, when this can&apos;t be taken, are set on the time off calendar.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>For example a medical certificate.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="document_rule"
              label="Document"
              value={docRule}
              onChange={(e) => setDocRule(e.target.value)}
              options={[
                { value: "none", label: "Not needed" },
                { value: "always", label: "Always needed" },
                { value: "over_days", label: "Needed when longer than some days" },
              ]}
            />
            {docRule === "over_days" ? (
              <TextField name="document_over_days" label="Longer than (days)" type="number" min={0.5} step="0.5" defaultValue={v(initial.document_over_days)} />
            ) : (
              <input type="hidden" name="document_over_days" value="" />
            )}
          </div>
          {docRule !== "none" && (
            <>
              <label className="flex items-start gap-3 text-sm">
                <input type="hidden" name="document_later_allowed" value="" />
                <input
                  type="checkbox"
                  name="document_later_allowed"
                  value="true"
                  checked={docLater}
                  onChange={(e) => setDocLater(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--color-accent)]"
                />
                <span>
                  <span className="text-foreground">Can be added later</span>
                  <span className="block text-xs text-subtle-foreground">Otherwise it has to be added when asking.</span>
                </span>
              </label>
              {docLater && (
                <>
                  <TextField name="document_deadline_days" label="Days after returning to add it" type="number" min={0} max={60} defaultValue={initial.document_deadline_days} className="max-w-48" />
                  <p className="text-sm text-muted-foreground">
                    The day before the deadline, they, their manager and HR get a reminder. If there&apos;s still no document after it, those days become unapproved absences
                    (which payroll and allowances count) and everyone is told. HR can give more time or waive the document, with a reason.
                  </p>
                </>
              )}
            </>
          )}
          {(docRule === "none" || !docLater) && <input type="hidden" name="document_deadline_days" value={initial.document_deadline_days} />}
        </CardContent>
      </Card>
    </ActionForm>
  );
}
