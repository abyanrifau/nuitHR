/**
 * Payroll engine and claims: salary with proration and unpaid leave,
 * allowances, overtime, claims, loans, pension, tax, finalizing (locks,
 * publishes payslips, records repayments), reversing, and permissions.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
let run: string;

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const payslip = async (runId: string, emp: string) =>
  (await q<{ id: string; gross_pay: string; net_pay: string; total_deductions: string; employer_contributions: string; paid_days: string; status: string; exceptions: unknown[] }>(
    `select * from public.payroll_run_employees where run_id = $1 and employee_id = $2`, [runId, emp]))[0];
const lines = async (runId: string, emp: string) =>
  q<{ code: string; kind: string; amount: string; source: string }>(`select code, kind, amount, source from public.payroll_run_lines where run_id = $1 and employee_id = $2 order by sort`, [runId, emp]);
const line = async (runId: string, emp: string, code: string) => Number((await lines(runId, emp)).find((l) => l.code === code)?.amount ?? 0);

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  await db.query(`update public.businesses set country = 'MV', working_days = '{0,1,2,3,4}' where id = $1`, [f.bizA]);
  await db.query(`update public.employees set join_date = '2020-01-01', nationality = 'MV', is_expatriate = false where business_id = $1`, [f.bizA]);
  // S2 is an expatriate: no pension.
  await db.query(`update public.employees set nationality = 'IN', is_expatriate = true where id = $1`, [f.empA.S2]);
  await db.query(`insert into public.pension_schemes (business_id, name, employee_rate, employer_rate, applies_to, effective_from) values ($1, 'Pension', 7, 7, 'locals', '2020-01-01')`, [f.bizA]);
  const tax = (await q<{ id: string }>(`insert into public.tax_tables (business_id, name, basis, effective_from) values ($1, 'Tax', 'monthly', '2020-01-01') returning id`, [f.bizA]))[0].id;
  await db.query(
    `insert into public.tax_brackets (business_id, tax_table_id, lower_bound, upper_bound, rate, sort) values ($1, $2, 0, 20000, 0, 1), ($1, $2, 20000, null, 10, 2)`,
    [f.bizA, tax],
  );
  // Manager gets a fixed 2,000 allowance (pensionable, taxable).
  const comp = (await q<{ id: string }>(
    `insert into public.pay_components (business_id, name, code, kind, category, calc_type, default_amount, is_taxable, is_pensionable, applies_to) values ($1, 'Housing', 'HOUSE', 'earning', 'allowance', 'fixed', 2000, true, true, 'selected') returning id`,
    [f.bizA],
  ))[0].id;
  await db.query(`insert into public.employee_pay_components (business_id, employee_id, component_id, start_date) values ($1, $2, $3, '2024-01-01')`, [f.bizA, f.empA.M, comp]);
  // Nobody here clocks in, so every working day would be an unapproved absence: switch that deduction off
  // for these tests (tests/db/pay-items.test.ts covers it).
  await db.query(`update public.pay_components set is_active = false where business_id = $1 and code = 'ABSENCE'`, [f.bizA]);
});

describe("pay runs", () => {
  it("only payroll users can create runs", async () => {
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.create_payroll_run($1, '2026-06-01', '2026-06-30', '2026-06-28')`, [f.bizA]))).rejects.toThrow(/permission/);
    run = (await asUser(db, f.users.payrollA, (tx) => one<{ id: string }>(tx, `select public.create_payroll_run($1, '2026-06-01', '2026-06-30', '2026-06-28') as id`, [f.bizA]))).id;
    await expect(asUser(db, f.users.payrollA, (tx) => tx.query(`select public.create_payroll_run($1, '2026-06-15', '2026-07-14', '2026-07-28')`, [f.bizA]))).rejects.toThrow(/already a pay run/);
  });

  it("works out salary, allowances, pension, tax and net pay", async () => {
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    // Manager: 25,000 basic + 2,000 housing = 27,000 gross. Pension 7% of 27,000 = 1,890.
    // Taxable after pension 25,110; tax 10% of 5,110 = 511.
    const m = await payslip(run, f.empA.M);
    expect(Number(m.gross_pay)).toBe(27000);
    expect(await line(run, f.empA.M, "PENSION")).toBe(1890);
    expect(await line(run, f.empA.M, "TAX")).toBe(511);
    expect(Number(m.net_pay)).toBe(27000 - 1890 - 511);
    expect(Number(m.employer_contributions)).toBe(1890);
    // Expatriate: no pension, and under the tax threshold.
    const s2 = await payslip(run, f.empA.S2);
    expect(Number(s2.net_pay)).toBe(11000);
    expect(await line(run, f.empA.S2, "PENSION")).toBe(0);
  });

  it("prorates a joiner and flags missing bank details", async () => {
    await db.query(`update public.employees set join_date = '2026-06-16' where id = $1`, [f.empA.S1]);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    // 15 of 30 days: half of 12,000.
    expect(await line(run, f.empA.S1, "BASIC")).toBe(6000);
    const s1 = await payslip(run, f.empA.S1);
    expect((s1.exceptions as { code: string }[]).map((x) => x.code)).toContain("no_bank");
    await db.query(`update public.employees set join_date = '2020-01-01' where id = $1`, [f.empA.S1]);
  });

  it("takes off unpaid leave by working days", async () => {
    const unpaid = (await q<{ id: string }>(`insert into public.leave_types (business_id, name, code, is_paid, accrual_method) values ($1, 'Unpaid leave', 'UL', false, 'none') returning id`, [f.bizA]))[0].id;
    // Sun 7 – Thu 11 June 2026: 5 working days off. June has 22 working days (Sun–Thu).
    await db.query(
      `insert into public.leave_requests (business_id, employee_id, leave_type_id, start_date, end_date, days, status) values ($1, $2, $3, '2026-06-07', '2026-06-11', 5, 'approved')`,
      [f.bizA, f.empA.S2, unpaid],
    );
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    expect(await line(run, f.empA.S2, "BASIC")).toBe(Math.round((11000 * (30 - (5 * 30) / 22)) / 30 * 100) / 100);
  });

  it("adds overtime, approved claims and loan repayments", async () => {
    // 2 hours overtime on a working day at 1.25x.
    await db.query(
      `insert into public.attendance_records (business_id, employee_id, work_date, clock_in_at, clock_out_at, source) values ($1, $2, '2026-06-08', '2026-06-08 03:00:00+00', '2026-06-08 13:00:00+00', 'manual')`,
      [f.bizA, f.empA.M],
    );
    const ot = await one<{ m: number }>(db, `select overtime_minutes as m from public.attendance_records where employee_id = $1 and work_date = '2026-06-08'`, [f.empA.M]);
    expect(ot.m).toBe(120);
    const type = (await q<{ id: string }>(`insert into public.claim_types (business_id, name, key, requires_receipt) values ($1, 'Taxi', 'custom', false) returning id`, [f.bizA]))[0].id;
    await db.query(
      `insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, status, payout_method, target_period_start) values ($1, $2, $3, '2026-06-05', 150, 'approved', 'payroll', '2026-06-01')`,
      [f.bizA, f.empA.M, type],
    );
    await db.query(`insert into public.loans (business_id, employee_id, principal, installment_amount, start_date, outstanding) values ($1, $2, 3000, 1000, '2026-06-01', 3000)`, [f.bizA, f.empA.M]);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    const ls = await lines(run, f.empA.M);
    expect(ls.some((l) => l.source === "overtime" && Number(l.amount) > 0)).toBe(true);
    expect(await line(run, f.empA.M, "CLAIM")).toBe(150);
    expect(await line(run, f.empA.M, "LOAN")).toBe(1000);
  });

  it("pays overtime only once it is approved, when the rules ask for approval", async () => {
    await db.query(
      `insert into public.attendance_policies (business_id, name, is_default, overtime_requires_approval)
       values ($1, 'Needs approval', true, true)
       on conflict (business_id) where is_default do update set overtime_requires_approval = true`,
      [f.bizA],
    );
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    expect((await lines(run, f.empA.M)).some((l) => l.source === "overtime")).toBe(false);
    const [rec] = await q<{ id: string }>(`select id from public.attendance_records where employee_id = $1 and work_date = '2026-06-08'`, [f.empA.M]);
    await asUser(db, f.users.ownerA, (tx) => tx.query(`select public.decide_overtime($1, $2, 'approved')`, [f.bizA, [rec.id]]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    expect((await lines(run, f.empA.M)).some((l) => l.source === "overtime" && Number(l.amount) > 0)).toBe(true);
    await db.query(`update public.attendance_policies set overtime_requires_approval = false where business_id = $1`, [f.bizA]);
  });

  it("keeps one-off adjustments when recalculating, and people on hold stay out of the totals", async () => {
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.add_payroll_adjustment($1, $2, 'Eid bonus', 'earning', 500, true, false, 'Eid gift for everyone')`, [run, f.empA.S2]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    expect(await line(run, f.empA.S2, "ADJ")).toBe(500);
    // A reason is needed, and the adjustment is kept in the history with it.
    await expect(asUser(db, f.users.payrollA, (tx) => tx.query(`select public.add_payroll_adjustment($1, $2, 'Bonus', 'earning', 5)`, [run, f.empA.S2]))).rejects.toThrow(/reason/);
    const log = await q<{ actor_id: string; changes: { reason: { to: string } } }>(`select actor_id, changes from public.audit_log where action = 'adjust' and subject_employee_id = $1`, [f.empA.S2]);
    expect(log[0]).toMatchObject({ actor_id: f.users.payrollA, changes: { reason: { to: "Eid gift for everyone" } } });
    const lineRow = (await q<{ explanation: string }>(`select explanation from public.payroll_run_lines where run_id = $1 and code = 'ADJ'`, [run]))[0];
    expect(lineRow.explanation).toBe("Added by hand: Eid gift for everyone");
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.set_payroll_person_status($1, $2, 'on_hold')`, [run, f.empA.S1]));
    const r = (await q<{ employee_count: number }>(`select employee_count from public.payroll_runs where id = $1`, [run]))[0];
    expect(r.employee_count).toBe(2);
  });

  it("staff can't see payslips before the run is finalized", async () => {
    const mine = await asUser(db, f.users.staffA2, async (tx) => (await tx.query(`select 1 from public.payroll_run_employees where employee_id = $1`, [f.empA.S2])).rows);
    expect(mine.length).toBe(0);
  });

  it("won't finalize with problems, then finalizes, locks and publishes payslips", async () => {
    await db.query(`update public.payroll_run_employees set exceptions = '[{"code":"x","severity":"error","message":"x"}]' where run_id = $1 and employee_id = $2`, [run, f.empA.M]);
    await expect(asUser(db, f.users.payrollA, (tx) => tx.query(`select public.approve_payroll_run($1)`, [run]))).rejects.toThrow(/problems/);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    // Finalizing needs approval first; approving locks changes until it's undone.
    await expect(asUser(db, f.users.payrollA, (tx) => tx.query(`select public.finalize_payroll_run($1)`, [run]))).rejects.toThrow(/Approve/);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.approve_payroll_run($1)`, [run]));
    await expect(asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]))).rejects.toThrow(/locked/);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.unapprove_payroll_run($1)`, [run]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.approve_payroll_run($1)`, [run]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.finalize_payroll_run($1)`, [run]));
    expect((await q<{ status: string }>(`select status from public.payroll_runs where id = $1`, [run]))[0].status).toBe("finalized");
    // Held person was removed from the run.
    expect(await payslip(run, f.empA.S1)).toBeUndefined();
    // Loan went down, claim is paid.
    expect(Number((await q<{ outstanding: string }>(`select outstanding from public.loans where employee_id = $1`, [f.empA.M]))[0].outstanding)).toBe(2000);
    expect((await q<{ status: string }>(`select status from public.claims where employee_id = $1`, [f.empA.M]))[0].status).toBe("paid");
    // Staff see their own payslip now, not anyone else's.
    const mine = await asUser(db, f.users.staffA2, async (tx) => (await tx.query<{ employee_id: string }>(`select employee_id from public.payroll_run_employees where run_id = $1`, [run])).rows);
    expect(mine.map((x) => x.employee_id)).toEqual([f.empA.S2]);
    // Locked.
    await expect(asUser(db, f.users.payrollA, (tx) => tx.query(`select public.calculate_payroll_run($1)`, [run]))).rejects.toThrow(/locked/);
    await expect(db.query(`update public.payroll_run_lines set amount = 1 where run_id = $1`, [run])).rejects.toThrow(/locked/);
  });

  it("reversing gives loans and claims back", async () => {
    // Only the owner can reverse, and must say why.
    await expect(asUser(db, f.users.payrollA, (tx) => tx.query(`select public.reverse_payroll_run($1, 'Wrong allowance')`, [run]))).rejects.toThrow(/Only the owner/);
    await expect(asUser(db, f.users.ownerA, (tx) => tx.query(`select public.reverse_payroll_run($1, '')`, [run]))).rejects.toThrow(/reason/);
    await asUser(db, f.users.ownerA, (tx) => tx.query(`select public.reverse_payroll_run($1, 'Wrong allowance')`, [run]));
    expect(Number((await q<{ outstanding: string }>(`select outstanding from public.loans where employee_id = $1`, [f.empA.M]))[0].outstanding)).toBe(3000);
    const c = (await q<{ status: string; payroll_run_id: string | null }>(`select status, payroll_run_id from public.claims where employee_id = $1`, [f.empA.M]))[0];
    expect(c.status).toBe("approved");
    expect(c.payroll_run_id).toBeNull();
  });
});

describe("claims", () => {
  let taxi: string;
  beforeAll(async () => {
    taxi = (await q<{ id: string }>(`insert into public.claim_types (business_id, name, key, requires_receipt, max_amount, cutoff_day) values ($1, 'Transport', 'transport', true, 500, 28) returning id`, [f.bizA]))[0].id;
    await db.query(`insert into public.business_modules (business_id, module_key, enabled) values ($1, 'claims', true) on conflict (business_id, module_key) do update set enabled = true`, [f.bizA]);
  });

  it("checks amount limits and receipts, then sends it for approval", async () => {
    const today = (await q<{ d: string }>(`select (now() at time zone 'Indian/Maldives')::date::text as d`))[0].d;
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.submit_claim($1, $2, $3, 600, 'Taxi')`, [f.bizA, taxi, today]))).rejects.toThrow(/up to/);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.submit_claim($1, $2, $3, 100, 'Taxi')`, [f.bizA, taxi, today]))).rejects.toThrow(/receipt/);
    const id = await asUser(db, f.users.staffA, (tx) =>
      one<{ id: string }>(tx, `select public.submit_claim($1, $2, $3, 100, 'Taxi', 'Airport to office', $4) as id`, [f.bizA, taxi, today, `${f.bizA}/claims/${f.empA.S1}/r.jpg`]),
    );
    const req = (await q<{ id: string; amount: string }>(`select id, amount from public.approval_requests where source_id = $1`, [id.id]))[0];
    expect(Number(req.amount)).toBe(100);
    await asUser(db, f.users.managerA, (tx) => tx.query(`select public.decide_request($1, 'approve')`, [req.id]));
    expect((await q<{ status: string }>(`select status from public.claims where id = $1`, [id.id]))[0].status).toBe("approved");
  });

  it("staff can't mark claims paid; payroll or claims editors can for separate payouts", async () => {
    const c = (await q<{ id: string }>(
      `insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, status, payout_method) values ($1, $2, $3, '2026-06-05', 80, 'approved', 'separate') returning id`,
      [f.bizA, f.empA.S1, taxi],
    ))[0];
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.mark_claims_paid($1, $2, 'cash')`, [f.bizA, [c.id]]))).rejects.toThrow(/permission/);
    const n = await asUser(db, f.users.payrollA, (tx) => one<{ n: number }>(tx, `select public.mark_claims_paid($1, $2, 'Bank transfer 123') as n`, [f.bizA, [c.id]]));
    expect(n.n).toBe(1);
  });
});
