/**
 * Allowances and deductions ("pay items"): how each is worked out, the
 * rules that change it, and the starting templates. Shared by the
 * browser and the server; the database does the actual calculating.
 */
import { PAY_VARIABLES, type PayVariable } from "./formula";

export const METHODS = [
  { value: "fixed", label: "Fixed amount per month", hint: "The same amount every month." },
  { value: "per_day", label: "Per day attended", hint: "Rate × days present." },
  { value: "prorated", label: "Prorated by attendance", hint: "Amount × days present ÷ days in the month (or working days)." },
  { value: "percent", label: "Percentage of basic salary", hint: "A percentage of the basic salary." },
  { value: "per_occurrence", label: "Per occurrence", hint: "An amount for each time something happens, such as each late." },
  { value: "formula", label: "Custom formula", hint: "Your own formula with the variables below." },
] as const;
export type Method = (typeof METHODS)[number]["value"];

export const OCCURRENCE_VARIABLES: { value: PayVariable; label: string; unit: [string, string] }[] = [
  { value: "late_count", label: "Each time late", unit: ["late", "lates"] },
  { value: "early_leaves", label: "Each early leave", unit: ["early leave", "early leaves"] },
  { value: "unapproved_absences", label: "Each unapproved absence", unit: ["unapproved absence", "unapproved absences"] },
  { value: "half_days", label: "Each half day", unit: ["half day", "half days"] },
  { value: "consecutive_unapproved_absences", label: "Each day in the longest run of absences", unit: ["day in a row", "days in a row"] },
];

export const OPERATORS = [
  { value: ">=", label: "is at least" },
  { value: ">", label: "is more than" },
  { value: "<=", label: "is at most" },
  { value: "<", label: "is less than" },
  { value: "=", label: "is exactly" },
  { value: "!=", label: "is not" },
] as const;
export type Operator = (typeof OPERATORS)[number]["value"];

export const OUTCOMES = [
  { value: "full", label: "Pay in full", needsValue: false },
  { value: "percent", label: "Pay a percentage", needsValue: true },
  { value: "nothing", label: "Pay nothing", needsValue: false },
  { value: "subtract", label: "Take off an amount", needsValue: true },
  { value: "fixed", label: "Pay a set amount", needsValue: true },
] as const;
export type OutcomeType = (typeof OUTCOMES)[number]["value"];

export interface Clause {
  var: PayVariable;
  op: Operator;
  value: number;
}

export interface PayRule {
  label: string;
  join: "and" | "or";
  clauses: Clause[];
  outcome: { type: OutcomeType; value?: number | null };
}

export const varLabel = (key: string) => PAY_VARIABLES.find((v) => v.key === key)?.label ?? key;
export const opLabel = (op: string) => OPERATORS.find((o) => o.value === op)?.label ?? op;

/** "Unapproved absences is at least 3 and half days is at least 2" */
export function describeRule(r: PayRule) {
  return r.clauses.map((c) => `${varLabel(c.var).toLowerCase()} ${opLabel(c.op)} ${c.value}`).join(r.join === "and" ? " and " : " or ");
}

export function describeOutcome(o: PayRule["outcome"], money: (n: number) => string) {
  switch (o.type) {
    case "full":
      return "pay in full";
    case "percent":
      return `pay ${o.value ?? 0}%`;
    case "nothing":
      return "pay nothing";
    case "subtract":
      return `take off ${money(Number(o.value ?? 0))}`;
    case "fixed":
      return `pay ${money(Number(o.value ?? 0))}`;
  }
}

function test(c: Clause, x: number) {
  switch (c.op) {
    case ">=":
      return x >= c.value;
    case ">":
      return x > c.value;
    case "<=":
      return x <= c.value;
    case "<":
      return x < c.value;
    case "=":
      return x === c.value;
    case "!=":
      return x !== c.value;
  }
}

const matches = (r: PayRule, point: Map<string, number>) =>
  r.join === "and" ? r.clauses.every((c) => test(c, point.get(c.var)!)) : r.clauses.some((c) => test(c, point.get(c.var)!));

/**
 * For each rule, whether it can ever be reached. Every rule compares one
 * variable with a number, so checking each number used, the points between
 * them and one beyond covers every case exactly. Variables are never negative.
 */
export function unreachableRules(rules: PayRule[]): { index: number; reason: string }[] {
  const out: { index: number; reason: string }[] = [];
  for (let j = 0; j < rules.length; j++) {
    const rule = rules[j];
    if (!rule.clauses.length) continue;
    const involved = rules.slice(0, j + 1);
    const vars = [...new Set(involved.flatMap((r) => r.clauses.map((c) => c.var)))];
    const points = vars.map((v) => {
      const cuts = [...new Set(involved.flatMap((r) => r.clauses.filter((c) => c.var === v).map((c) => c.value)))].sort((a, b) => a - b);
      const vals = new Set<number>([0]);
      cuts.forEach((c, i) => {
        vals.add(c);
        vals.add(c + 0.5);
        if (i === 0) vals.add(c - 0.5);
        else vals.add((cuts[i - 1] + c) / 2);
      });
      return [...vals].filter((x) => x >= 0);
    });
    const total = points.reduce((n, p) => n * p.length, 1);
    if (total > 200_000) continue;
    let reachable = false;
    let everMatches = false;
    let catcher = -1;
    const idx = vars.map(() => 0);
    for (let k = 0; k < total && !reachable; k++) {
      let rest = k;
      const point = new Map<string, number>();
      vars.forEach((v, i) => {
        idx[i] = rest % points[i].length;
        rest = Math.floor(rest / points[i].length);
        point.set(v, points[i][idx[i]]);
      });
      if (!matches(rule, point)) continue;
      everMatches = true;
      const earlier = rules.slice(0, j).findIndex((r) => r.clauses.length && matches(r, point));
      if (earlier === -1) reachable = true;
      else if (catcher === -1) catcher = earlier;
    }
    if (!reachable) {
      out.push({
        index: j,
        reason: !everMatches
          ? "This rule can never match (no numbers fit it)."
          : `This rule is never reached: every case it covers is already caught by rule ${catcher + 1}${
              rules.slice(0, j).filter((r) => r.clauses.length).length > 1 ? " or another rule above it" : ""
            }.`,
      });
    }
  }
  return out;
}

