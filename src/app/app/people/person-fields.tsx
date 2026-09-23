import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { CONTRACT_TYPES, GENDERS, MARITAL_STATUSES, NATIONALITIES } from "@/lib/people/constants";

export interface OrgOptions {
  branches: { value: string; label: string }[];
  departments: { value: string; label: string }[];
  positions: { value: string; label: string }[];
  managers: { value: string; label: string }[];
}

type Values = Record<string, string | boolean | null | undefined>;
const v = (values: Values, k: string) => (values[k] as string | null | undefined) ?? "";

export function PersonalFields({ values = {} }: { values?: Values }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField name="first_name" label="First name" defaultValue={v(values, "first_name")} required autoComplete="off" />
      <TextField name="last_name" label="Last name" defaultValue={v(values, "last_name")} optional autoComplete="off" />
      <TextField name="preferred_name" label="Goes by" hint="If they use a different first name." defaultValue={v(values, "preferred_name")} optional />
      <SelectField name="gender" label="Gender" options={GENDERS} placeholder="Not set" defaultValue={v(values, "gender")} optional />
      <TextField name="date_of_birth" label="Date of birth" type="date" defaultValue={v(values, "date_of_birth")} optional />
      <SelectField name="marital_status" label="Marital status" options={MARITAL_STATUSES} placeholder="Not set" defaultValue={v(values, "marital_status")} optional />
      <SelectField name="nationality" label="Nationality" options={NATIONALITIES} placeholder="Not set" defaultValue={v(values, "nationality")} optional />
      <div className="flex items-end pb-2">
        <CheckboxField name="is_expatriate" label="Works here on a permit" hint="Foreign staff who need a work visa." defaultChecked={Boolean(values.is_expatriate)} />
      </div>
    </div>
  );
}

export function ContactFields({ values = {} }: { values?: Values }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField name="work_email" label="Work email" type="email" defaultValue={v(values, "work_email")} optional />
      <TextField name="personal_email" label="Personal email" type="email" defaultValue={v(values, "personal_email")} optional />
      <TextField name="phone" label="Phone" type="tel" defaultValue={v(values, "phone")} optional />
      <div className="hidden sm:block" />
      <TextareaField name="current_address" label="Current address" defaultValue={v(values, "current_address")} optional />
      <TextareaField name="permanent_address" label="Home address" hint="Permanent address, island or country." defaultValue={v(values, "permanent_address")} optional />
    </div>
  );
}

export function EmploymentFields({ values = {}, org }: { values?: Values; org: OrgOptions }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField name="employee_code" label="Employee number" defaultValue={v(values, "employee_code")} required />
      <SelectField name="contract_type" label="Contract" options={CONTRACT_TYPES} defaultValue={v(values, "contract_type") || "permanent"} />
      <SelectField name="position_id" label="Job title" options={org.positions} placeholder="None" defaultValue={v(values, "position_id")} optional />
      <SelectField name="department_id" label="Department" options={org.departments} placeholder="None" defaultValue={v(values, "department_id")} optional />
      <SelectField name="branch_id" label="Location" options={org.branches} placeholder="None" defaultValue={v(values, "branch_id")} optional />
      <SelectField name="manager_id" label="Reports to" options={org.managers} placeholder="Nobody" defaultValue={v(values, "manager_id")} optional />
      <TextField name="join_date" label="Joined on" type="date" defaultValue={v(values, "join_date")} optional />
      <TextField name="probation_end_date" label="Probation ends" type="date" defaultValue={v(values, "probation_end_date")} optional />
      <TextField name="confirmation_date" label="Confirmed on" type="date" defaultValue={v(values, "confirmation_date")} optional />
      <TextField name="contract_end_date" label="Contract ends" type="date" hint="For fixed-term contracts." defaultValue={v(values, "contract_end_date")} optional />
      <TextareaField name="notes" label="Notes" className="sm:col-span-2" defaultValue={v(values, "notes")} optional />
    </div>
  );
}

export function IdFields({ values = {} }: { values?: Values }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField name="national_id" label="National ID card no." hint="For example A123456." defaultValue={v(values, "national_id")} optional />
      <div className="hidden sm:block" />
      <TextField name="passport_no" label="Passport no." defaultValue={v(values, "passport_no")} optional />
      <TextField name="passport_expiry" label="Passport expires" type="date" defaultValue={v(values, "passport_expiry")} optional />
    </div>
  );
}
