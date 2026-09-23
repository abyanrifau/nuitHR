"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, SelectField, TextField } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { saveAttendanceRules } from "@/lib/time/attendance-actions";

export interface Rules {
  grace_minutes: number;
  early_leave_minutes: number;
  half_day_min_hours: number;
  full_day_hours: number;
  overtime_enabled: boolean;
  overtime_mode: "daily_hours" | "outside_shift";
  overtime_daily_hours: number | null;
  overtime_after_minutes: number;
  overtime_rounding: "none" | "nearest" | "down" | "up";
  overtime_round_to: number;
  overtime_monthly_cap_hours: number | null;
  overtime_requires_approval: boolean;
  overtime_rate_weekday: number;
  overtime_rate_rest_day: number;
  overtime_rate_holiday: number;
  require_gps: boolean;
  require_selfie: boolean;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border p-5">
      <div>
        <h2 className="text-lg">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function RulesForm({ rules: r, canEdit }: { rules: Rules; canEdit: boolean }) {
  const [ot, setOt] = useState(r.overtime_enabled);
  const [mode, setMode] = useState(r.overtime_mode);
  const [rounding, setRounding] = useState(r.overtime_rounding);
  const body = (
    <fieldset disabled={!canEdit} className="space-y-6">
      <Section title="Lateness, leaving early and half days">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="grace_minutes" label="Grace period (minutes)" type="number" min={0} max={120} defaultValue={r.grace_minutes} hint="Arriving later than this after the shift starts counts as late." />
          <TextField name="early_leave_minutes" label="Leaving early (minutes)" type="number" min={0} max={240} defaultValue={r.early_leave_minutes} hint="Leaving more than this before the shift ends counts as early leave." />
          <TextField name="half_day_min_hours" label="Half day: fewer than (hours)" type="number" step="0.25" min={0} max={12} defaultValue={r.half_day_min_hours} hint="Working fewer hours than this is a half day. You can also mark a day as a half day." />
          <TextField name="full_day_hours" label="A full day (hours)" type="number" step="0.25" min={1} max={24} defaultValue={r.full_day_hours} hint="Used when someone has no shift." />
        </div>
        <p className="text-[13px] text-muted-foreground">
          Absent means no time record on a working day with no approved time off. Days on approved time off count as approved absences.
        </p>
      </Section>

      <Section title="Overtime">
        <div
          onChange={(e) => {
            const t = e.target as HTMLInputElement;
            if (t.name === "overtime_enabled" && t.type === "checkbox") setOt(t.checked);
          }}
        >
          <CheckboxField name="overtime_enabled" label="Count overtime" defaultChecked={r.overtime_enabled} />
        </div>
        {ot && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="overtime_mode"
                label="Overtime starts"
                value={mode}
                onChange={(e) => setMode(e.target.value as Rules["overtime_mode"])}
                options={[
                  { value: "daily_hours", label: "After a number of hours in a day" },
                  { value: "outside_shift", label: "For time outside the shift" },
                ]}
              />
              {mode === "daily_hours" ? (
                <TextField
                  name="overtime_daily_hours"
                  label="After (hours)"
                  type="number"
                  step="0.25"
                  min={1}
                  max={24}
                  defaultValue={r.overtime_daily_hours ?? ""}
                  optional
                  hint="Leave empty to use the length of each person's shift."
                />
              ) : (
                <input type="hidden" name="overtime_daily_hours" value={r.overtime_daily_hours ?? ""} />
              )}
              <TextField name="overtime_after_minutes" label="Minimum to count (minutes)" type="number" min={0} max={240} defaultValue={r.overtime_after_minutes} hint="Less overtime than this on a day isn't counted." />
              <TextField
                name="overtime_monthly_cap_hours"
                label="Monthly limit (hours)"
                type="number"
                step="0.5"
                min={0}
                defaultValue={r.overtime_monthly_cap_hours ?? ""}
                optional
                hint="Overtime beyond this in a month isn't counted. Leave empty for no limit."
              />
              <SelectField
                name="overtime_rounding"
                label="Rounding"
                value={rounding}
                onChange={(e) => setRounding(e.target.value as Rules["overtime_rounding"])}
                options={[
                  { value: "none", label: "Don't round" },
                  { value: "nearest", label: "To the nearest" },
                  { value: "down", label: "Down to" },
                  { value: "up", label: "Up to" },
                ]}
              />
              {rounding !== "none" ? (
                <SelectField
                  name="overtime_round_to"
                  label="Minutes"
                  defaultValue={String(r.overtime_round_to)}
                  options={[5, 10, 15, 30, 60].map((m) => ({ value: String(m), label: `${m} minutes` }))}
                />
              ) : (
                <input type="hidden" name="overtime_round_to" value={r.overtime_round_to} />
              )}
            </div>
            <CheckboxField
              name="overtime_requires_approval"
              label="Overtime needs a manager's approval before it's paid"
              defaultChecked={r.overtime_requires_approval}
              hint="Approve it in Time, Overtime. Until then it shows as waiting and isn't paid."
            />
            <div>
              <h3 className="mb-2 text-sm text-foreground">Pay rates (times the hourly rate)</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField name="overtime_rate_weekday" label="Normal days" type="number" step="0.05" min={1} max={5} defaultValue={r.overtime_rate_weekday} />
                <TextField name="overtime_rate_rest_day" label="Rest days" type="number" step="0.05" min={1} max={5} defaultValue={r.overtime_rate_rest_day} />
                <TextField name="overtime_rate_holiday" label="Public holidays" type="number" step="0.05" min={1} max={5} defaultValue={r.overtime_rate_holiday} />
              </div>
              <Alert tone="warning" className="mt-3" title="Check these rates before you pay overtime">
                Harbor starts with 1.25 times on normal days and 1.5 times on rest days and public holidays. Laws change: check the current rates in the Maldives
                Employment Act and any regulations, or with the Labour Relations Authority, and change them here if needed.
              </Alert>
            </div>
          </>
        )}
        {!ot && (
          <>
            {(
              [
                ["overtime_mode", r.overtime_mode],
                ["overtime_daily_hours", r.overtime_daily_hours ?? ""],
                ["overtime_after_minutes", r.overtime_after_minutes],
                ["overtime_rounding", r.overtime_rounding],
                ["overtime_round_to", r.overtime_round_to],
                ["overtime_monthly_cap_hours", r.overtime_monthly_cap_hours ?? ""],
                ["overtime_rate_weekday", r.overtime_rate_weekday],
                ["overtime_rate_rest_day", r.overtime_rate_rest_day],
                ["overtime_rate_holiday", r.overtime_rate_holiday],
                ["overtime_requires_approval", r.overtime_requires_approval ? "true" : ""],
              ] as const
            ).map(([n, v]) => (
              <input key={n} type="hidden" name={n} value={String(v)} />
            ))}
          </>
        )}
      </Section>

      <Section title="Clocking in" description="Location fences are set for each location in Workspace, Tools, Time & shifts.">
        <CheckboxField name="require_gps" label="Staff must share their location to clock in" defaultChecked={r.require_gps} />
        <CheckboxField name="require_selfie" label="Staff must take a photo to clock in" defaultChecked={r.require_selfie} />
      </Section>
    </fieldset>
  );
  return canEdit ? (
    <ActionForm action={saveAttendanceRules} submitLabel="Save rules">
      {body}
    </ActionForm>
  ) : (
    <>
      <Alert tone="info" className="mb-6">
        You can see these rules but not change them.
      </Alert>
      {body}
    </>
  );
}
