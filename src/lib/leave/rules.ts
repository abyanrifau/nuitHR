/** Time off rules in plain words, shared by the staff form and the office pages. */

export interface LeaveRules {
  notice_value: number;
  notice_unit: "minutes" | "hours" | "days";
  after_the_fact: boolean;
  min_days: number | null;
  max_days: number | null;
  max_consecutive: number | null;
  max_off: number | null;
  document_rule: "none" | "always" | "over_days";
  document_over_days: number | null;
  document_later: boolean;
  document_deadline_days: number;
  birthday_window: "month" | "days_after" | null;
  birthday_window_days: number;
}

/** One type as the staff app gets it from my_leave_types. */
export interface MyLeaveType {
  id: string;
  name: string;
  color: string;
  is_paid: boolean;
  mode: "annual" | "unlimited" | "granted" | "birthday";
  allow_half_day: boolean;
  year_starts: string;
  year_ends: string;
  entitled: number | null;
  granted: number;
  taken: number;
  pending: number;
  available: number | null;
  rules: LeaveRules;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const num = (v: number | string | null | undefined) => {
  const x = Number(v ?? 0);
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
};

export function noticeText(r: Pick<LeaveRules, "notice_value" | "notice_unit" | "after_the_fact">) {
  const ask = r.notice_value > 0 ? `Ask at least ${plural(r.notice_value, r.notice_unit.slice(0, -1))} before` : "No notice needed";
  return r.after_the_fact ? `${ask}. You can also ask after the day.` : `${ask}.`;
}

export function documentText(r: Pick<LeaveRules, "document_rule" | "document_over_days" | "document_later" | "document_deadline_days">) {
  if (r.document_rule === "none") return null;
  const when = r.document_rule === "always" ? "A document is needed" : `A document is needed for more than ${plural(Number(r.document_over_days ?? 0), "day")}`;
  return r.document_later
    ? `${when}. You can add it up to ${plural(r.document_deadline_days, "day")} after you're back; without it, the days become unapproved absences.`
    : `${when} when you ask.`;
}

/** Each rule that applies, as a short sentence. */
export function ruleLines(t: Pick<MyLeaveType, "rules" | "allow_half_day" | "is_paid" | "mode">) {
  const r = t.rules;
  const lines = [noticeText(r)];
  if (r.min_days) lines.push(`At least ${plural(Number(r.min_days), "day")} at a time.`);
  if (r.max_days) lines.push(`Up to ${plural(Number(r.max_days), "day")} at a time.`);
  if (r.max_consecutive) lines.push(`Up to ${plural(r.max_consecutive, "day")} in a row.`);
  if (r.max_off) lines.push(`Up to ${plural(r.max_off, "person", "people")} from your team can be off at once.`);
  if (t.mode === "birthday") lines.push(r.birthday_window === "days_after" ? `Use it within ${plural(r.birthday_window_days, "day")} from your birthday.` : "Use it in your birthday month.");
  lines.push(t.allow_half_day ? "Half days are fine." : "Whole days only.");
  const doc = documentText(r);
  if (doc) lines.push(doc);
  if (!t.is_paid) lines.push("Unpaid: it comes off your pay.");
  return lines;
}

export const NOTICE_UNITS = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
];

export const SERVICE_UNITS = [
  { value: "days", label: "days" },
  { value: "months", label: "months" },
  { value: "years", label: "years" },
];

export const ENTITLEMENT_MODES = [
  { value: "annual", label: "A fixed number of days each leave year" },
  { value: "unlimited", label: "No limit (for example unpaid leave)" },
  { value: "granted", label: "Only days HR gives to a person" },
  { value: "birthday", label: "Birthday leave (around each person's birthday)" },
];

export const DOCUMENT_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  needed: { label: "Document needed", tone: "warning" },
  uploaded: { label: "Document added", tone: "success" },
  overdue: { label: "No document: absence", tone: "danger" },
  waived: { label: "Document not needed (HR)", tone: "neutral" },
};
