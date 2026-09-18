/**
 * Hiring, joiners & leavers, permits: careers page applications, hiring
 * into the directory, checklists that start by themselves and complete
 * themselves, tasks for the right people, and expiry reminders.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
let vacancy: string;
let slug: string;

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  for (const m of ["recruitment", "onboarding", "compliance"]) {
    await db.query(`insert into public.business_modules (business_id, module_key, enabled) values ($1, $2, true) on conflict (business_id, module_key) do update set enabled = true`, [f.bizA, m]);
    await db.query(`select private.seed_module_defaults($1, $2)`, [f.bizA, m]);
  }
  slug = (await q<{ slug: string }>(`update public.businesses set careers_page_enabled = true where id = $1 returning slug`, [f.bizA]))[0].slug;
  vacancy = (await q<{ id: string }>(
    `insert into public.vacancies (business_id, title, slug, status, is_public, openings) values ($1, 'Receptionist', 'receptionist', 'open', true, 1) returning id`,
    [f.bizA],
  ))[0].id;
});

describe("careers page", () => {
  it("lets anyone apply for an open public role, once", async () => {
    const app = await asUser(db, null, (tx) => one<{ id: string }>(tx, `select public.submit_application($1, $2, 'Aminath Visitor', 'aminath@example.com', '7771234', 'I love hotels') as id`, [slug, vacancy]));
    expect(app.id).toBeTruthy();
    await expect(asUser(db, null, (tx) => tx.query(`select public.submit_application($1, $2, 'Aminath Visitor', 'AMINATH@example.com')`, [slug, vacancy]))).rejects.toThrow(/already applied/);
    const notes = await q(`select 1 from public.notifications where business_id = $1 and event_type = 'recruitment.application'`, [f.bizA]);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("refuses closed roles and roles from companies without a careers page", async () => {
    const closed = (await q<{ id: string }>(`insert into public.vacancies (business_id, title, slug, status, is_public) values ($1, 'Chef', 'chef', 'closed', true) returning id`, [f.bizA]))[0].id;
    await expect(asUser(db, null, (tx) => tx.query(`select public.submit_application($1, $2, 'X Y', 'x@example.com')`, [slug, closed]))).rejects.toThrow(/isn't open/);
    await expect(asUser(db, null, (tx) => tx.query(`select public.submit_application('no-such-company', $1, 'X Y', 'x@example.com')`, [vacancy]))).rejects.toThrow(/isn't open/);
  });

  it("visitors can't read candidates or applications directly", async () => {
    const rows = await asUser(db, null, async (tx) => (await tx.query(`select * from public.candidates`)).rows);
    expect(rows.length).toBe(0);
  });
});

describe("hiring", () => {
  it("only hiring and people managers can hire", async () => {
    const app = (await q<{ id: string }>(`select id from public.applications where vacancy_id = $1`, [vacancy]))[0].id;
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.hire_candidate($1, '2026-10-01', 'E100')`, [app]))).rejects.toThrow(/rights/);
  });

  it("creates the person, fills the role, and starts their joiner checklist", async () => {
    const app = (await q<{ id: string }>(`select id from public.applications where vacancy_id = $1`, [vacancy]))[0].id;
    const emp = await asUser(db, f.users.ownerA, (tx) => one<{ id: string }>(tx, `select public.hire_candidate($1, '2026-10-01', 'E100', null, $2, null, $3, 9000) as id`, [app, f.deptA.ops, f.empA.M]));
    const e = (await q<{ first_name: string; last_name: string; status: string }>(`select first_name, last_name, status from public.employees where id = $1`, [emp.id]))[0];
    expect(e).toMatchObject({ first_name: "Aminath", last_name: "Visitor", status: "probation" });
    expect((await q<{ stage: string }>(`select stage from public.applications where id = $1`, [app]))[0].stage).toBe("hired");
    expect((await q<{ status: string }>(`select status from public.vacancies where id = $1`, [vacancy]))[0].status).toBe("filled");
    expect(Number((await q<{ basic_salary: string }>(`select basic_salary from public.employee_compensation where employee_id = $1`, [emp.id]))[0].basic_salary)).toBe(9000);
    const tasks = await q<{ assignee_type: string; assignee_user_id: string | null; due_date: string }>(
      `select t.assignee_type, t.assignee_user_id, t.due_date::text from public.employee_checklist_tasks t join public.employee_checklists c on c.id = t.checklist_id where c.employee_id = $1 and c.kind = 'onboarding'`,
      [emp.id],
    );
    expect(tasks.length).toBe(7);
    // Manager tasks go to the manager's login.
    expect(tasks.filter((t) => t.assignee_type === "manager").every((t) => t.assignee_user_id === f.users.managerA)).toBe(true);
    expect(tasks.some((t) => t.due_date === "2026-10-08")).toBe(true);
  });
});

describe("joiners & leavers", () => {
  it("the manager sees and completes their tasks; the checklist completes when everything is done", async () => {
    const mine = await asUser(db, f.users.managerA, async (tx) => (await tx.query<{ id: string }>(`select id from public.my_checklist_tasks($1)`, [f.bizA])).rows);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    for (const t of mine) await asUser(db, f.users.managerA, (tx) => tx.query(`update public.employee_checklist_tasks set status = 'done' where id = $1`, [t.id]));
    const left = await q<{ id: string }>(`select t.id from public.employee_checklist_tasks t join public.employee_checklists c on c.id = t.checklist_id where c.kind = 'onboarding' and t.status = 'todo' and c.business_id = $1 and c.status = 'in_progress' and t.assignee_type <> 'manager'`, [f.bizA]);
    for (const t of left) await asUser(db, f.users.hrA, (tx) => tx.query(`update public.employee_checklist_tasks set status = 'done' where id = $1`, [t.id]));
    const done = await q<{ status: string; completed_by: string | null }>(
      `select c.status, (select t.completed_by::text from public.employee_checklist_tasks t where t.checklist_id = c.id and t.assignee_type = 'manager' limit 1) as completed_by
         from public.employee_checklists c join public.employees e on e.id = c.employee_id where e.employee_code = 'E100'`,
    );
    expect(done[0].status).toBe("completed");
    expect(done[0].completed_by).toBe(f.users.managerA);
  });

  it("staff can't see other people's checklists", async () => {
    const rows = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select 1 from public.employee_checklists c join public.employees e on e.id = c.employee_id where e.employee_code = 'E100'`)).rows);
    expect(rows.length).toBe(0);
  });

  it("doesn't start a joiner checklist for someone added who joined long ago", async () => {
    const [e] = await q<{ id: string }>(`insert into public.employees (business_id, employee_code, first_name, last_name, join_date) values ($1, 'OLD1', 'Long', 'Timer', '2015-03-01') returning id`, [f.bizA]);
    expect(await q(`select 1 from public.employee_checklists where employee_id = $1`, [e.id])).toHaveLength(0);
  });

  it("starts a leaver checklist when someone resigns", async () => {
    await asUser(db, f.users.hrA, (tx) => tx.query(`update public.employees set status = 'resigned', exit_date = '2026-12-31', exit_reason = 'Resigned' where id = $1`, [f.empA.S2]));
    const c = await q<{ kind: string }>(`select kind from public.employee_checklists where employee_id = $1`, [f.empA.S2]);
    expect(c.map((x) => x.kind)).toContain("offboarding");
  });
});

describe("permit reminders", () => {
  it("sends one reminder per threshold, to HR and the person", async () => {
    const type = (await q<{ id: string }>(`select id from public.compliance_types where business_id = $1 and key = 'work_permit'`, [f.bizA]))[0].id;
    await db.query(
      `insert into public.compliance_items (business_id, employee_id, type_id, reference_no, expires_on) values ($1, $2, $3, 'WP-1', (now() at time zone 'Indian/Maldives')::date + 25)`,
      [f.bizA, f.empA.S1, type],
    );
    const sent = await asService(db, (tx) => one<{ n: number }>(tx, `select public.send_compliance_reminders() as n`));
    expect(sent.n).toBe(1);
    const again = await asService(db, (tx) => one<{ n: number }>(tx, `select public.send_compliance_reminders() as n`));
    expect(again.n).toBe(0);
    const staffNote = await q(`select 1 from public.notifications where user_id = $1 and event_type = 'compliance.expiring'`, [f.users.staffA]);
    expect(staffNote.length).toBe(1);
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.send_compliance_reminders()`))).rejects.toThrow();
  });
});
