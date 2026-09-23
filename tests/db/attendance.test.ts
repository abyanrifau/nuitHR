/**
 * The attendance engine: one status per person per day, overtime rules and
 * approval, the stored monthly summary, locking once payroll is finalized,
 * importing a clock machine's file, and who may see what.
 *
 * February 2026, for Ali (S2, kitchen). He works 6 days a week with Friday
 * off, on a 09:00–17:00 shift with a 1 hour break (7 hours). Maldives is
 * UTC+5, so 09:00 there is 04:00 UTC.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

/** Maldives local "HH:MM" on a February 2026 day, as UTC. */
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 1, day, h - 5, m)).toISOString();
};
const clock = (day: number, inn: string, out: string | null) =>
  q(
    `insert into public.attendance_records (business_id, employee_id, work_date, clock_in_at, clock_out_at, source)
     values ($1, $2, $3, $4, $5, 'manual')`,
    [f.bizA, f.empA.S2, `2026-02-${String(day).padStart(2, "0")}`, at(day, inn), out ? at(day, out) : null],
  );
type Day = { day: string; status: string | null; late_minutes: number; overtime_minutes: number; overtime_type: string | null; overtime_state: string | null; record_id: string | null };
const days = async () =>
  new Map((await q<Day>(`select day::text, status, late_minutes, overtime_minutes, overtime_type, overtime_state, record_id from private.attendance_days($1, '2026-02-01', '2026-02-28', $2)`, [f.bizA, f.empA.S2])).map((d) => [d.day.slice(8), d]));
type Month = Record<string, number | string | null>;
const month = async () => {
  await q(`select private.compute_attendance_month($1, '2026-02-01', $2)`, [f.bizA, f.empA.S2]);
  return (await q<Month>(`select * from public.attendance_months where employee_id = $1 and month = '2026-02-01'`, [f.empA.S2]))[0];
};

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  const [shift] = await q<{ id: string }>(
    `insert into public.shifts (business_id, name, start_time, end_time, break_minutes) values ($1, 'Day', '09:00', '17:00', 60) returning id`,
    [f.bizA],
  );
  const [sched] = await q<{ id: string }>(
    `insert into public.work_schedules (business_id, name, working_days, shift_id) values ($1, 'Six days, Friday off', '{0,1,2,3,4,6}', $2) returning id`,
    [f.bizA, shift.id],
  );
  await q(`update public.employees set work_schedule_id = $2 where id = $1`, [f.empA.S2, sched.id]);
  await q(
    `insert into public.attendance_policies (business_id, name, is_default, grace_minutes, early_leave_minutes, half_day_min_hours,
       overtime_after_minutes, overtime_rounding, overtime_round_to, overtime_monthly_cap_hours, overtime_requires_approval)
     values ($1, 'Standard', true, 10, 10, 4, 30, 'nearest', 15, 5, true)`,
    [f.bizA],
  );
  await q(`insert into public.public_holidays (business_id, holiday_date, name) values ($1, '2026-02-10', 'Test holiday')`, [f.bizA]);
  const [lt] = await q<{ id: string }>(
    `insert into public.leave_types (business_id, name, code, entitlement_days, accrual_method) values ($1, 'Annual leave', 'AL', 30, 'upfront') returning id`,
    [f.bizA],
  );
  await q(
    `insert into public.leave_requests (business_id, employee_id, leave_type_id, start_date, end_date, days, status) values ($1, $2, $3, '2026-02-11', '2026-02-11', 1, 'approved')`,
    [f.bizA, f.empA.S2, lt.id],
  );

  await clock(1, "09:00", "17:00"); // present (the 1 hour break is taken off: 7 hours worked)
  await clock(2, "09:25", "17:00"); // late by 25 minutes
  await clock(3, "09:00", "12:00"); // half day (3 hours)
  await clock(4, "09:00", "15:00"); // left 2 hours early
  // 5 (Thu) absent, 6 (Fri) rest day, 7 and 8 absent: a run of 3 (the rest day doesn't break it)
  await clock(9, "09:00", "19:08"); // 548 minutes worked after the break, 128 over the 7-hour shift, rounds to 135
  await clock(10, "09:00", "13:00"); // public holiday worked: 240 minutes of holiday overtime
  // 11 on approved time off, 12 absent
  await clock(13, "10:00", "12:10"); // Friday rest day worked: 130 minutes, rounds to 135
  for (let d = 14; d <= 28; d++) if (new Date(Date.UTC(2026, 1, d)).getUTCDay() !== 5) await clock(d, "09:00", "17:00");
});

describe("each day gets one status", () => {
  it("present, late, half day, early leave, absent, rest day, holiday and on leave", async () => {
    const d = await days();
    expect(d.get("01")!.status).toBe("present");
    expect(d.get("02")!.status).toBe("late");
    expect(d.get("02")!.late_minutes).toBe(25);
    expect(d.get("03")!.status).toBe("half_day");
    expect(d.get("04")!.status).toBe("early_leave");
    expect(d.get("05")!.status).toBe("absent");
    expect(d.get("06")!.status).toBe("rest_day");
    expect(d.get("10")!.status).toBe("holiday");
    expect(d.get("11")!.status).toBe("on_leave");
    expect(d.get("13")!.status).toBe("rest_day");
  });

  it("never counts rest days or public holidays as absences", async () => {
    const d = await days();
    for (const k of ["06", "20", "27", "10"]) expect(d.get(k)!.status).not.toBe("absent");
  });

  it("works out overtime by kind of day, with the minimum and rounding", async () => {
    const d = await days();
    expect(d.get("09")!).toMatchObject({ overtime_minutes: 135, overtime_type: "normal", overtime_state: "pending" });
    expect(d.get("10")!).toMatchObject({ overtime_minutes: 240, overtime_type: "holiday" });
    expect(d.get("13")!).toMatchObject({ overtime_minutes: 135, overtime_type: "rest_day" });
    expect(d.get("01")!.overtime_minutes).toBe(0);
  });
});

