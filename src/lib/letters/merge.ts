/**
 * Letter templates use {{merge.fields}} that are filled in from the
 * person's profile and the company details. Kept free of server code so
 * the template editor can preview letters in the browser too.
 */
import { formatDate, formatMoney, today } from "@/lib/format";

export const MERGE_FIELDS: { key: string; label: string; example: string }[] = [
  { key: "employee.full_name", label: "Full name", example: "Aishath Shifza" },
  { key: "employee.first_name", label: "First name", example: "Aishath" },
  { key: "employee.last_name", label: "Last name", example: "Shifza" },
  { key: "employee.code", label: "Employee number", example: "EMP-0012" },
  { key: "employee.position", label: "Job title", example: "Front office supervisor" },
  { key: "employee.department", label: "Department", example: "Front office" },
  { key: "employee.join_date", label: "Joined on", example: "01/03/2022" },
  { key: "employee.exit_date", label: "Last day", example: "30/06/2026" },
  { key: "employee.salary", label: "Basic salary", example: "MVR 12,000.00" },
  { key: "employee.national_id", label: "National ID", example: "A123456" },
  { key: "employee.passport_no", label: "Passport no.", example: "N1234567" },
  { key: "employee.nationality", label: "Nationality", example: "MV" },
  { key: "company.name", label: "Company name", example: "Sunset Island Resort" },
  { key: "company.address", label: "Company address", example: "K. Malé" },
  { key: "company.registration_no", label: "Registration no.", example: "C-1234/2020" },
  { key: "letter.date", label: "Today's date", example: "19/09/2026" },
  { key: "letter.purpose", label: "Purpose", example: "a bank loan application" },
  { key: "letter.addressed_to", label: "Addressed to", example: "The Manager, Bank of Maldives" },
];

export interface MergeData {
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
    join_date: string | null;
    exit_date: string | null;
    national_id: string | null;
    passport_no: string | null;
    nationality: string | null;
    position?: string | null;
    department?: string | null;
    salary?: { amount: number; currency: string } | null;
  };
  company: { name: string; address: string | null; registration_no: string | null; date_format: string };
  letter: { purpose?: string | null; addressed_to?: string | null; date?: string };
}

export function mergeValues(d: MergeData): Record<string, string> {
  const e = d.employee;
  const f = d.company.date_format;
  return {
    "employee.full_name": `${e.first_name} ${e.last_name}`.trim(),
    "employee.first_name": e.first_name,
    "employee.last_name": e.last_name,
    "employee.code": e.employee_code,
    "employee.position": e.position ?? "",
    "employee.department": e.department ?? "",
    "employee.join_date": formatDate(e.join_date, f),
    "employee.exit_date": formatDate(e.exit_date, f),
    "employee.salary": e.salary ? formatMoney(e.salary.amount, e.salary.currency) : "",
    "employee.national_id": e.national_id ?? "",
    "employee.passport_no": e.passport_no ?? "",
    "employee.nationality": e.nationality ?? "",
    "company.name": d.company.name,
    "company.address": d.company.address ?? "",
    "company.registration_no": d.company.registration_no ?? "",
    "letter.date": formatDate(d.letter.date ?? today(), f),
    "letter.purpose": d.letter.purpose ?? "",
    "letter.addressed_to": d.letter.addressed_to ?? "",
  };
}

/** Fills in the fields. Unknown or empty fields are listed so the person can fix them before sending. */
export function renderTemplate(text: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_, key: string) => {
    const v = values[key];
    if (!v) {
      missing.add(key);
      return `[${MERGE_FIELDS.find((m) => m.key === key)?.label ?? key}]`;
    }
    return v;
  });
  return { text: out, missing: [...missing] };
}

export function exampleValues(): Record<string, string> {
  return Object.fromEntries(MERGE_FIELDS.map((m) => [m.key, m.example]));
}

export const LETTER_KINDS = [
  { value: "employment_certificate", label: "Employment certificate" },
  { value: "salary_certificate", label: "Salary certificate" },
  { value: "experience", label: "Experience letter" },
  { value: "noc", label: "No objection letter" },
  { value: "warning", label: "Warning letter" },
  { value: "offer", label: "Offer letter" },
  { value: "custom", label: "Other" },
];
