/**
 * Time off rules: notice, length of service and probation, types for some
 * people only, birthday leave, leave granted by HR, blackouts, team limits,
 * consecutive days, leave years, and documents that never arrive turning
 * into unapproved absences.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser } from "./harness";
import { createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
let codes = 0;

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

/** A date n days from today in the Maldives, moved forward (or back) to a working day (Sun–Thu). */
function day(n: number, dir: 1 | -1 = 1) {
  let d = new Date(Date.now() + 5 * 3_600_000 + n * 86_400_000);
  while ([5, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + dir * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function leaveType(name: string, extra: Record<string, unknown> = {}) {
  const cols = { code: `T${++codes}`, entitlement_days: 30, ...extra };
  const keys = Object.keys(cols);
  const row = await q<{ id: string }>(
    `insert into public.leave_types (business_id, name, ${keys.join(", ")}) values ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(", ")}) returning id`,
    [f.bizA, name, ...Object.values(cols)],
  );
  return row[0].id;
}

const ask = (user: string, type: string, start: string, end = start, attachment: string | null = null) =>
  asUser(db, user, (tx) => one<{ id: string }>(tx, `select public.request_leave($1, $2, $3, $4, 'full', 'full', null, $5) as id`, [f.bizA, type, start, end, attachment]));

const myTypes = (user: string) =>
  asUser(db, user, async (tx) => (await one<{ t: { id: string; name: string; available: number | null } [] }>(tx, `select public.my_leave_types($1) as t`, [f.bizA])).t);

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  await db.query(`update public.businesses set timezone = 'Indian/Maldives', working_days = '{0,1,2,3,4}' where id = $1`, [f.bizA]);
});

describe("asking for time off", () => {
  it("blocks a request without enough notice, and explains when it had to be asked", async () => {
    const type = await leaveType("Notice leave", { notice_value: 7, notice_unit: "days" });
    await expect(ask(f.users.staffA, type, day(2))).rejects.toThrow(/Notice leave needs 7 days' notice/);
    // The preview says the same before anything is sent.
    const preview = await asUser(db, f.users.staffA, (tx) =>
      one<{ p: { ok: boolean; error: string } }>(tx, `select public.preview_my_leave($1, $2, $3, $3) as p`, [f.bizA, type, day(2)]));
    expect(preview.p.ok).toBe(false);
    expect(preview.p.error).toMatch(/notice/);
    await ask(f.users.staffA, type, day(10), day(12));
    // Past days need the type to allow requests after the fact.
    await expect(ask(f.users.staffA, type, day(-3, -1))).rejects.toThrow(/has to be asked for before it starts/);
  });

  it("hides and blocks a type someone isn't eligible for yet", async () => {
    // Everyone joined on 1 Jan 2024.
    const type = await leaveType("Long service leave", { eligible_after_value: 5, eligible_after_unit: "years" });
    await expect(ask(f.users.staffA, type, day(20))).rejects.toThrow(/available after 5 years of service, from 01 Jan 2029/);
    expect((await myTypes(f.users.staffA)).map((t) => t.name)).not.toContain("Long service leave");

    const noProbation = await leaveType("Study leave", { allow_during_probation: false });
    await db.query(`update public.employees set probation_end_date = $2 where id = $1`, [f.empA.S1, day(60)]);
    await expect(ask(f.users.staffA, noProbation, day(20))).rejects.toThrow(/can't be taken during probation/);
    await db.query(`update public.employees set probation_end_date = null where id = $1`, [f.empA.S1]);
    await ask(f.users.staffA, noProbation, day(20));
  });

  it("keeps a type for some roles only out of everyone else's sight", async () => {
    const type = await leaveType("Managers' retreat", { applies_to: "selected" });
    await db.query(`insert into public.leave_type_targets (business_id, leave_type_id, target_type, target_id) values ($1, $2, 'role', $3)`, [
      f.bizA, type, f.roleA.manager,
    ]);
    expect((await myTypes(f.users.staffA)).map((t) => t.name)).not.toContain("Managers' retreat");
    await expect(ask(f.users.staffA, type, day(25))).rejects.toThrow(/isn't available to you/);
    expect((await myTypes(f.users.managerA)).map((t) => t.name)).toContain("Managers' retreat");
    await ask(f.users.managerA, type, day(25));
    // A position, department, branch or person works the same way.
    const kitchenOnly = await leaveType("Kitchen rest day", { applies_to: "selected" });
    await db.query(`insert into public.leave_type_targets (business_id, leave_type_id, target_type, target_id) values ($1, $2, 'department', $3)`, [
      f.bizA, kitchenOnly, f.deptA.kitchen,
    ]);
    expect((await myTypes(f.users.staffA2)).map((t) => t.name)).toContain("Kitchen rest day");
    expect((await myTypes(f.users.staffA)).map((t) => t.name)).not.toContain("Kitchen rest day");
  });

  it("gives birthday leave once, only in the birthday month", async () => {
    const type = await leaveType("Birthday leave", { entitlement_mode: "birthday", entitlement_days: 1, birthday_window: "month" });
    // S2 has no date of birth yet, so they don't get it.
    expect((await myTypes(f.users.staffA2)).map((t) => t.name)).not.toContain("Birthday leave");
    const target = day(40);
    await db.query(`update public.employees set date_of_birth = $2 where id = $1`, [f.empA.S1, `1990-${target.slice(5)}`]);
    const offered = (await myTypes(f.users.staffA)).find((t) => t.name === "Birthday leave");
    expect(offered?.available).toBe(1);
    // A working day in another month is refused (35 days on is always another month).
    await expect(ask(f.users.staffA, type, day(75))).rejects.toThrow(/Birthday leave can be taken between/);
    await ask(f.users.staffA, type, target);
    // It's one day, so none is left.
    expect((await myTypes(f.users.staffA)).find((t) => t.name === "Birthday leave")?.available).toBe(0);
  });

  it("lets HR grant a type to one person, with an expiry", async () => {
    const type = await leaveType("Compassionate leave", { entitlement_mode: "granted", entitlement_days: 0 });
    await expect(ask(f.users.staffA, type, day(30))).rejects.toThrow(/only for people HR has given it to/);
    await asUser(db, f.users.hrA, (tx) =>
      tx.query(`insert into public.leave_allocations (business_id, employee_id, leave_type_id, days, reason, starts_on, expires_on) values ($1, $2, $3, 2, 'Family bereavement', $4, $5)`, [
        f.bizA, f.empA.S1, type, day(0, -1), day(90),
      ]),
    );
    expect((await myTypes(f.users.staffA)).find((t) => t.name === "Compassionate leave")?.available).toBe(2);
    await ask(f.users.staffA, type, day(30));
    await expect(ask(f.users.staffA, type, day(33), day(35))).rejects.toThrow(/Not enough compassionate leave/);
    // Staff can't grant days to themselves.
    await expect(
      asUser(db, f.users.staffA, (tx) =>
        tx.query(`insert into public.leave_allocations (business_id, employee_id, leave_type_id, days, reason, starts_on) values ($1, $2, $3, 5, 'Me', $4)`, [f.bizA, f.empA.S1, type, day(0)]),
      ),
    ).rejects.toThrow();
  });

  it("blocks blackout dates, too many of a team off at once, and too many days in a row", async () => {
    const type = await leaveType("Holiday leave", { max_off_per_department: 1, max_consecutive_days: 5, min_days_per_request: 1 });
    await asUser(db, f.users.hrA, (tx) =>
      tx.query(`insert into public.company_events (business_id, title, kind, start_date, end_date) values ($1, 'Stock take', 'blackout', $2, $3)`, [f.bizA, day(50), day(52)]),
    );
    await expect(ask(f.users.staffA, type, day(50))).rejects.toThrow(/\(Stock take\)/);
    // The manager (same team) is off first, so S1 can't be.
    await ask(f.users.managerA, type, day(60));
    await expect(ask(f.users.staffA, type, day(60))).rejects.toThrow(/The most allowed at once is 1/);
    // Three working days, then another run straight after: 5 in a row is the limit.
    const start = day(70);
    const r1 = await one<{ s: string; e: string }>(db, `select $1::date as s, ($1::date + 2) as e`, [start]);
    await ask(f.users.staffA, type, r1.s, r1.e);
    const next = await one<{ s: string; e: string }>(db, `select ($1::date + 1) as s, ($1::date + 4) as e`, [r1.e]);
    await expect(ask(f.users.staffA, type, next.s, next.e)).rejects.toThrow(/up to 5 days in a row/);
  });

  it("files time off in each person's own leave year when the type follows join dates", async () => {
    const type = await leaveType("Anniversary leave", { year_basis: "anniversary", entitlement_days: 10 });
    const y = await one<{ year: number; starts: string; ends: string }>(db, `select year, starts::text, ends::text from private.leave_year($1, $2, '2026-12-15')`, [type, f.empA.S1]);
    // Joined 1 Jan 2024, so the year runs 1 Jan to 31 Dec; move the join date to see it follow.
    expect(y.starts).toBe("2026-01-01");
    await db.query(`update public.employees set join_date = '2024-06-15' where id = $1`, [f.empA.S2]);
    const y2 = await one<{ year: number; starts: string; ends: string }>(db, `select year, starts::text, ends::text from private.leave_year($1, $2, '2026-03-01')`, [type, f.empA.S2]);
    expect(y2.starts).toBe("2025-06-15");
    expect(y2.ends).toBe("2026-06-14");
    await db.query(`update public.employees set join_date = '2024-01-01' where id = $1`, [f.empA.S2]);
  });
});

describe("documents", () => {
  let sick: string;
  beforeAll(async () => {
    sick = await leaveType("Sick leave (doctor)", {
      entitlement_days: 15, allow_after_the_fact: true, document_rule: "always", document_later_allowed: true, document_deadline_days: 3,
    });
  });

  it("turns sick leave into unapproved absences when the document never comes", async () => {
    const sickDay = day(-6, -1);
    const req = await ask(f.users.staffA, sick, sickDay);
    let r = (await q<{ document_status: string; document_due_on: string }>(`select document_status, document_due_on::text from public.leave_requests where id = $1`, [req.id]))[0];
    expect(r.document_status).toBe("needed");
    expect(r.document_due_on).toBe((await one<{ d: string }>(db, `select ($1::date + 3)::text as d`, [sickDay])).d);
    const approval = (await q<{ id: string }>(`select id from public.approval_requests where source_id = $1`, [req.id]))[0];
    await asUser(db, f.users.managerA, (tx) => tx.query(`select public.decide_request($1, 'approve')`, [approval.id]));

    // The daily check runs after the deadline.
    await db.query(`select private.process_leave_documents($1)`, [f.bizA]);
    r = (await q<{ document_status: string; status: string }>(`select document_status, status from public.leave_requests where id = $1`, [req.id]))[0] as never;
    expect(r).toMatchObject({ document_status: "overdue", status: "cancelled" });
    const att = (await q<{ status: string; source: string }>(`select status, source from public.attendance_records where employee_id = $1 and work_date = $2`, [f.empA.S1, sickDay]))[0];
    expect(att).toEqual({ status: "absent", source: "system" });
    const summary = await one<{ status: string }>(db, `select status from private.attendance_days($1, $2, $2, $3)`, [f.bizA, sickDay, f.empA.S1]);
    expect(summary.status).toBe("absent");
    // The days are back in the balance, and everyone has been told.
    const bal = await one<{ taken: string }>(db, `select taken from public.leave_balances where employee_id = $1 and leave_type_id = $2`, [f.empA.S1, sick]);
    expect(Number(bal.taken)).toBe(0);
    const told = await q<{ user_id: string }>(`select user_id from public.notifications where event_type = 'leave.document_overdue'`);
    expect(told.map((n) => n.user_id)).toEqual(expect.arrayContaining([f.users.staffA, f.users.managerA, f.users.hrA]));

    // HR decides the document isn't needed after all: the time off and balance come back, with the reason kept.
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.waive_leave_document($1, 'Mine')`, [req.id]))).rejects.toThrow(/permission/);
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.waive_leave_document($1, ' ')`, [req.id]))).rejects.toThrow(/reason/);
    await asUser(db, f.users.hrA, (tx) => tx.query(`select public.waive_leave_document($1, 'Saw the certificate in person')`, [req.id]));
    r = (await q<{ document_status: string; status: string }>(`select document_status, status from public.leave_requests where id = $1`, [req.id]))[0] as never;
    expect(r).toMatchObject({ document_status: "waived", status: "approved" });
    expect((await q(`select 1 from public.attendance_records where employee_id = $1 and work_date = $2`, [f.empA.S1, sickDay])).length).toBe(0);
    const logged = await q(`select 1 from public.audit_log where entity_id = $1 and changes::text like '%Saw the certificate in person%'`, [req.id]);
    expect(logged.length).toBe(1);
  });

  it("reminds before the deadline, and a document in time keeps the leave", async () => {
    const d = day(-2, -1);
    const req = await ask(f.users.staffA, sick, d);
    // Due in 3 days; move it to tomorrow to see the reminder.
    await db.query(`update public.leave_requests set document_due_on = private.biz_today(business_id) + 1 where id = $1`, [req.id]);
    await db.query(`select private.process_leave_documents($1)`, [f.bizA]);
    const reminded = await q<{ user_id: string }>(`select user_id from public.notifications where event_type = 'leave.document_due'`);
    expect(reminded.map((n) => n.user_id)).toEqual(expect.arrayContaining([f.users.staffA, f.users.managerA, f.users.hrA]));
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.attach_leave_document($1, $2)`, [req.id, `${f.bizA}/leave/${f.empA.S1}/cert.pdf`]));
    await db.query(`update public.leave_requests set document_due_on = $2 where id = $1`, [req.id, day(-1, -1)]);
    await db.query(`select private.process_leave_documents($1)`, [f.bizA]);
    const r = (await q<{ document_status: string; status: string }>(`select document_status, status from public.leave_requests where id = $1`, [req.id]))[0];
    expect(r).toMatchObject({ document_status: "uploaded", status: "pending" });
  });

  it("HR can give more time, which needs a reason", async () => {
    const d = day(-8, -1);
    const req = await ask(f.users.staffA2, sick, d);
    await db.query(`select private.process_leave_documents($1)`, [f.bizA]);
    expect((await q<{ status: string }>(`select status from public.leave_requests where id = $1`, [req.id]))[0].status).toBe("cancelled");
    await asUser(db, f.users.hrA, (tx) => tx.query(`select public.extend_leave_document($1, $2, 'Clinic closed for the weekend')`, [req.id, day(3)]));
    const r = (await q<{ document_status: string; status: string }>(`select document_status, status from public.leave_requests where id = $1`, [req.id]))[0];
    // HR stepping in counts as approving the time off.
    expect(r).toMatchObject({ document_status: "needed", status: "approved" });
    expect((await q(`select 1 from public.attendance_records where employee_id = $1 and work_date = $2`, [f.empA.S2, d])).length).toBe(0);
  });
});