describe("the monthly summary", () => {
  it("counts every kind of day and keeps unapproved overtime aside", async () => {
    const m = await month();
    expect(m).toMatchObject({
      days_in_month: 28,
      working_days: 23,
      days_present: 17,
      half_days: 1,
      unapproved_absences: 4,
      approved_absences: 1,
      late_count: 1,
      late_minutes: 25,
      early_leaves: 1,
      longest_absence_run: 3,
      rest_days: 4,
      holidays: 1,
      overtime_normal_minutes: 0,
      overtime_pending_minutes: 135 + 240 + 135,
    });
  });

  it("counts approved overtime up to the monthly cap, in date order", async () => {
    const ids = [...(await days()).values()].filter((x) => x.overtime_minutes > 0).map((x) => x.record_id);
    // Only managers of the person, or people with company-wide rights, decide overtime.
    await expect(asUser(db, f.users.managerA, (tx) => tx.query(`select public.decide_overtime($1, $2, 'approved')`, [f.bizA, ids]))).rejects.toThrow(/people you manage/);
    await asUser(db, f.users.ownerA, (tx) => tx.query(`select public.decide_overtime($1, $2, 'approved')`, [f.bizA, ids]));
    // Cap 5 hours: 135 normal, then 165 of the 240 holiday minutes; the rest-day minutes are over the cap.
    expect(await month()).toMatchObject({
      overtime_normal_minutes: 135,
      overtime_holiday_minutes: 165,
      overtime_rest_day_minutes: 0,
      overtime_over_cap_minutes: 75 + 135,
      overtime_pending_minutes: 0,
    });
  });
});

describe("importing a clock machine file", () => {
  it("lists problems without saving, then imports the good rows", async () => {
    const rows = [
      { row: 2, code: "E002", date: "2026-03-02", in: "08:58", out: "17:05" },
      { row: 3, code: "NOPE", date: "2026-03-02", in: "09:00", out: "17:00" },
      { row: 4, code: "E002", date: "2026-03-02", in: "09:00", out: "17:00" },
      { row: 5, code: "E002", date: "2099-01-01", in: "09:00", out: "17:00" },
      { row: 6, code: "E002", date: "2026-03-03", in: "nine", out: "17:00" },
      { row: 7, code: "E002", date: "2026-03-04", in: "22:00", out: "06:00" },
    ];
    const dry = await asUser(db, f.users.hrA, (tx) => one<{ r: { valid: number; errors: { row: number; message: string }[]; imported: number } }>(tx, `select public.import_attendance($1, $2, true) as r`, [f.bizA, JSON.stringify(rows)]));
    expect(dry.r.valid).toBe(2);
    expect(dry.r.imported).toBe(0);
    expect(dry.r.errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
    expect(await q(`select 1 from public.attendance_records where employee_id = $1 and work_date >= '2026-03-01'`, [f.empA.S1])).toHaveLength(0);

    const good = rows.filter((r) => [2, 7].includes(r.row));
    await asUser(db, f.users.hrA, (tx) => tx.query(`select public.import_attendance($1, $2, false)`, [f.bizA, JSON.stringify(good)]));
    const saved = await q<{ work_date: string; worked_minutes: number; source: string }>(
      `select work_date::text, worked_minutes, source from public.attendance_records where employee_id = $1 and work_date >= '2026-03-01' order by work_date`,
      [f.empA.S1],
    );
    expect(saved.map((s) => s.source)).toEqual(["import", "import"]);
    expect(saved[1].worked_minutes).toBe(8 * 60); // a night shift ending the next morning
  });

  it("is refused to staff", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.import_attendance($1, '[]'::jsonb, true)`, [f.bizA]))).rejects.toThrow(/permission/);
  });
});

describe("who sees which days", () => {
  it("staff see only their own days", async () => {
    const seen = await asUser(db, f.users.staffA, (tx) =>
      tx.query<{ employee_id: string }>(`select distinct employee_id from public.attendance_days($1, '2026-02-01', '2026-02-28')`, [f.bizA]),
    );
    expect(seen.rows.map((r) => r.employee_id)).toEqual([f.empA.S1]);
  });
});

describe("locking", () => {
  it("locks a month's attendance once its payroll is finalized, and unlocks it if reversed", async () => {
    const [run] = await q<{ id: string }>(
      `insert into public.payroll_runs (business_id, name, period_start, period_end, pay_date) values ($1, 'February', '2026-02-01', '2026-02-28', '2026-02-28') returning id`,
      [f.bizA],
    );
    await q(`update public.payroll_runs set status = 'finalized' where id = $1`, [run.id]);
    await expect(q(`update public.attendance_records set clock_out_at = clock_out_at + interval '1 hour' where employee_id = $1 and work_date = '2026-02-01'`, [f.empA.S2])).rejects.toThrow(/locked/);
    await expect(clock(12, "09:00", "17:00")).rejects.toThrow(/locked/);
    const [m] = await q<{ locked_at: string | null }>(`select locked_at from public.attendance_months where employee_id = $1 and month = '2026-02-01'`, [f.empA.S2]);
    expect(m.locked_at).not.toBeNull();

    await q(`update public.payroll_runs set status = 'reversed', reversal_reason = 'Test' where id = $1`, [run.id]);
    await expect(clock(12, "09:00", "17:00")).resolves.toBeTruthy();
    const [after] = await q<{ locked_at: string | null }>(`select locked_at from public.attendance_months where employee_id = $1 and month = '2026-02-01'`, [f.empA.S2]);
    expect(after.locked_at).toBeNull();
  });
});