export interface PayItemTemplate {
  key: string;
  name: string;
  kind: "earning" | "deduction";
  description: string;
  method: Method;
  amount: number;
  percent?: number;
  prorate_basis?: "calendar" | "working";
  occurrence_var?: PayVariable;
  occurrence_after?: number;
  formula?: string;
  rules?: PayRule[];
  is_taxable: boolean;
  is_pensionable: boolean;
}

/** Starting points. Amounts are examples: change them to your own. */
export const TEMPLATES: PayItemTemplate[] = [
  {
    key: "attendance_allowance",
    name: "Attendance allowance",
    kind: "earning",
    description: "Rewards good attendance. Nothing with 10 or more half days, half with 3 or more unapproved absences, otherwise in full.",
    method: "fixed",
    amount: 1000,
    rules: [
      { label: "10 or more half days", join: "and", clauses: [{ var: "half_days", op: ">=", value: 10 }], outcome: { type: "nothing" } },
      { label: "Unapproved absences 3 or more", join: "and", clauses: [{ var: "unapproved_absences", op: ">=", value: 3 }], outcome: { type: "percent", value: 50 } },
    ],
    is_taxable: true,
    is_pensionable: false,
  },
  {
    key: "service_charge",
    name: "Service charge",
    kind: "earning",
    description: "Each person's share of service charge, by the days they worked. Set this month's share as the amount.",
    method: "prorated",
    amount: 5000,
    prorate_basis: "working",
    is_taxable: true,
    is_pensionable: false,
  },
  {
    key: "food_allowance",
    name: "Food allowance",
    kind: "earning",
    description: "A fixed amount for meals each month.",
    method: "fixed",
    amount: 1500,
    is_taxable: false,
    is_pensionable: false,
  },
  {
    key: "transport_allowance",
    name: "Transport allowance",
    kind: "earning",
    description: "Paid for each day they come to work.",
    method: "per_day",
    amount: 30,
    is_taxable: false,
    is_pensionable: false,
  },
  {
    key: "phone_allowance",
    name: "Phone allowance",
    kind: "earning",
    description: "A fixed amount for phone costs each month.",
    method: "fixed",
    amount: 300,
    is_taxable: true,
    is_pensionable: false,
  },
  {
    key: "island_allowance",
    name: "Island allowance",
    kind: "earning",
    description: "For people working on an island location, by the days they were there. Choose the locations it's for.",
    method: "prorated",
    amount: 2000,
    prorate_basis: "calendar",
    is_taxable: true,
    is_pensionable: false,
  },
  {
    key: "late_penalty",
    name: "Late penalty",
    kind: "deduction",
    description: "Taken off for each time late after the third in a month.",
    method: "per_occurrence",
    amount: 50,
    occurrence_var: "late_count",
    occurrence_after: 3,
    is_taxable: false,
    is_pensionable: false,
  },
  {
    key: "absence_deduction",
    name: "Unapproved absence deduction",
    kind: "deduction",
    description: "A day's basic salary for each unapproved absence.",
    method: "formula",
    amount: 0,
    formula: "ROUND(basic_salary / working_days * unapproved_absences, 2)",
    is_taxable: false,
    is_pensionable: false,
  },
  {
    key: "consecutive_absence_penalty",
    name: "Consecutive absence penalty",
    kind: "deduction",
    description: "Taken off when someone misses 3 or more working days in a row without approval.",
    method: "fixed",
    amount: 500,
    rules: [
      { label: "Fewer than 3 days in a row", join: "and", clauses: [{ var: "consecutive_unapproved_absences", op: "<", value: 3 }], outcome: { type: "nothing" } },
    ],
    is_taxable: false,
    is_pensionable: false,
  },
];

export interface PayItemSummaryInput {
  method: string;
  default_amount: number;
  default_percent: number | null;
  prorate_basis: string;
  occurrence_var: string | null;
  occurrence_after: number;
  formula: string | null;
}

/** "MVR 1,000.00 a month", "MVR 50.00 per late after the 3rd", "10% of basic salary"… */
export function methodSummary(i: PayItemSummaryInput, money: (n: number) => string) {
  switch (i.method) {
    case "fixed":
      return `${money(i.default_amount)} a month`;
    case "per_day":
      return `${money(i.default_amount)} per day attended`;
    case "prorated":
      return `${money(i.default_amount)}, by days attended (${i.prorate_basis === "working" ? "working days" : "calendar days"})`;
    case "percent":
      return `${i.default_percent ?? 0}% of basic salary`;
    case "per_occurrence": {
      const o = OCCURRENCE_VARIABLES.find((x) => x.value === i.occurrence_var);
      const unit = o?.unit[0] ?? "time";
      const after = i.occurrence_after;
      return `${money(i.default_amount)} per ${unit}${after ? ` after the ${after}${after === 1 ? "st" : after === 2 ? "nd" : after === 3 ? "rd" : "th"}` : ""}`;
    }
    default:
      return `Formula: ${i.formula ?? ""}`;
  }
}
