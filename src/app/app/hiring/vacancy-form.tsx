"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { saveVacancy } from "@/lib/hiring/actions";
import type { ActionResult } from "@/lib/errors";

type Opt = { value: string; label: string };

export interface VacancyValues {
  id?: string;
  title?: string;
  department_id?: string | null;
  branch_id?: string | null;
  position_id?: string | null;
  employment_type?: string;
  description?: string;
  requirements?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  show_salary?: boolean;
  openings?: number;
  deadline?: string | null;
  status?: string;
  is_public?: boolean;
}

const TYPES = [
  { value: "permanent", label: "Permanent" },
  { value: "fixed_term", label: "Fixed term" },
  { value: "part_time", label: "Part time" },
  { value: "casual", label: "Casual" },
  { value: "intern", label: "Internship" },
  { value: "consultant", label: "Consultant" },
];

export function VacancyForm({ values = {}, org, currency }: { values?: VacancyValues; org: { departments: Opt[]; branches: Opt[]; positions: Opt[] }; currency: string }) {
  const router = useRouter();
  const action = useCallback((s: ActionResult, f: FormData) => saveVacancy(values.id ?? null, s, f), [values.id]);
  return (
    <ActionForm
      action={action}
      submitLabel={values.id ? "Save" : "Create role"}
      onSuccess={(s: ActionResult & { id?: string }) => {
        if (s.id) router.push(`/app/hiring/${s.id}`);
      }}
    >
      <TextField name="title" label="Role" defaultValue={values.title} placeholder="For example Front office assistant" />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField name="department_id" label="Department" options={org.departments} placeholder="Any" defaultValue={values.department_id ?? ""} optional />
        <SelectField name="branch_id" label="Location" options={org.branches} placeholder="Any" defaultValue={values.branch_id ?? ""} optional />
        <SelectField name="position_id" label="Job title" options={org.positions} placeholder="None" defaultValue={values.position_id ?? ""} optional />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField name="employment_type" label="Contract" options={TYPES} defaultValue={values.employment_type ?? "permanent"} />
        <TextField name="openings" label="How many people" type="number" min={1} defaultValue={String(values.openings ?? 1)} />
        <TextField name="deadline" label="Apply by" type="date" defaultValue={values.deadline ?? ""} optional />
      </div>
      <TextareaField name="description" label="About the role" rows={6} defaultValue={values.description} placeholder="What they'll do day to day, who they work with, the hours." />
      <TextareaField name="requirements" label="What you're looking for" rows={4} defaultValue={values.requirements} placeholder="Experience, languages, certificates." optional />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="salary_min" label={`Salary from (${currency})`} type="number" min={0} defaultValue={values.salary_min?.toString() ?? ""} optional />
        <TextField name="salary_max" label={`Salary up to (${currency})`} type="number" min={0} defaultValue={values.salary_max?.toString() ?? ""} optional />
      </div>
      <CheckboxField name="show_salary" label="Show the salary on the careers page" defaultChecked={values.show_salary} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="status"
          label="Status"
          options={[
            { value: "draft", label: "Draft (not taking applications)" },
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" },
            { value: "filled", label: "Filled" },
          ]}
          defaultValue={values.status ?? "open"}
        />
        <div className="flex items-end pb-2">
          <CheckboxField name="is_public" label="Show on your careers page" hint="People can apply online." defaultChecked={values.is_public ?? true} />
        </div>
      </div>
    </ActionForm>
  );
}
