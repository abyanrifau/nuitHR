/**
 * Allowances and deductions: the formula calculator, each calculation
 * method, rules (first match wins), who gets an item, the test panel,
 * payroll lines with explanations, finalized runs staying as they were,
 * the history of changes, who may see pay, and salary changes in bulk.
 *
 * June 2026, Sunday to Thursday working: 22 working days, 30 days.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";
import { parseFormula } from "@/lib/payroll/formula";
import { TEMPLATES } from "@/lib/payroll/pay-items";

let db: PGlite;
let f: Fixture;

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const ast = (text: string) => {
  const r = parseFormula(text);
  if (!r.ok) throw new Error(r.error);
  return JSON.stringify(r.ast);
};

// Working days in June 2026 (Sun–Thu).
const JUNE: string[] = [];
for (let d = 1; d <= 30; d++) {
  const iso = `2026-06-${String(d).padStart(2, "0")}`;
  if (new Date(`${iso}T00:00:00Z`).getUTCDay() <= 4) JUNE.push(iso);
}

/** Clock-ins for a person: "on time" 09:00–17:00, "late" 09:30–17:00, "half" 09:00–11:00 (Maldives time). */
async function attend(emp: string, days: string[], how: "on_time" | "late" | "half") {
  const [inH, inM, outH] = how === "late" ? [4, 30, 12] : how === "half" ? [4, 0, 6] : [4, 0, 12];
  for (const d of days) {
    await db.query(
      `insert into public.attendance_records (business_id, employee_id, work_date, clock_in_at, clock_out_at, source)
       values ($1, $2, $3, ($3::date + make_interval(hours => $4, mins => $5)) at time zone 'UTC', ($3::date + make_interval(hours => $6)) at time zone 'UTC', 'manual')`,
      [f.bizA, emp, d, inH, inM, outH],
    );
  }
}

async function addItem(t: (typeof TEMPLATES)[number], extra: Record<string, unknown> = {}) {
  const row = {
    name: t.name,
    code: t.key.toUpperCase().slice(0, 12),
    kind: t.kind,
    method: t.method,
    default_amount: t.amount,
    default_percent: t.percent ?? null,
    prorate_basis: t.prorate_basis ?? "working",
    occurrence_var: t.occurrence_var ?? null,
    occurrence_after: t.occurrence_after ?? 0,
    formula: t.formula ?? null,
    formula_ast: t.formula ? JSON.parse(ast(t.formula)) : null,
    rules_mode: t.rules?.length ? "builder" : "none",
    rules: JSON.stringify(t.rules ?? []),
    is_taxable: t.is_taxable,
    is_pensionable: t.is_pensionable,
    applies_to: "all",
    template_key: t.key,
    ...extra,
  };
  const keys = Object.keys(row);
  return asUser(db, f.users.payrollA, async (tx) =>
    (await one<{ id: string }>(tx, `insert into public.pay_components (business_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) returning id`, [
      f.bizA,
      ...Object.values(row),
    ])).id,
  );
}

type Preview = { vars: Record<string, number>; items: { id: string; name: string; applies: boolean; amount: number | null; explanation: string | null; why_not: string | null }[] };
const preview = (emp: string, draft: unknown = null, user = f.users.payrollA) =>
  asUser(db, user, async (tx) => (await one<{ p: Preview }>(tx, `select public.pay_items_preview($1, $2, '2026-06-01', $3) as p`, [f.bizA, emp, draft ? JSON.stringify(draft) : null])).p);
const item = (p: Preview, name: string) => p.items.find((i) => i.name === name)!;

