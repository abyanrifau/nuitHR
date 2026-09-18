/**
 * Bulk employee import from a CSV file (exported from Excel or Google Sheets).
 * Checks every row and returns friendly, row-by-row error messages before
 * anything is saved.
 */
import { parseCsv, toCsv } from "@/lib/csv";

export const IMPORT_COLUMNS = [
  { key: "employee_code", label: "Employee ID", help: "Optional. Left empty, IDs are created for you (E0001, E0002…)." },
  { key: "first_name", label: "First name", help: "Required." },
  { key: "last_name", label: "Last name", help: "" },
  { key: "work_email", label: "Email", help: "Needed to invite them to the staff app." },
  { key: "phone", label: "Phone", help: "" },
  { key: "department", label: "Department", help: "New departments are created automatically." },
  { key: "position", label: "Position", help: "New positions are created automatically." },
  { key: "branch", label: "Branch", help: "Must match one of your branches." },
  { key: "join_date", label: "Join date", help: "DD/MM/YYYY" },
  { key: "probation_end_date", label: "Probation end date", help: "DD/MM/YYYY. Leave empty if not on probation." },
  { key: "gender", label: "Gender", help: "female, male, other" },
  { key: "nationality", label: "Nationality", help: "Country or 2-letter code, e.g. Maldives or MV, India or IN." },
  { key: "contract_type", label: "Contract type", help: "permanent, fixed_term, part_time, casual, intern, consultant" },
  { key: "manager_code", label: "Manager's employee ID", help: "Optional. The Employee ID of their manager." },
] as const;

export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];

export interface ImportRow {
  employee_code: string;
  first_name: string;
  last_name: string;
  work_email: string;
  phone: string;
  department: string;
  position: string;
  branch: string;
  join_date: string; // ISO YYYY-MM-DD or ""
  probation_end_date: string;
  gender: "" | "female" | "male" | "other";
  nationality: string; // ISO-2 or ""
  is_expatriate: boolean;
  contract_type: string;
  manager_code: string;
}

export interface ImportPreview {
  rows: { line: number; data: ImportRow; errors: string[]; warnings: string[] }[];
  fileErrors: string[];
  /** Information only (does not block the import). */
  fileNotices: string[];
  validCount: number;
  errorCount: number;
}

const NATIONALITIES: Record<string, string> = {
  maldives: "MV", maldivian: "MV", india: "IN", indian: "IN", bangladesh: "BD", bangladeshi: "BD",
  "sri lanka": "LK", "sri lankan": "LK", nepal: "NP", nepali: "NP", pakistan: "PK", pakistani: "PK",
  philippines: "PH", filipino: "PH", indonesia: "ID", indonesian: "ID", thailand: "TH", thai: "TH",
  china: "CN", chinese: "CN", "united kingdom": "GB", british: "GB", uk: "GB", germany: "DE", german: "DE",
  italy: "IT", italian: "IT", russia: "RU", russian: "RU", "united states": "US", american: "US", usa: "US",
  australia: "AU", australian: "AU", egypt: "EG", egyptian: "EG", malaysia: "MY", malaysian: "MY",
  myanmar: "MM", vietnam: "VN", vietnamese: "VN", france: "FR", french: "FR", spain: "ES", spanish: "ES",
};

const CONTRACT_TYPES = ["permanent", "fixed_term", "part_time", "casual", "intern", "consultant"];

// Accept common header spellings so people can use their own spreadsheet.
const HEADER_ALIASES: Record<string, ImportKey> = {};
for (const c of IMPORT_COLUMNS) {
  HEADER_ALIASES[c.key] = c.key;
  HEADER_ALIASES[c.label.toLowerCase()] = c.key;
}
Object.assign(HEADER_ALIASES, {
  "employee id": "employee_code", "staff id": "employee_code", id: "employee_code", code: "employee_code",
  "first name": "first_name", firstname: "first_name", "given name": "first_name",
  "last name": "last_name", lastname: "last_name", surname: "last_name",
  email: "work_email", "email address": "work_email", "work email": "work_email",
  mobile: "phone", "phone number": "phone", "job title": "position", title: "position",
  location: "branch", "start date": "join_date", "joining date": "join_date", "date joined": "join_date",
  "probation end": "probation_end_date", sex: "gender", country: "nationality",
  contract: "contract_type", "employment type": "contract_type", manager: "manager_code", "manager id": "manager_code",
} satisfies Record<string, ImportKey>);

/** Parses DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY or YYYY-MM-DD into YYYY-MM-DD. */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function templateCsv(): string {
  return toCsv([
    IMPORT_COLUMNS.map((c) => c.label),
    ["", "Aishath", "Rasheed", "aishath@example.com", "+960 7771234", "Front Office", "Receptionist", "", "01/03/2025", "", "female", "Maldives", "permanent", ""],
    ["", "Rahul", "Kumar", "rahul@example.com", "+960 9991234", "Food & Beverage", "Cook", "", "15/06/2024", "15/09/2024", "male", "India", "fixed_term", ""],
  ]);
}

