/**
 * Time & shifts and Time off: clock in/out, late and overtime maths,
 * breaks, time fixes through approvals, timesheets, and time off
 * requests with balances that stay right.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
let shift: string;
let annual: string;
let sick: string;

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  await db.query(`update public.businesses set timezone = 'Indian/Maldives', working_days = '{0,1,2,3,4}' where id = $1`, [f.bizA]);
  await db.query(`update public.employees set join_date = '2020-01-01' where business_id = $1`, [f.bizA]);
  shift = (await q<{ id: string }>(`insert into public.shifts (business_id, name, start_time, end_time, break_minutes) values ($1, 'Day', '09:00', '17:00', 60) returning id`, [f.bizA]))[0].id;
  annual = (await q<{ id: string }>(
    `insert into public.leave_types (business_id, name, code, entitlement_days, accrual_method, carry_forward_max) values ($1, 'Annual leave', 'AL', 30, 'upfront', 10) returning id`,
    [f.bizA],
  ))[0].id;
  sick = (await q<{ id: string }>(
    `insert into public.leave_types (business_id, name, code, entitlement_days, document_rule, document_over_days, allow_half_day, allow_after_the_fact) values ($1, 'Sick leave', 'SK', 15, 'over_days', 2, true, true) returning id`,
    [f.bizA],
  ))[0].id;
});

describe("the day's numbers", () => {
  it("works out late, worked and overtime minutes from clock times", async () => {
    // Monday 5 Jan 2026, shift 09:00–17:00 Maldives time (UTC+5). In at 09:30, out at 19:00.
    const r = (await q<{ id: string }>(
      `insert into public.attendance_records (business_id, employee_id, work_date, shift_id, clock_in_at, clock_out_at, source)
       values ($1, $2, '2026-01-05', $3, '2026-01-05 04:30:00+00', '2026-01-05 14:00:00+00', 'manual') returning id`,
      [f.bizA, f.empA.S2, shift],
    ))[0];
    const row = (await q<{ late_minutes: number; worked_minutes: number; overtime_minutes: number; status: string }>(
      `select late_minutes, worked_minutes, overtime_minutes, status from public.attendance_records where id = $1`, [r.id]))[0];
    expect(row.late_minutes).toBe(30);
    // No break was recorded, so the shift's 1 hour break is taken off: 570 - 60.
    expect(row.worked_minutes).toBe(510);
    expect(row.overtime_minutes).toBe(510 - 420);
    expect(row.status).toBe("late");
  });

  it("marks a short day as a half day", async () => {
    const r = (await q<{ id: string }>(
      `insert into public.attendance_records (business_id, employee_id, work_date, shift_id, clock_in_at, clock_out_at, source)
       values ($1, $2, '2026-01-06', $3, '2026-01-06 04:00:00+00', '2026-01-06 06:00:00+00', 'manual') returning id`,
      [f.bizA, f.empA.S2, shift],
    ))[0];
    expect((await q<{ status: string }>(`select status from public.attendance_records where id = $1`, [r.id]))[0].status).toBe("half_day");
  });
});

describe("clocking in and out", () => {
  it("clocks in, takes a break, and clocks out", async () => {
    const inn = await asUser(db, f.users.staffA, (tx) => one<{ r: { id: string } }>(tx, `select public.clock_in($1) as r`, [f.bizA]));
    expect(inn.r.id).toBeTruthy();
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.clock_in($1)`, [f.bizA]))).rejects.toThrow(/already clocked in/);
    expect((await asUser(db, f.users.staffA, (tx) => one<{ r: string }>(tx, `select public.toggle_break($1) as r`, [f.bizA]))).r).toBe("started");
    expect((await asUser(db, f.users.staffA, (tx) => one<{ r: string }>(tx, `select public.toggle_break($1) as r`, [f.bizA]))).r).toBe("ended");
    const out = await asUser(db, f.users.staffA, (tx) => one<{ r: { id: string } }>(tx, `select public.clock_out($1) as r`, [f.bizA]));
    expect(out.r.id).toBe(inn.r.id);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.clock_out($1)`, [f.bizA]))).rejects.toThrow(/not clocked in/);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.clock_in($1)`, [f.bizA]))).rejects.toThrow(/already clocked in and out/);
  });

  it("flags or blocks clock-ins outside the location fence", async () => {
    const branch = (await q<{ branch_id: string }>(`select branch_id from public.employees where id = $1`, [f.empA.S2]))[0].branch_id;
    await db.query(`update public.branches set latitude = 4.1755, longitude = 73.5093, geofence_radius_m = 100, geofence_mode = 'block' where id = $1`, [branch]);
    await db.query(`delete from public.attendance_records where employee_id = $1 and work_date = (now() at time zone 'Indian/Maldives')::date`, [f.empA.S2]);
    // Staff A2 is S2; 5 km away is refused.
    await expect(asUser(db, f.users.staffA2, (tx) => tx.query(`select public.clock_in($1, 4.22, 73.51, 10)`, [f.bizA]))).rejects.toThrow(/need to be at/);
    await db.query(`update public.branches set geofence_mode = 'flag' where id = $1`, [branch]);
    const r = await asUser(db, f.users.staffA2, (tx) => one<{ r: { flagged: boolean } }>(tx, `select public.clock_in($1, 4.22, 73.51, 10) as r`, [f.bizA]));
    expect(r.r.flagged).toBe(true);
    await asUser(db, f.users.staffA2, (tx) => tx.query(`select public.clock_out($1, 4.1755, 73.5093, 10)`, [f.bizA]));
  });

  it("refuses logins without a staff profile", async () => {
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.clock_in($1)`, [f.bizA]))).rejects.toThrow(/isn't linked/);
  });
});

describe("fixing a clock time", () => {
  it("goes to the manager, and approving it fixes the day", async () => {
    const id = await asUser(db, f.users.staffA, (tx) =>
      one<{ id: string }>(tx, `select public.request_time_fix($1, (now() at time zone 'Indian/Maldives')::date - 3, now() - interval '3 days 8 hours', now() - interval '3 days', 'Forgot to clock in') as id`, [f.bizA]),
    );
    const req = (await q<{ id: string }>(`select id from public.approval_requests where source_id = $1`, [id.id]))[0];
    await asUser(db, f.users.managerA, (tx) => tx.query(`select public.decide_request($1, 'approve')`, [req.id]));
    const rec = (await q<{ worked_minutes: number; source: string }>(
      `select a.worked_minutes, a.source from public.attendance_corrections c join public.attendance_records a on a.id = c.record_id where c.id = $1`,
      [id.id],
    ))[0];
    expect(rec.source).toBe("correction");
    expect(rec.worked_minutes).toBe(480);
  });

  it("checks the times make sense", async () => {
    await expect(
      asUser(db, f.users.staffA, (tx) => tx.query(`select public.request_time_fix($1, (now() at time zone 'Indian/Maldives')::date - 1, now(), now() - interval '1 hour', 'x')`, [f.bizA])),
    ).rejects.toThrow(/after the start/);
  });
});

describe("timesheets", () => {
  it("adds up a period for everyone, and only office users can do it", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.build_timesheets($1, '2026-01-01', '2026-01-31')`, [f.bizA]))).rejects.toThrow(/permission/);
    await asUser(db, f.users.hrA, (tx) => tx.query(`select public.build_timesheets($1, '2026-01-01', '2026-01-31')`, [f.bizA]));
    const t = (await q<{ days_present: string; overtime_minutes: number }>(
      `select days_present, overtime_minutes from public.timesheets where employee_id = $1 and period_start = '2026-01-01'`, [f.empA.S2]))[0];
    expect(Number(t.days_present)).toBe(1.5);
    expect(t.overtime_minutes).toBe(90);
  });
});

describe("time off", () => {
  const balance = async (emp: string, type: string, year = 2026) =>
    (await q<{ balance: string; pending: string; taken: string }>(`select balance, pending, taken from public.leave_balances where employee_id = $1 and leave_type_id = $2 and period_year = $3`, [emp, type, year]))[0];

  it("counts only working days, skipping rest days and public holidays", async () => {
    await db.query(`insert into public.public_holidays (business_id, name, holiday_date) values ($1, 'Test holiday', '2026-12-08')`, [f.bizA]);
    // Sun 6 Dec – Sat 12 Dec 2026: Sun–Thu are working days, minus the Tuesday holiday = 4.
    const d = await one<{ d: string }>(db, `select private.leave_days($1, $2, '2026-12-06', '2026-12-12', 'full', 'full') as d`, [f.bizA, annual]);
    expect(Number(d.d)).toBe(4);
    const half = await one<{ d: string }>(db, `select private.leave_days($1, $2, '2026-12-06', '2026-12-07', 'second_half', 'full') as d`, [f.bizA, annual]);
    expect(Number(half.d)).toBe(1.5);
  });

  it("asks, holds the days as pending, and approving moves them to taken", async () => {
    const id = await asUser(db, f.users.staffA, (tx) => one<{ id: string }>(tx, `select public.request_leave($1, $2, '2026-12-13', '2026-12-17') as id`, [f.bizA, annual]));
    let b = await balance(f.empA.S1, annual);
    expect(Number(b.pending)).toBe(5);
    expect(Number(b.balance)).toBe(30);
    const req = (await q<{ id: string }>(`select id from public.approval_requests where source_id = $1`, [id.id]))[0];
    await asUser(db, f.users.managerA, (tx) => tx.query(`select public.decide_request($1, 'approve')`, [req.id]));
    b = await balance(f.empA.S1, annual);
    expect(Number(b.pending)).toBe(0);
    expect(Number(b.taken)).toBe(5);
    expect(Number(b.balance)).toBe(25);
  });

  it("gives the days back when declined, cancelled or cancelled after approval", async () => {
    const id = await asUser(db, f.users.staffA, (tx) => one<{ id: string }>(tx, `select public.request_leave($1, $2, '2026-11-01', '2026-11-02') as id`, [f.bizA, annual]));
    const req = (await q<{ id: string }>(`select id from public.approval_requests where source_id = $1`, [id.id]))[0];
    await asUser(db, f.users.managerA, (tx) => tx.query(`select public.decide_request($1, 'reject', 'Busy week')`, [req.id]));
    expect(Number((await balance(f.empA.S1, annual)).pending)).toBe(0);

    const id2 = await asUser(db, f.users.staffA, (tx) => one<{ id: string }>(tx, `select public.request_leave($1, $2, '2026-11-03', '2026-11-03') as id`, [f.bizA, annual]));
    const req2 = (await q<{ id: string }>(`select id from public.approval_requests where source_id = $1`, [id2.id]))[0];
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.cancel_request($1)`, [req2.id]));
    expect(Number((await balance(f.empA.S1, annual)).pending)).toBe(0);

    const hrEntered = await asUser(db, f.users.hrA, (tx) => one<{ id: string }>(tx, `select public.record_leave($1, $2, $3, '2026-10-04', '2026-10-05') as id`, [f.bizA, f.empA.S1, annual]));
    expect(Number((await balance(f.empA.S1, annual)).taken)).toBe(7);
    await asUser(db, f.users.hrA, (tx) => tx.query(`select public.cancel_approved_leave($1, 'Came back early')`, [hrEntered.id]));
    expect(Number((await balance(f.empA.S1, annual)).taken)).toBe(5);
  });

  it("stops overlapping requests, too many days, and missing documents", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.request_leave($1, $2, '2026-12-15', '2026-12-15')`, [f.bizA, annual]))).rejects.toThrow(/already have time off/);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.request_leave($1, $2, '2026-10-11', '2026-11-30')`, [f.bizA, annual]))).rejects.toThrow(/Not enough/);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.request_leave($1, $2, '2026-09-06', '2026-09-09')`, [f.bizA, sick]))).rejects.toThrow(/Add a document/);
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.request_leave($1, $2, '2026-09-06', '2026-09-06')`, [f.bizA, sick]));
  });

  it("adjustments change the balance, and a new year starts again with the full days (nothing carried over)", async () => {
    await asUser(db, f.users.hrA, (tx) =>
      tx.query(`insert into public.leave_adjustments (business_id, employee_id, leave_type_id, period_year, days, reason) values ($1, $2, $3, 2026, 2, 'Worked a holiday')`, [f.bizA, f.empA.S1, annual]),
    );
    expect(Number((await balance(f.empA.S1, annual)).balance)).toBe(27);
    await asUser(db, f.users.hrA, (tx) => tx.query(`select public.start_leave_year($1, 2027)`, [f.bizA]));
    const next = (await q<{ carried_forward: string; balance: string }>(
      `select carried_forward, balance from public.leave_balances where employee_id = $1 and leave_type_id = $2 and period_year = 2027`, [f.empA.S1, annual]))[0];
    expect(Number(next.carried_forward)).toBe(0);
    expect(Number(next.balance)).toBe(30);
  });

  it("staff only see their own balances, and can't approve their own time off", async () => {
    const mine = await asUser(db, f.users.staffA, async (tx) => (await tx.query<{ name: string }>(`select * from public.my_leave_balances($1, 2026)`, [f.bizA])).rows);
    expect(mine.map((r) => r.name)).toContain("Annual leave");
    const others = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select 1 from public.leave_balances where employee_id = $1`, [f.empA.S2])).rows);
    expect(others.length).toBe(0);
    await expect(
      asUser(db, f.users.staffA, (tx) => tx.query(`insert into public.leave_requests (business_id, employee_id, leave_type_id, start_date, end_date, days, status) values ($1, $2, $3, '2026-08-02', '2026-08-02', 1, 'approved')`, [f.bizA, f.empA.S1, annual])),
    ).rejects.toThrow();
  });
});