let attendanceId: string;

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  await db.query(`update public.businesses set timezone = 'Indian/Maldives', working_days = '{0,1,2,3,4}' where id = $1`, [f.bizA]);
  await db.query(`update public.employees set join_date = '2020-01-01' where business_id = $1`, [f.bizA]);
  const shift = (await q<{ id: string }>(`insert into public.shifts (business_id, name, start_time, end_time, break_minutes) values ($1, 'Day', '09:00', '17:00', 60) returning id`, [f.bizA]))[0].id;
  await db.query(`insert into public.work_schedules (business_id, name, shift_id, working_days, is_default) values ($1, 'Office', $2, '{0,1,2,3,4}', true)`, [f.bizA, shift]);

  // S1: every day on time. S2: 4 days missed, 5 days late. M: 10 half days, the rest on time.
  await attend(f.empA.S1, JUNE, "on_time");
  await attend(f.empA.S2, JUNE.slice(4, 9), "late");
  await attend(f.empA.S2, JUNE.slice(9), "on_time");
  await attend(f.empA.M, JUNE.slice(0, 10), "half");
  await attend(f.empA.M, JUNE.slice(10), "on_time");

  attendanceId = await addItem(TEMPLATES.find((t) => t.key === "attendance_allowance")!);
  await addItem(TEMPLATES.find((t) => t.key === "late_penalty")!);
});