export function previewImport(
  text: string,
  ctx: { branches: string[]; existingCodes: string[]; existingEmails: string[]; businessCountry: string },
): ImportPreview {
  const table = parseCsv(text);
  const fileErrors: string[] = [];
  if (table.length === 0) {
    return { rows: [], fileErrors: ["The file is empty."], fileNotices: [], validCount: 0, errorCount: 0 };
  }

  const header = table[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null);
  if (!header.includes("first_name")) {
    fileErrors.push('We couldn\'t find a "First name" column. Download the template to see the expected columns.');
    return { rows: [], fileErrors, fileNotices: [], validCount: 0, errorCount: 0 };
  }
  const unknownCols = table[0].filter((h, i) => h.trim() && !header[i]);
  const body = table.slice(1);
  if (body.length === 0) fileErrors.push("The file has headings but no employees.");
  if (body.length > 1000) fileErrors.push("Please import at most 1,000 employees at a time.");

  const branchNames = new Map(ctx.branches.map((b) => [b.trim().toLowerCase(), b]));
  const existingCodes = new Set(ctx.existingCodes.map((c) => c.toLowerCase()));
  const existingEmails = new Set(ctx.existingEmails.map((e) => e.toLowerCase()));
  const seenCodes = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  const fileCodes = new Set<string>();

  const get = (cells: string[], key: ImportKey) => {
    const i = header.indexOf(key);
    return i >= 0 ? (cells[i] ?? "").trim() : "";
  };
  for (const cells of body) {
    const code = get(cells, "employee_code");
    if (code) fileCodes.add(code.toLowerCase());
  }

  const rows = body.map((cells, idx) => {
    const line = idx + 2; // row 1 is the heading, as numbered in Excel
    const errors: string[] = [];
    const warnings: string[] = [];

    const first_name = get(cells, "first_name");
    if (!first_name) errors.push("First name is missing.");

    const employee_code = get(cells, "employee_code");
    if (employee_code) {
      const k = employee_code.toLowerCase();
      if (existingCodes.has(k)) errors.push(`Employee ID "${employee_code}" is already used by another employee.`);
      else if (seenCodes.has(k)) errors.push(`Employee ID "${employee_code}" also appears on row ${seenCodes.get(k)}.`);
      else seenCodes.set(k, line);
      if (employee_code.length > 30) errors.push("Employee ID is too long (30 characters max).");
    }

    const work_email = get(cells, "work_email").toLowerCase();
    if (work_email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(work_email)) errors.push(`"${work_email}" isn't a valid email address.`);
      else if (existingEmails.has(work_email)) errors.push(`${work_email} already belongs to another employee.`);
      else if (seenEmails.has(work_email)) errors.push(`${work_email} also appears on row ${seenEmails.get(work_email)}.`);
      else seenEmails.set(work_email, line);
    }

    const branchRaw = get(cells, "branch");
    let branch = "";
    if (branchRaw) {
      const found = branchNames.get(branchRaw.toLowerCase());
      if (found) branch = found;
      else errors.push(`Branch "${branchRaw}" doesn't exist. Use one of: ${ctx.branches.join(", ") || "(add a branch first)"}.`);
    }

    const dateField = (key: "join_date" | "probation_end_date", label: string) => {
      const raw = get(cells, key);
      if (!raw) return "";
      const iso = parseDate(raw);
      if (!iso) errors.push(`${label} "${raw}" isn't a date. Use DD/MM/YYYY.`);
      return iso ?? "";
    };
    const join_date = dateField("join_date", "Join date");
    const probation_end_date = dateField("probation_end_date", "Probation end date");
    if (join_date && probation_end_date && probation_end_date < join_date) errors.push("Probation can't end before the join date.");

    const genderRaw = get(cells, "gender").toLowerCase();
    const gender = (
      { f: "female", female: "female", m: "male", male: "male", other: "other" } as Record<string, ImportRow["gender"]>
    )[genderRaw];
    if (genderRaw && !gender) errors.push(`Gender "${genderRaw}" should be female, male or other.`);

    const natRaw = get(cells, "nationality");
    let nationality = "";
    if (natRaw) {
      if (/^[A-Za-z]{2}$/.test(natRaw)) nationality = natRaw.toUpperCase();
      else if (NATIONALITIES[natRaw.toLowerCase()]) nationality = NATIONALITIES[natRaw.toLowerCase()];
      else errors.push(`Nationality "${natRaw}" wasn't recognised. Use the 2-letter country code, e.g. MV, IN, BD.`);
    }

    const contractRaw = get(cells, "contract_type").toLowerCase().replace(/[\s-]+/g, "_");
    const contract_type = contractRaw || "permanent";
    if (!CONTRACT_TYPES.includes(contract_type)) errors.push(`Contract type "${get(cells, "contract_type")}" should be one of: ${CONTRACT_TYPES.join(", ")}.`);

    const manager_code = get(cells, "manager_code");
    if (manager_code) {
      const k = manager_code.toLowerCase();
      if (!fileCodes.has(k) && !existingCodes.has(k)) errors.push(`Manager ID "${manager_code}" doesn't match any employee.`);
      if (employee_code && k === employee_code.toLowerCase()) errors.push("An employee can't be their own manager.");
    }

    if (!work_email) warnings.push("No email, so they can't be invited to the staff app yet.");

    const data: ImportRow = {
      employee_code,
      first_name,
      last_name: get(cells, "last_name"),
      work_email,
      phone: get(cells, "phone"),
      department: get(cells, "department"),
      position: get(cells, "position"),
      branch,
      join_date,
      probation_end_date,
      gender: gender ?? "",
      nationality,
      is_expatriate: !!nationality && nationality !== ctx.businessCountry,
      contract_type,
      manager_code,
    };
    return { line, data, errors, warnings };
  });

  const fileNotices = unknownCols.length ? [`These columns were ignored: ${unknownCols.join(", ")}.`] : [];
  const errorCount = rows.filter((r) => r.errors.length).length;
  return { rows, fileErrors, fileNotices, validCount: rows.length - errorCount, errorCount };
}
