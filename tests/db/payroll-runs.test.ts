/**
 * Pay runs by pay schedule, ad-hoc bonus runs, and the things payroll
 * asks you to check: no time records, requests still waiting and big
 * changes from last time.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
let semi: string;

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const asPayroll = <T>(sql: string, params: unknown[]) => asUser(db, f.users.payrollA, (tx) => one<T>(tx, sql, params));
const people = async (run: string) =>
  (await q<{ employee_id: string }>(`select employee_id from public.payroll_run_employees where run_id = $1 order by employee_name`, [run])).map((r) => r.employee_id).sort();
const codes = async (run: string, emp: string) =>
  ((await q<{ exceptions: { code: string; message: string }[] }>(`select exceptions from public.payroll_run_employees where run_id = $1 and employee_id = $2`, [run, emp]))[0]?.exceptions ?? []);
const create = (start: string, end: string, extra: { schedule?: string; type?: string } = {}) =>
  asPayroll<{ id: string }>(`select public.create_payroll_run($1, $2, $3, $4, null, $5, $6) as id`, [f.bizA, start, end, end, extra.schedule ?? null, extra.type ?? "regular"]).then((r) => r.id);
const calc = (run: string) => asPayroll(`select public.calculate_payroll_run($1) as r`, [run]);

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  await db.query(`update public.businesses set working_days = '{0,1,2,3,4}' where id = $1`, [f.bizA]);
  await db.query(`update public.employees set join_date = '2020-01-01' where business_id = $1`, [f.bizA]);
  await db.query(`insert into public.pay_schedules (business_id, name, frequency, is_default) values ($1, 'Monthly', 'monthly', true)`, [f.bizA]);
  semi = (await q<{ id: string }>(`insert into public.pay_schedules (business_id, name, frequency) values ($1, 'Twice a month', 'semi_monthly') returning id`, [f.bizA]))[0].id;
  await db.query(`update public.employees set pay_schedule_id = $2 where id = $1`, [f.empA.S2, semi]);
});

describe("pay schedules", () => {
  it("a monthly run only has the people on the monthly (default) schedule", async () => {
    const run = await create("2026-06-01", "2026-06-30");
    await calc(run);
    expect(await people(run)).toEqual([f.empA.M, f.empA.S1].sort());
  });

  it("a semi-monthly run has its own people, with half the monthly salary", async () => {
    const run = await create("2026-06-01", "2026-06-15", { schedule: semi });
    await calc(run);
    expect(await people(run)).toEqual([f.empA.S2]);
    const basic = (await q<{ amount: string; explanation: string }>(`select amount, explanation from public.payroll_run_lines where run_id = $1 and code = 'BASIC'`, [run]))[0];
    // 11,000 a month × 0.5.
    expect(basic.amount).toBe("5500.00");
    expect(basic.explanation).toBe("MVR 11,000.00 a month × 0.5 for this pay period");
    // Two semi-monthly runs for the same dates aren't allowed, but a monthly one on another schedule is.
    await expect(create("2026-06-10", "2026-06-20", { schedule: semi })).rejects.toThrow(/already a pay run/);
  });
});

describe("ad-hoc runs", () => {
  it("pay only what's added by hand, then leave everyone else off", async () => {
    const run = await create("2026-06-01", "2026-06-30", { type: "adhoc" });
    await calc(run);
    // No salaries or allowances on an ad-hoc run.
    expect((await q(`select 1 from public.payroll_run_lines where run_id = $1`, [run])).length).toBe(0);
    await asUser(db, f.users.payrollA, (tx) =>
      tx.query(`select public.add_payroll_adjustment($1, $2, 'Performance bonus', 'earning', 1000, true, false, 'Best month on record')`, [run, f.empA.S1]),
    );
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.approve_payroll_run($1)`, [run]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.finalize_payroll_run($1)`, [run]));
    expect(await people(run)).toEqual([f.empA.S1]);
    // Emailing payslips is recorded on a finalized run, but nothing else can change.
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.mark_payslips_emailed($1, $2)`, [run, [f.empA.S1]]));
    expect((await q<{ payslip_emailed_at: string | null }>(`select payslip_emailed_at from public.payroll_run_employees where run_id = $1`, [run]))[0].payslip_emailed_at).not.toBeNull();
    await expect(db.query(`update public.payroll_runs set total_gross = 1 where id = $1`, [run])).rejects.toThrow(/locked/);
    const r = (await q<{ employee_count: number; total_gross: string; name: string }>(`select employee_count, total_gross, name from public.payroll_runs where id = $1`, [run]))[0];
    expect(r).toMatchObject({ employee_count: 1, total_gross: "1000.00", name: "Bonus June 2026" });
  });
});

describe("things to check", () => {
  let june: string;

  it("flags no time records and requests still waiting", async () => {
    june = (await q<{ id: string }>(`select id from public.payroll_runs where business_id = $1 and run_type = 'regular' and pay_schedule_id <> $2`, [f.bizA, semi]))[0].id;
    await db.query(
      `insert into public.approval_requests (business_id, request_type, module_key, source_table, source_id, employee_id, title) values ($1, 'claim', 'claims', 'claims', gen_random_uuid(), $2, 'Taxi')`,
      [f.bizA, f.empA.S1],
    );
    await calc(june);
    const s1 = await codes(june, f.empA.S1);
    expect(s1.map((x) => x.code)).toEqual(expect.arrayContaining(["no_attendance", "pending_requests"]));
    expect(s1.find((x) => x.code === "no_attendance")!.message).toBe("No time records this period, so 22 working days count as unapproved absences");
    expect(s1.find((x) => x.code === "pending_requests")!.message).toBe("1 request is still waiting for a decision");
  });

  it("flags a big change from the last regular pay", async () => {
    // June is paid with the absence deduction switched off, so nobody has zero pay.
    await db.query(`update public.pay_components set is_active = false where business_id = $1 and code = 'ABSENCE'`, [f.bizA]);
    await calc(june);
    await db.query(`insert into public.employee_bank_accounts (business_id, employee_id, bank_name, account_name, account_number, is_primary) select business_id, id, 'BML', first_name, '77' || employee_code, true from public.employees where business_id = $1`, [f.bizA]);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.approve_payroll_run($1)`, [june]));
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.finalize_payroll_run($1)`, [june]));
    const july = await create("2026-07-01", "2026-07-31");
    await calc(july);
    await asUser(db, f.users.payrollA, (tx) => tx.query(`select public.add_payroll_adjustment($1, $2, 'Back pay', 'earning', 6000, true, false, 'Missed raise')`, [july, f.empA.S1]));
    const s1 = await codes(july, f.empA.S1);
    expect(s1.find((x) => x.code === "big_change")?.message).toMatch(/^Net pay is \d+% higher than last time \(MVR [\d,.]+ → MVR [\d,.]+\)$/);
    expect((await codes(july, f.empA.M)).some((x) => x.code === "big_change")).toBe(false);
  });
});