describe("the formula calculator", () => {
  const calc = async (text: string, vars: Record<string, number> = {}) =>
    Number((await one<{ r: string }>(db, `select private.pay_eval($1::jsonb, $2::jsonb) as r`, [ast(text), JSON.stringify({ amount: 1000, unapproved_absences: 3, working_days: 0, ...vars })])).r);

  it("works out arithmetic, IF, AND, OR, MIN, MAX and ROUND", async () => {
    expect(await calc("IF(unapproved_absences >= 3, amount * 0.5, amount)")).toBe(500);
    expect(await calc("IF(unapproved_absences >= 3, amount * 0.5, amount)", { unapproved_absences: 2 })).toBe(1000);
    expect(await calc("IF(AND(unapproved_absences > 1, amount = 1000), 1, 0) + IF(OR(amount < 5, amount > 999), 10, 0)")).toBe(11);
    expect(await calc("MIN(amount, 800) + MAX(2, 3) - -1")).toBe(804);
    expect(await calc("ROUND(amount / 3, 2)")).toBe(333.33);
    // Dividing by zero gives zero instead of stopping a pay run.
    expect(await calc("amount / working_days")).toBe(0);
  });

  it("refuses anything that isn't a plain formula", async () => {
    const bad = (tree: unknown) => db.query(`select private.pay_eval($1::jsonb, '{}'::jsonb)`, [JSON.stringify(tree)]);
    await expect(bad(["var", "password"])).rejects.toThrow(/isn't a variable/);
    await expect(bad(["EVAL", ["num", 1]])).rejects.toThrow(/isn't allowed/);
    await expect(bad(["+", ["num", 1]])).rejects.toThrow(/isn't valid/);
    await expect(bad({ op: "num" })).rejects.toThrow(/isn't valid/);
    // And it can't be saved on an item.
    await expect(addItem(TEMPLATES[0], { name: "Broken", code: "BROKEN", method: "formula", formula: "x", formula_ast: '["var","salary_table"]' })).rejects.toThrow(/isn't a variable/);
  });
});

describe("the month's numbers", () => {
  it("counts attendance for each person", async () => {
    const s2 = (await preview(f.empA.S2)).vars;
    expect(s2).toMatchObject({ working_days: 22, days_in_month: 30, unapproved_absences: 4, late_count: 5, days_present: 18, consecutive_unapproved_absences: 4 });
    const m = (await preview(f.empA.M)).vars;
    expect(m).toMatchObject({ half_days: 10, days_present: 17, unapproved_absences: 0 });
    expect((await preview(f.empA.S1)).vars).toMatchObject({ days_present: 22, late_count: 0, years_of_service: 6 });
  });

  it("works for someone with no days employed that month, right after someone with attendance", async () => {
    await db.query(`update public.employees set join_date = '2026-07-15' where id = $1`, [f.empA.M]);
    await preview(f.empA.S2);
    const m = await preview(f.empA.M);
    expect(m.vars).toMatchObject({ days_present: 0, unapproved_absences: 0, years_of_service: 0 });
    // They get nothing for a month they didn't work for the company.
    expect(item(m, "Attendance allowance")).toMatchObject({ applies: false, why_not: "Not working for you that month" });
    expect((await preview(f.empA.S2)).vars).toMatchObject({ days_present: 18 });
    await db.query(`update public.employees set join_date = '2020-01-01' where id = $1`, [f.empA.M]);
  });
});

describe("attendance allowance and late penalty (the requested check)", () => {
  it("pays in full, half or nothing depending on attendance, and explains why", async () => {
    const full = item(await preview(f.empA.S1), "Attendance allowance");
    expect(full.amount).toBe(1000);
    expect(full.explanation).toBe("MVR 1,000.00 a month. No rule matched, so it's paid in full");

    const half = item(await preview(f.empA.S2), "Attendance allowance");
    expect(half.amount).toBe(500);
    expect(half.explanation).toBe("MVR 1,000.00 a month. Rule 'Unapproved absences 3 or more' applied: 50% = MVR 500.00");

    const none = item(await preview(f.empA.M), "Attendance allowance");
    expect(none.amount).toBe(0);
    expect(none.explanation).toBe("MVR 1,000.00 a month. Rule '10 or more half days' applied: nothing paid");
  });

  it("charges each late after the third", async () => {
    const s2 = item(await preview(f.empA.S2), "Late penalty");
    expect(s2.amount).toBe(100);
    expect(s2.explanation).toBe("5 lates, the first 3 free, so 2 counted: MVR 50.00 × 2 = MVR 100.00");
    expect(item(await preview(f.empA.S1), "Late penalty")).toMatchObject({ amount: 0, explanation: "0 lates, within the first 3 that are free, so nothing is taken off" });
  });
});

describe("calculation methods", () => {
  it("prorates by working days, then applies a rule formula", async () => {
    const draft = {
      name: "Prorated test", code: "PRO", kind: "earning", method: "prorated", default_amount: 1000, prorate_basis: "working",
      rules_mode: "formula", rules_formula: "IF(unapproved_absences >= 3, amount * 0.5, amount)",
      rules_ast: JSON.parse(ast("IF(unapproved_absences >= 3, amount * 0.5, amount)")), applies_to: "all", is_taxable: true,
    };
    const r = item(await preview(f.empA.S2, draft), "Prorated test");
    // 1,000 × 18 / 22 = 818.18, then halved.
    expect(r.amount).toBe(409.09);
    expect(r.explanation).toBe(
      "MVR 1,000.00 × 18 of 22 working days = MVR 818.18. Rule formula IF(unapproved_absences >= 3, amount * 0.5, amount) gives MVR 409.09 (unapproved_absences 4, amount MVR 818.18)",
    );
  });

  it("per day attended, percentage of basic, calendar-day proration and the absence deduction", async () => {
    const perDay = item(await preview(f.empA.S2, { name: "Transport", code: "TR", kind: "earning", method: "per_day", default_amount: 30, applies_to: "all" }), "Transport");
    expect(perDay).toMatchObject({ amount: 540, explanation: "MVR 30.00 × 18 days present = MVR 540.00" });
    const pct = item(await preview(f.empA.S1, { name: "Pct", code: "PCT", kind: "earning", method: "percent", default_percent: 10, applies_to: "all" }), "Pct");
    expect(pct).toMatchObject({ amount: 1200, explanation: "10% of basic salary MVR 12,000.00 = MVR 1,200.00" });
    // Calendar days: 30 days less 4 missed = 26 of 30.
    const cal = item(await preview(f.empA.S2, { name: "Island", code: "ISL", kind: "earning", method: "prorated", prorate_basis: "calendar", default_amount: 3000, applies_to: "all" }), "Island");
    expect(cal).toMatchObject({ amount: 2600, explanation: "MVR 3,000.00 × 26 of 30 days in the month = MVR 2,600.00" });
    // Every payroll company gets the absence deduction: a day's basic salary per unapproved absence (11,000 / 22 × 4).
    const abs = item(await preview(f.empA.S2), "Unapproved absence deduction");
    expect(abs).toMatchObject({
      amount: 2000,
      explanation: "ROUND(basic_salary / working_days * unapproved_absences, 2) = MVR 2,000.00 (basic_salary MVR 11,000.00, working_days 22, unapproved_absences 4)",
    });
  });

  it("uses someone's own amount, and only gives selected items to the people chosen", async () => {
    const phone = await addItem(TEMPLATES.find((t) => t.key === "phone_allowance")!, { applies_to: "selected" });
    await asUser(db, f.users.payrollA, (tx) =>
      tx.query(`insert into public.pay_component_targets (business_id, component_id, target_type, target_id) values ($1, $2, 'department', $3)`, [f.bizA, phone, f.deptA.kitchen]),
    );
    expect(item(await preview(f.empA.S2), "Phone allowance")).toMatchObject({ applies: true, amount: 300 });
    expect(item(await preview(f.empA.S1), "Phone allowance")).toMatchObject({ applies: false, why_not: "Not for this person" });
    // S1 gets it with their own amount.
    await asUser(db, f.users.payrollA, (tx) =>
      tx.query(`insert into public.employee_pay_components (business_id, employee_id, component_id, amount, start_date) values ($1, $2, $3, 450, '2026-01-01')`, [f.bizA, f.empA.S1, phone]),
    );
    expect(item(await preview(f.empA.S1), "Phone allowance")).toMatchObject({ applies: true, amount: 450 });
    // Not in effect before its start date.
    await asUser(db, f.users.payrollA, (tx) => tx.query(`update public.pay_components set effective_from = '2026-07-01' where id = $1`, [phone]));
    expect(item(await preview(f.empA.S2), "Phone allowance")).toMatchObject({ applies: false, why_not: "Not in effect that month" });
  });
});

describe("payroll", () => {
  let run: string;

  it("adds each item to the run with its explanation", async () => {
    run = (await asUser(db, f.users.payrollA, (tx) => one<{ id: string }>(tx, `select public.create_payroll_run($1, '2026-06-01', '2026-06-30', '2026-06-28') as id`, [f.bizA]))).id;
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    const lines = await q<{ employee_id: string; code: string; kind: string; amount: string; explanation: string }>(
      `select employee_id, code, kind, amount, explanation from public.payroll_run_lines where run_id = $1 and source = 'component'`, [run]);
    const s2 = lines.filter((l) => l.employee_id === f.empA.S2);
    expect(s2.find((l) => l.code === "ATTENDANCE_A")).toMatchObject({ kind: "earning", amount: "500.00" });
    expect(s2.find((l) => l.code === "LATE_PENALTY")).toMatchObject({ kind: "deduction", amount: "100.00", explanation: expect.stringContaining("the first 3 free") });
    expect(s2.find((l) => l.code === "ABSENCE")).toMatchObject({ kind: "deduction", amount: "2000.00" });
    // Nothing paid means no line at all.
    expect(lines.find((l) => l.employee_id === f.empA.M && l.code === "ATTENDANCE_A")).toBeUndefined();
    // Basic salary no longer takes off absences (the deduction does), so S2 gets a full month.
    expect((await q<{ amount: string }>(`select amount from public.payroll_run_lines where run_id = $1 and employee_id = $2 and code = 'BASIC'`, [run, f.empA.S2]))[0].amount).toBe("11000.00");
  });

  it("never changes a finalized run when an item is edited", async () => {
    await db.query(`insert into public.employee_bank_accounts (business_id, employee_id, bank_name, account_name, account_number, is_primary)
                    select business_id, id, 'BML', first_name, '7701' || employee_code, true from public.employees where business_id = $1`, [f.bizA]);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.approve_payroll_run($1)`, [run]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.finalize_payroll_run($1)`, [run]));
    const before = await q(`select employee_id, code, amount, explanation from public.payroll_run_lines where run_id = $1 order by employee_id, code, amount`, [run]);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`update public.pay_components set default_amount = 5000 where id = $1`, [attendanceId]));
    await expect(asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]))).rejects.toThrow(/locked/);
    expect(await q(`select employee_id, code, amount, explanation from public.payroll_run_lines where run_id = $1 order by employee_id, code, amount`, [run])).toEqual(before);
  });

  it("keeps who changed an item, when, and the values before and after", async () => {
    const log = await q<{ actor_id: string; changes: { default_amount: { from: number; to: number } }; created_at: string }>(
      `select actor_id, changes, created_at from public.audit_log where entity_id = $1 and action = 'update' order by created_at desc limit 1`, [attendanceId]);
    expect(log[0].actor_id).toBe(f.users.payrollA);
    expect(log[0].changes.default_amount).toEqual({ from: 1000, to: 5000 });
    expect(log[0].created_at).toBeTruthy();
  });
});

