/** Turns raw activity-log rows into sentences people can read. */

const ENTITY_LABELS: Record<string, string> = {
  employees: "profile",
  employee_compensation: "salary",
  employee_bank_accounts: "bank details",
  employee_emergency_contacts: "emergency contact",
  employee_documents: "file",
  business_members: "login",
  roles: "role",
  role_permissions: "role permission",
  businesses: "company settings",
  business_modules: "tools",
  letter_templates: "letter template",
  generated_letters: "letter",
  approval_workflows: "approval chain",
  approval_workflow_steps: "approval step",
  announcements: "news post",
  branches: "location",
  departments: "department",
  positions: "job title",
  invitations: "invitation",
  support_access_grants: "support access",
};

const FIELD_LABELS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  preferred_name: "goes by",
  date_of_birth: "date of birth",
  work_email: "work email",
  personal_email: "personal email",
  employee_code: "employee number",
  join_date: "joined on",
  probation_end_date: "probation end",
  confirmation_date: "confirmed on",
  contract_type: "contract",
  contract_end_date: "contract end",
  branch_id: "location",
  department_id: "department",
  position_id: "job title",
  manager_id: "manager",
  exit_date: "last day",
  exit_reason: "reason for leaving",
  exit_notes: "leaving notes",
  national_id: "national ID",
  passport_no: "passport no.",
  passport_expiry: "passport expiry",
  basic_salary: "basic salary",
  effective_date: "starts on",
  account_number: "account number",
  bank_name: "bank",
  role_id: "role",
  is_expatriate: "permit holder",
  current_address: "current address",
  permanent_address: "home address",
};

const HIDDEN = new Set(["id", "business_id", "employee_id", "created_by", "uploaded_by", "custom_fields", "photo_path", "generated_by"]);
const SENSITIVE = new Set(["account_number", "national_id", "passport_no", "basic_salary"]);

export function entityLabel(entity: string | null): string {
  return (entity && ENTITY_LABELS[entity]) || (entity ?? "record").replace(/_/g, " ");
}

export function actionVerb(action: string): string {
  return { insert: "added", update: "changed", delete: "removed" }[action] ?? action;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  // IDs mean nothing to people; say it changed instead.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)) return "";
  return s.length > 60 ? `${s.slice(0, 57)}…` : s.replace(/_/g, " ");
}

/** For an update: "status: active → resigned". Sensitive values are masked unless allowed. */
export function describeChanges(changes: Record<string, { from: unknown; to: unknown }> | null, opts: { showSensitive?: boolean } = {}): string[] {
  if (!changes) return [];
  const out: string[] = [];
  for (const [k, { from, to }] of Object.entries(changes)) {
    if (HIDDEN.has(k)) continue;
    const label = FIELD_LABELS[k] ?? k.replace(/_/g, " ");
    if (SENSITIVE.has(k) && !opts.showSensitive) {
      out.push(`${label} changed`);
      continue;
    }
    const a = show(from);
    const b = show(to);
    out.push(a === "" || b === "" ? `${label} changed` : from === undefined ? `${label}: ${b}` : `${label}: ${a} → ${b}`);
  }
  return out;
}
