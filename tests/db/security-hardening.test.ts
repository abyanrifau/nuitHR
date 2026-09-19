/**
 * Pre-launch security review: each test is one way someone tried to reach
 * data or powers they shouldn't have, and must now be refused.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  for (const m of ["onboarding", "learning", "performance"]) {
    await db.query(`insert into public.business_modules (business_id, module_key, enabled) values ($1, $2, true) on conflict (business_id, module_key) do update set enabled = true`, [f.bizA, m]);
    await db.query(`select private.seed_module_defaults($1, $2)`, [f.bizA, m]);
  }
});

describe("logins and roles", () => {
  it("HR can't link their own login to someone else's profile (to see that person's pay)", async () => {
    await expect(
      asUser(db, f.users.hrA, (tx) => tx.query(`update public.business_members set employee_id = $1 where business_id = $2 and user_id = $3`, [f.empA.S2, f.bizA, f.users.hrA])),
    ).rejects.toThrow(/Ask an owner/);
  });

  it("HR can't give anyone a role that sees pay; the owner can", async () => {
    const payroll = f.roleA.payroll_officer;
    await expect(
      asUser(db, f.users.hrA, (tx) => tx.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [payroll, f.bizA, f.users.staffA2])),
    ).rejects.toThrow(/Only an owner/);
    await expect(
      asUser(db, f.users.hrA, (tx) => tx.query(`insert into public.invitations (business_id, email, role_id, token_hash, expires_at) values ($1, 'second@me.test', $2, 'x', now() + interval '1 day')`, [f.bizA, payroll])),
    ).rejects.toThrow(/Only an owner/);
    await asUser(db, f.users.ownerA, (tx) => tx.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [payroll, f.bizA, f.users.staffA2]));
    await asUser(db, f.users.ownerA, (tx) => tx.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [f.roleA.employee, f.bizA, f.users.staffA2]));
  });

  it("HR can still give ordinary roles, like manager", async () => {
    await asUser(db, f.users.hrA, (tx) => tx.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [f.roleA.manager, f.bizA, f.users.staffA2]));
    await asUser(db, f.users.hrA, (tx) => tx.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [f.roleA.employee, f.bizA, f.users.staffA2]));
  });
});

describe("checklists", () => {
  it("staff can't start checklists for other people, in their company or another", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.start_checklist($1, 'offboarding', null, 'hired')`, [f.empA.S2]))).rejects.toThrow(/permission/);
    await expect(asUser(db, f.users.staffB, (tx) => tx.query(`select public.start_checklist($1, 'offboarding')`, [f.empA.S2]))).rejects.toThrow(/permission/);
  });

  it("HR can, and new joiners still get theirs automatically", async () => {
    const id = await asUser(db, f.users.hrA, (tx) => one<{ id: string | null }>(tx, `select public.start_checklist($1, 'offboarding') as id`, [f.empA.S2]));
    expect(id.id).toBeTruthy();
    const [e] = await q<{ id: string }>(`insert into public.employees (business_id, employee_code, first_name, last_name, join_date) values ($1, 'NEW9', 'New', 'Person', private.biz_today($1)) returning id`, [f.bizA]);
    expect(await q(`select 1 from public.employee_checklists where employee_id = $1 and kind = 'onboarding'`, [e.id])).toHaveLength(1);
  });
});

describe("records staff must not write themselves", () => {
  it("clock-in records and timesheets", async () => {
    await expect(
      asUser(db, f.users.staffA, (tx) =>
        tx.query(`insert into public.attendance_records (business_id, employee_id, work_date, clock_in_at, clock_out_at) values ($1, $2, '2026-01-05', '2026-01-05 01:00+00', '2026-01-05 18:00+00')`, [f.bizA, f.empA.S1]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, f.users.staffA, (tx) => tx.query(`insert into public.timesheets (business_id, employee_id, period_start, period_end, status) values ($1, $2, '2026-01-01', '2026-01-15', 'approved')`, [f.bizA, f.empA.S1])),
    ).rejects.toThrow(/row-level security|violates/);
  });

  it("course progress", async () => {
    await asUser(db, f.users.hrA, async (tx) => {
      const c = await one<{ id: string }>(tx, `insert into public.courses (business_id, title, status) values ($1, 'Fire safety', 'published') returning id`, [f.bizA]);
      await tx.query(`insert into public.course_lessons (business_id, course_id, title, kind, content) values ($1, $2, 'Exits', 'text', 'Know them.')`, [f.bizA, c.id]);
      await tx.query(`select public.assign_course($1, 'employee', $2)`, [c.id, f.empA.S1]);
    });
    const changed = await asUser(db, f.users.staffA, async (tx) =>
      (await tx.query(`update public.course_enrollments set status = 'completed', progress_percent = 100 where employee_id = $1 returning id`, [f.empA.S1])).rows.length,
    );
    expect(changed).toBe(0);
  });
});

describe("reviews before sharing", () => {
  it("staff get their review through my_reviews without the manager's part, and can't read the row directly", async () => {
    const tpl = (await q<{ id: string }>(`select id from public.review_templates where business_id = $1`, [f.bizA]))[0].id;
    const cycle = await asUser(db, f.users.hrA, (tx) => one<{ id: string }>(tx, `insert into public.review_cycles (business_id, name, period_start, period_end, template_id) values ($1, 'H1', '2026-01-01', '2026-06-30', $2) returning id`, [f.bizA, tpl]));
    await asUser(db, f.users.hrA, (tx) => tx.query(`select public.open_review_cycle($1)`, [cycle.id]));
    await db.query(`update public.reviews set overall_rating = 2, manager_summary = 'Secret note' where cycle_id = $1 and employee_id = $2`, [cycle.id, f.empA.S1]);
    const direct = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select manager_summary from public.reviews where cycle_id = $1`, [cycle.id])).rows);
    expect(direct).toHaveLength(0);
    const mine = await asUser(db, f.users.staffA, async (tx) => (await tx.query<{ manager_summary: string | null; overall_rating: string | null }>(`select manager_summary, overall_rating from public.my_reviews($1) where cycle_id = $2`, [f.bizA, cycle.id])).rows);
    expect(mine).toEqual([{ manager_summary: null, overall_rating: null }]);
  });
});

describe("anonymous surveys", () => {
  it("HR can't read raw answers, and the reply time can't be matched to who replied", async () => {
    const s = await asUser(db, f.users.hrA, async (tx) => {
      const sv = await one<{ id: string }>(tx, `insert into public.surveys (business_id, title, is_anonymous) values ($1, 'Pulse', true) returning id`, [f.bizA]);
      await tx.query(`insert into public.survey_questions (business_id, survey_id, question, kind) values ($1, $2, 'Happy?', 'scale')`, [f.bizA, sv.id]);
      await tx.query(`update public.surveys set status = 'open' where id = $1`, [sv.id]);
      return sv;
    });
    const qid = (await q<{ id: string }>(`select id from public.survey_questions where survey_id = $1`, [s.id]))[0].id;
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.submit_survey($1, $2)`, [s.id, JSON.stringify({ [qid]: 4 })]));
    const seen = await asUser(db, f.users.hrA, async (tx) => ({
      responses: (await tx.query(`select 1 from public.survey_responses where survey_id = $1`, [s.id])).rows.length,
      answers: (await tx.query(`select 1 from public.survey_answers a join public.survey_questions q on q.id = a.question_id where q.survey_id = $1`, [s.id])).rows.length,
    }));
    expect(seen).toEqual({ responses: 0, answers: 0 });
    const [times] = await q<{ same: boolean; midnight: boolean }>(
      `select (r.submitted_at = p.submitted_at) as same, (r.submitted_at = date_trunc('day', r.submitted_at)) as midnight
         from public.survey_responses r join public.survey_participation p on p.survey_id = r.survey_id where r.survey_id = $1`,
      [s.id],
    );
    expect(times).toEqual({ same: false, midnight: true });
  });
});

describe("company images", () => {
  it("must be in the company's own folder", async () => {
    await expect(
      asUser(db, f.users.ownerA, (tx) => tx.query(`update public.businesses set logo_path = $1 where id = $2`, [`${f.bizB}/documents/x/secret.pdf`, f.bizA])),
    ).rejects.toThrow(/own folder/);
    await asUser(db, f.users.ownerA, (tx) => tx.query(`update public.businesses set logo_path = $1 where id = $2`, [`${f.bizA}/branding/logo.png`, f.bizA]));
  });
});
