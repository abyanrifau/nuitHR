/**
 * Training, reviews & goals, surveys: assigning courses, grading quizzes
 * without leaking answers, review rounds from self review to acknowledgement,
 * and anonymous surveys that can't be traced back.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
let course: string;
let textLesson: string;
let quiz: string;
let q1: string;
let q2: string;

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  for (const m of ["learning", "performance"]) {
    await db.query(`insert into public.business_modules (business_id, module_key, enabled) values ($1, $2, true) on conflict (business_id, module_key) do update set enabled = true`, [f.bizA, m]);
    await db.query(`select private.seed_module_defaults($1, $2)`, [f.bizA, m]);
  }
  await asUser(db, f.users.hrA, async (tx) => {
    course = (await one<{ id: string }>(tx, `insert into public.courses (business_id, title, pass_mark) values ($1, 'Food safety', 60) returning id`, [f.bizA])).id;
    textLesson = (await one<{ id: string }>(tx, `insert into public.course_lessons (business_id, course_id, title, kind, content, sort) values ($1, $2, 'Wash your hands', 'text', 'Always.', 1) returning id`, [f.bizA, course])).id;
    quiz = (await one<{ id: string }>(tx, `insert into public.course_lessons (business_id, course_id, title, kind, sort) values ($1, $2, 'Check', 'quiz', 2) returning id`, [f.bizA, course])).id;
    q1 = (await one<{ id: string }>(tx, `select public.save_quiz_question($1, null, 'Safe fridge temperature?', 'single', '[{"id":"a","text":"5°C or below"},{"id":"b","text":"15°C"}]', array['a'], 'Keep it cold.') as id`, [quiz])).id;
    q2 = (await one<{ id: string }>(tx, `select public.save_quiz_question($1, null, 'Which need gloves?', 'multiple', '[{"id":"a","text":"Raw meat"},{"id":"b","text":"Salad"},{"id":"c","text":"Sealed cans"}]', array['a','b']) as id`, [quiz])).id;
  });
});

describe("training", () => {
  it("won't assign a draft course", async () => {
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.assign_course($1, 'everyone')`, [course]))).rejects.toThrow(/Publish/);
  });

  it("staff can't assign courses", async () => {
    await db.query(`update public.courses set status = 'published' where id = $1`, [course]);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.assign_course($1, 'everyone')`, [course]))).rejects.toThrow(/permission/);
  });

  it("assigning to a department enrols its people and tells them; new joiners there are enrolled too", async () => {
    const n = await asUser(db, f.users.hrA, (tx) => one<{ n: number }>(tx, `select public.assign_course($1, 'department', $2, '2026-12-31', true) as n`, [course, f.deptA.ops]));
    expect(n.n).toBe(2); // Mohamed and Fathimath
    const notes = await q(`select 1 from public.notifications where user_id = $1 and event_type = 'learning.assigned'`, [f.users.staffA]);
    expect(notes.length).toBe(1);
    const [e] = await q<{ id: string }>(`insert into public.employees (business_id, employee_code, first_name, last_name, department_id, join_date) values ($1, 'E050', 'New', 'Joiner', $2, '2026-09-01') returning id`, [f.bizA, f.deptA.ops]);
    expect(await q(`select 1 from public.course_enrollments where employee_id = $1 and course_id = $2`, [e.id, course])).toHaveLength(1);
    // Ali in the kitchen isn't enrolled.
    expect(await q(`select 1 from public.course_enrollments where employee_id = $1`, [f.empA.S2])).toHaveLength(0);
  });

  it("staff see their course and questions, but never the answers", async () => {
    const seen = await asUser(db, f.users.staffA, async (tx) => ({
      courses: (await tx.query(`select id from public.courses`)).rows.length,
      questions: (await tx.query(`select id from public.quiz_questions`)).rows.length,
      keys: (await tx.query(`select 1 from public.quiz_answer_keys`)).rows.length,
    }));
    expect(seen).toEqual({ courses: 1, questions: 2, keys: 0 });
    const other = await asUser(db, f.users.staffA2, async (tx) => (await tx.query(`select id from public.courses`)).rows.length);
    expect(other).toBe(0);
  });

  it("a failed quiz says what was wrong without giving the answers; passing completes the course", async () => {
    const en = (await q<{ id: string }>(`select id from public.course_enrollments where employee_id = $1`, [f.empA.S1]))[0].id;
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.complete_lesson($1, $2)`, [en, textLesson]));
    expect((await q<{ progress_percent: number; status: string }>(`select progress_percent, status from public.course_enrollments where id = $1`, [en]))[0]).toMatchObject({ progress_percent: 50, status: "in_progress" });

    const fail = await asUser(db, f.users.staffA, (tx) => one<{ r: { score: number; passed: boolean; results: Record<string, unknown>[] } }>(tx, `select public.submit_quiz($1, $2, $3) as r`, [en, quiz, JSON.stringify({ [q1]: ["b"], [q2]: ["a"] })]));
    expect(fail.r.passed).toBe(false);
    expect(fail.r.score).toBe(0);
    expect(fail.r.results.every((x) => !("correct_ids" in x))).toBe(true);

    const pass = await asUser(db, f.users.staffA, (tx) => one<{ r: { score: number; passed: boolean; results: { correct_ids: string[] }[] } }>(tx, `select public.submit_quiz($1, $2, $3) as r`, [en, quiz, JSON.stringify({ [q1]: ["a"], [q2]: ["b", "a"] })]));
    expect(pass.r).toMatchObject({ score: 100, passed: true });
    expect(pass.r.results[0].correct_ids).toEqual(["a"]);
    expect((await q<{ status: string; score: number; progress_percent: number }>(`select status, score, progress_percent from public.course_enrollments where id = $1`, [en]))[0]).toMatchObject({ status: "completed", score: 100, progress_percent: 100 });
  });

  it("nobody can finish someone else's course", async () => {
    const en = (await q<{ id: string }>(`select id from public.course_enrollments where employee_id = $1`, [f.empA.M]))[0].id;
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.complete_lesson($1, $2)`, [en, textLesson]))).rejects.toThrow(/assigned to you/);
  });

  it("reminds once about courses that are due, then waits", async () => {
    await db.query(`update public.course_enrollments set due_date = private.biz_today(business_id) + 1 where employee_id = $1`, [f.empA.M]);
    const first = await asService(db, (tx) => one<{ n: number }>(tx, `select public.send_learning_reminders() as n`));
    const again = await asService(db, (tx) => one<{ n: number }>(tx, `select public.send_learning_reminders() as n`));
    expect(first.n).toBeGreaterThanOrEqual(1);
    expect(again.n).toBe(0);
  });

  it("paid training requests go through approvals and are approved there", async () => {
    const id = await asUser(db, f.users.staffA, (tx) => one<{ id: string }>(tx, `select public.request_paid_training($1, 'Maldives Hospitality School', 'Barista level 2', 'Malé', '2026-11-01', '2026-11-05', 4500, null) as id`, [f.bizA]));
    const req = await q<{ status: string; amount: string }>(`select status, amount from public.approval_requests where source_id = $1`, [id.id]);
    expect(req[0].status).toBe("pending");
    expect(Number(req[0].amount)).toBe(4500);
  });
});

describe("reviews", () => {
  let cycle: string;
  let review: string;
  let questions: { id: string; kind: string }[];

  beforeAll(async () => {
    const tpl = (await q<{ id: string }>(`select id from public.review_templates where business_id = $1`, [f.bizA]))[0].id;
    questions = await q(`select id, kind from public.review_questions where template_id = $1 order by sort`, [tpl]);
    cycle = (await asUser(db, f.users.hrA, (tx) => one<{ id: string }>(tx, `insert into public.review_cycles (business_id, name, period_start, period_end, template_id, participant_filter) values ($1, '2026 review', '2026-01-01', '2026-12-31', $2, $3) returning id`, [f.bizA, tpl, JSON.stringify({ department_ids: [f.deptA.ops] })]))).id;
  });

  const answers = () => questions.map((x) => ({ question_id: x.id, rating: x.kind === "text" ? null : 4, answer: x.kind === "rating" ? null : "Good work" }));

  it("only HR can open a round; opening creates reviews for the chosen team and tells them", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.open_review_cycle($1)`, [cycle]))).rejects.toThrow(/permission/);
    const n = await asUser(db, f.users.hrA, (tx) => one<{ n: number }>(tx, `select public.open_review_cycle($1) as n`, [cycle]));
    expect(n.n).toBe(3); // Mohamed, Fathimath, and the new joiner in Front Office
    review = (await q<{ id: string; reviewer_employee_id: string }>(`select id, reviewer_employee_id from public.reviews where cycle_id = $1 and employee_id = $2`, [cycle, f.empA.S1]))[0].id;
    expect(await q(`select 1 from public.notifications where user_id = $1 and event_type = 'review.opened'`, [f.users.staffA])).toHaveLength(1);
  });

  it("the self review can't be sent half done, then goes to the manager", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.save_review($1, $2, true)`, [review, JSON.stringify(answers().slice(0, 2))]))).rejects.toThrow(/every question/);
    const s = await asUser(db, f.users.staffA, (tx) => one<{ s: string }>(tx, `select public.save_review($1, $2, true) as s`, [review, JSON.stringify(answers())]));
    expect(s.s).toBe("manager_review");
    expect(await q(`select 1 from public.notifications where user_id = $1 and event_type = 'review.self_done'`, [f.users.managerA])).toHaveLength(1);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.save_review($1, $2, false)`, [review, JSON.stringify(answers())]))).rejects.toThrow(/already sent/);
  });

  it("staff can't read the manager's answers until the review is shared", async () => {
    await asUser(db, f.users.managerA, (tx) => tx.query(`select public.save_review($1, $2, true, 4, 'A strong year.')`, [review, JSON.stringify(answers())]));
    const before = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select 1 from public.review_responses where review_id = $1 and respondent_type = 'manager'`, [review])).rows.length);
    expect(before).toBe(0);
    await asUser(db, f.users.managerA, (tx) => tx.query(`select public.share_review($1)`, [review]));
    const after = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select 1 from public.review_responses where review_id = $1 and respondent_type = 'manager'`, [review])).rows.length);
    expect(after).toBe(questions.length);
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.acknowledge_review($1, 'Thank you')`, [review]));
    expect((await q<{ status: string; employee_comment: string }>(`select status, employee_comment from public.reviews where id = $1`, [review]))[0]).toEqual({ status: "acknowledged", employee_comment: "Thank you" });
  });

  it("other staff can't fill in someone else's review", async () => {
    const other = (await q<{ id: string }>(`select id from public.reviews where cycle_id = $1 and employee_id = $2`, [cycle, f.empA.M]))[0].id;
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.save_review($1, '[]', false)`, [other]))).rejects.toThrow(/can't fill in/);
  });
});

describe("surveys", () => {
  let survey: string;
  let scale: string;
  let text: string;

  beforeAll(async () => {
    await asUser(db, f.users.hrA, async (tx) => {
      survey = (await one<{ id: string }>(tx, `insert into public.surveys (business_id, title, is_anonymous, min_responses_to_show) values ($1, 'How is work?', true, 2) returning id`, [f.bizA])).id;
      scale = (await one<{ id: string }>(tx, `insert into public.survey_questions (business_id, survey_id, question, kind, sort) values ($1, $2, 'How happy are you?', 'scale', 1) returning id`, [f.bizA, survey])).id;
      text = (await one<{ id: string }>(tx, `insert into public.survey_questions (business_id, survey_id, question, kind, is_required, sort) values ($1, $2, 'Anything else?', 'text', false, 2) returning id`, [f.bizA, survey])).id;
      await tx.query(`update public.surveys set status = 'open' where id = $1`, [survey]);
    });
  });

  it("opening tells staff, who see it in their list", async () => {
    expect(await q(`select 1 from public.notifications where user_id = $1 and event_type = 'survey.opened'`, [f.users.staffA2])).toHaveLength(1);
    const mine = await asUser(db, f.users.staffA, async (tx) => (await tx.query<{ answered: boolean }>(`select answered from public.my_surveys($1)`, [f.bizA])).rows);
    expect(mine).toEqual([{ answered: false }]);
    const qs = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select id from public.my_survey_questions($1)`, [survey])).rows);
    expect(qs).toHaveLength(2);
    const outsider = await asUser(db, f.users.staffB, async (tx) => (await tx.query(`select id from public.my_survey_questions($1)`, [survey])).rows);
    expect(outsider).toHaveLength(0);
  });

  it("anonymous answers aren't linked to the person, and nobody answers twice", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.submit_survey($1, $2)`, [survey, JSON.stringify({ [scale]: 9 })]))).rejects.toThrow(/out of range/);
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.submit_survey($1, $2)`, [survey, JSON.stringify({ [scale]: 4, [text]: "More shade at the pool" })]));
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.submit_survey($1, $2)`, [survey, JSON.stringify({ [scale]: 5 })]))).rejects.toThrow(/already answered/);
    expect((await q<{ respondent_employee_id: string | null }>(`select respondent_employee_id from public.survey_responses where survey_id = $1`, [survey]))[0].respondent_employee_id).toBeNull();
  });

  it("results stay hidden until enough people answer", async () => {
    const hidden = await asUser(db, f.users.hrA, (tx) => one<{ r: { hidden: boolean; responses: number } }>(tx, `select public.survey_results($1) as r`, [survey]));
    expect(hidden.r).toMatchObject({ hidden: true, responses: 1 });
    await asUser(db, f.users.staffA2, (tx) => tx.query(`select public.submit_survey($1, $2)`, [survey, JSON.stringify({ [scale]: 2 })]));
    const shown = await asUser(db, f.users.hrA, (tx) => one<{ r: { hidden: boolean; questions: { average?: number; texts?: string[] }[] } }>(tx, `select public.survey_results($1) as r`, [survey]));
    expect(shown.r.hidden).toBe(false);
    expect(Number(shown.r.questions[0].average)).toBe(3);
    expect(shown.r.questions[1].texts).toEqual(["More shade at the pool"]);
  });

  it("staff can't read survey results or raw answers", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.survey_results($1)`, [survey]))).rejects.toThrow(/permission/);
    const raw = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select 1 from public.survey_answers`)).rows.length);
    expect(raw).toBe(0);
  });
});