describe("who may see pay", () => {
  it("only the owner and payroll can see items or test them", async () => {
    for (const user of [f.users.hrA, f.users.managerA, f.users.staffA]) {
      const rows = await asUser(db, user, async (tx) => (await tx.query(`select 1 from public.pay_components where business_id = $1`, [f.bizA])).rows);
      expect(rows.length).toBe(0);
      await expect(preview(f.empA.S1, null, user)).rejects.toThrow(/permission/);
    }
    const own = await asUser(db, f.users.ownerA, async (tx) => (await tx.query(`select 1 from public.pay_components where business_id = $1`, [f.bizA])).rows);
    expect(own.length).toBeGreaterThan(0);
    await expect(
      asUser(db, f.users.hrA, (tx) => tx.query(`insert into public.pay_components (business_id, name, code, kind) values ($1, 'Sneaky', 'SNK', 'earning')`, [f.bizA])),
    ).rejects.toThrow();
  });
});

describe("salaries", () => {
  it("raises a department by a percentage from a date, keeping the history", async () => {
    const preview = await asUser(db, f.users.payrollA, (tx) =>
      one<{ r: { changed: number; rows: { employee_id: string; old: number; new: number }[] } }>(
        tx, `select public.bulk_change_salaries($1, $2, 'percent', 5, '2026-08-01', 'Annual raise', true) as r`, [f.bizA, [f.empA.M, f.empA.S1]]),
    );
    expect(preview.r.changed).toBe(2);
    expect(preview.r.rows.find((x) => x.employee_id === f.empA.S1)).toMatchObject({ old: 12000, new: 12600 });
    // Nothing is saved on a preview.
    expect((await q(`select 1 from public.employee_compensation where effective_date = '2026-08-01'`)).length).toBe(0);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.bulk_change_salaries($1, $2, 'percent', 5, '2026-08-01', 'Annual raise', false)`, [f.bizA, [f.empA.M, f.empA.S1]]));
    const hist = await q<{ basic_salary: string; effective_date: string }>(
      `select basic_salary, effective_date::text from public.employee_compensation where employee_id = $1 order by effective_date`, [f.empA.S1]);
    expect(hist).toEqual([{ basic_salary: "12000.00", effective_date: "2024-01-01" }, { basic_salary: "12600.00", effective_date: "2026-08-01" }]);
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.bulk_change_salaries($1, $2, 'percent', 5, '2026-08-01', 'x', false)`, [f.bizA, [f.empA.S1]]))).rejects.toThrow(/permission/);
  });

  it("imports salaries from a file, checking every row first", async () => {
    const rows = [
      { row: 2, code: "E003", salary: "11,500", date: "2026-09-01" },
      { row: 3, code: "E999", salary: "100", date: "2026-09-01" },
      { row: 4, code: "E001", salary: "abc", date: "2026-09-01" },
    ];
    const check = await asUser(db, f.users.payrollA, (tx) => one<{ r: { valid: number; imported: number; errors: { row: number; message: string }[] } }>(
      tx, `select public.import_salaries($1, $2, false) as r`, [f.bizA, JSON.stringify(rows)]));
    // Problems mean nothing is saved.
    expect(check.r).toMatchObject({ valid: 1, imported: 0 });
    expect(check.r.errors.map((e) => e.row)).toEqual([3, 4]);
    const ok = await asUser(db, f.users.payrollA, (tx) => one<{ r: { imported: number } }>(tx, `select public.import_salaries($1, $2, false) as r`, [f.bizA, JSON.stringify(rows.slice(0, 1))]));
    expect(ok.r.imported).toBe(1);
    expect((await q<{ basic_salary: string }>(`select basic_salary from public.employee_compensation where employee_id = $1 and effective_date = '2026-09-01'`, [f.empA.S2]))[0].basic_salary).toBe("11500.00");
  });
});
