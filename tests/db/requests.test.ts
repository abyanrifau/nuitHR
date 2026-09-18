/**
 * Requests engine: routing to the right approver, multi-step chains,
 * amount rules, stand-ins, declines, cancelling, notifications, and
 * writing the outcome back onto the original item.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
let certTemplate: string;

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  certTemplate = (await db.query<{ id: string }>(`select id from public.letter_templates where business_id = $1 and kind = 'employment_certificate'`, [f.bizA]))
    .rows[0].id;
});

const requestLetter = (who: string, purpose = "Bank loan") =>
  asUser(db, who, (tx) => one<{ id: string }>(tx, `select public.request_letter($1, $2, $3) as id`, [f.bizA, certTemplate, purpose]));
const requestFor = async (letterId: string) =>
  (await db.query<{ id: string; status: string }>(`select id, status from public.approval_requests where source_id = $1`, [letterId])).rows[0];
const inbox = (who: string) =>
  asUser(db, who, async (tx) => (await tx.query<{ id: string; via: string }>(`select id, via from public.my_request_inbox($1)`, [f.bizA])).rows);
const decide = (who: string, req: string, decision: string, comment?: string) =>
  asUser(db, who, (tx) => one<{ r: { status: string } }>(tx, `select public.decide_request($1, $2, $3) as r`, [req, decision, comment ?? null]));
const letterStatus = async (id: string) => (await db.query<{ status: string }>(`select status from public.letter_requests where id = $1`, [id])).rows[0].status;

describe("starter letter templates", () => {
  it("are added for every company", async () => {
    const n = await db.query(`select 1 from public.letter_templates where business_id = $1`, [f.bizA]);
    expect(n.rows.length).toBe(5);
  });
});

describe("routing", () => {
  it("sends a staff member's request to their manager and notifies them", async () => {
    const letter = await requestLetter(f.users.staffA);
    const req = await requestFor(letter.id);
    expect((await inbox(f.users.managerA)).map((r) => r.id)).toContain(req.id);
    expect((await inbox(f.users.staffA2)).map((r) => r.id)).not.toContain(req.id);
    const notes = await db.query(`select 1 from public.notifications where user_id = $1 and event_type = 'approval.requested'`, [f.users.managerA]);
    expect(notes.rows.length).toBe(1);
  });

  it("falls back to HR when the person has no manager", async () => {
    const letter = await requestLetter(f.users.staffA2);
    const req = await requestFor(letter.id);
    const hr = await inbox(f.users.hrA);
    expect(hr.find((r) => r.id === req.id)?.via).toBe("role");
    expect((await inbox(f.users.managerA)).map((r) => r.id)).not.toContain(req.id);
  });
});

describe("deciding", () => {
  it("approves, writes the result back, and tells the person who asked", async () => {
    const letter = await requestLetter(f.users.staffA, "Visa application");
    const req = await requestFor(letter.id);
    const r = await decide(f.users.managerA, req.id, "approve");
    expect(r.r.status).toBe("approved");
    expect(await letterStatus(letter.id)).toBe("approved");
    const notes = await db.query(`select title from public.notifications where user_id = $1 and event_type = 'approval.decided'`, [f.users.staffA]);
    expect(notes.rows.length).toBeGreaterThan(0);
    await expect(decide(f.users.managerA, req.id, "approve")).rejects.toThrow(/already been approved/);
  });

  it("needs a note to decline", async () => {
    const letter = await requestLetter(f.users.staffA, "Rental");
    const req = await requestFor(letter.id);
    await expect(decide(f.users.managerA, req.id, "reject")).rejects.toThrow(/short note/);
    await decide(f.users.managerA, req.id, "reject", "Please use the salary certificate instead");
    expect(await letterStatus(letter.id)).toBe("rejected");
  });

  it("won't let people decide requests that aren't theirs, or their own", async () => {
    const letter = await requestLetter(f.users.staffA, "School");
    const req = await requestFor(letter.id);
    await expect(decide(f.users.staffA2, req.id, "approve")).rejects.toThrow(/isn't waiting for you/);
    await expect(decide(f.users.staffA, req.id, "approve")).rejects.toThrow(/your own request/);
    await expect(decide(f.users.ownerB, req.id, "approve")).rejects.toThrow(/not found/);
  });

  it("lets the person who asked cancel while it's pending", async () => {
    const letter = await requestLetter(f.users.staffA, "Embassy");
    const req = await requestFor(letter.id);
    await expect(asUser(db, f.users.staffA2, (tx) => tx.query(`select public.cancel_request($1)`, [req.id]))).rejects.toThrow(/Only the person/);
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.cancel_request($1)`, [req.id]));
    expect(await letterStatus(letter.id)).toBe("cancelled");
    expect((await inbox(f.users.managerA)).map((r) => r.id)).not.toContain(req.id);
  });
});

describe("chains, stand-ins and amounts", () => {
  it("runs a two-step chain: manager, then HR", async () => {
    await asUser(db, f.users.ownerA, async (tx) => {
      const wf = await one<{ id: string }>(
        tx,
        `insert into public.approval_workflows (business_id, request_type, name) values ($1, 'letter_request', 'Manager then HR') returning id`,
        [f.bizA],
      );
      await tx.query(
        `insert into public.approval_workflow_steps (business_id, workflow_id, step_order, approver_type, approver_role_id)
         values ($1, $2, 1, 'direct_manager', null), ($1, $2, 2, 'role', (select id from public.roles where business_id = $1 and key = 'hr_manager'))`,
        [f.bizA, wf.id],
      );
    });
    const letter = await requestLetter(f.users.staffA, "Mortgage");
    const req = await requestFor(letter.id);
    expect((await inbox(f.users.hrA)).map((r) => r.id)).not.toContain(req.id);
    const first = await decide(f.users.managerA, req.id, "approve");
    expect(first.r.status).toBe("pending");
    expect((await inbox(f.users.hrA)).map((r) => r.id)).toContain(req.id);
    const second = await decide(f.users.hrA, req.id, "approve");
    expect(second.r.status).toBe("approved");
  });

  it("lets a stand-in decide while the approver is away", async () => {
    await asUser(db, f.users.managerA, (tx) =>
      tx.query(
        `insert into public.approval_delegations (business_id, delegator_user_id, delegate_user_id, ends_at) values ($1, $2, $3, now() + interval '7 days')`,
        [f.bizA, f.users.managerA, f.users.staffA2],
      ),
    );
    const letter = await requestLetter(f.users.staffA, "Travel");
    const req = await requestFor(letter.id);
    expect((await inbox(f.users.staffA2)).find((r) => r.id === req.id)?.via).toBe("stand-in");
    await decide(f.users.staffA2, req.id, "approve");
    const step = await db.query<{ acted_by: string; delegated_from: string }>(
      `select acted_by, delegated_from from public.approval_request_steps where request_id = $1 and step_order = 1`,
      [req.id],
    );
    expect(step.rows[0]).toEqual({ acted_by: f.users.staffA2, delegated_from: f.users.managerA });
  });

  it("adds an extra approver only above an amount", async () => {
    await asUser(db, f.users.ownerA, async (tx) => {
      const wf = await one<{ id: string }>(tx, `insert into public.approval_workflows (business_id, request_type, name) values ($1, 'claim', 'Claims') returning id`, [
        f.bizA,
      ]);
      await tx.query(
        `insert into public.approval_workflow_steps (business_id, workflow_id, step_order, approver_type, approver_role_id, min_amount)
         values ($1, $2, 1, 'direct_manager', null, null),
                ($1, $2, 2, 'role', (select id from public.roles where business_id = $1 and key = 'payroll_officer'), 500)`,
        [f.bizA, wf.id],
      );
    });
    const make = (amount: number) =>
      asUser(db, f.users.staffA, (tx) =>
        one<{ id: string }>(
          tx,
          `select private.create_request($1, 'claim', 'claims', 'claims', gen_random_uuid(), $2, 'Claim', null, $3) as id`,
          [f.bizA, f.empA.S1, amount],
        ),
      );
    const small = await make(120);
    const big = await make(900);
    const steps = async (id: string) => (await db.query(`select 1 from public.approval_request_steps where request_id = $1`, [id])).rows.length;
    expect(await steps(small.id)).toBe(1);
    expect(await steps(big.id)).toBe(2);
  });
});

describe("notification preferences", () => {
  it("skips in-app notifications a person has switched off", async () => {
    await asUser(db, f.users.managerA, (tx) =>
      tx.query(
        `insert into public.notification_preferences (business_id, user_id, event_type, channel, enabled) values ($1, $2, 'approval.requested', 'in_app', false)
         on conflict (business_id, user_id, event_type, channel) do update set enabled = false`,
        [f.bizA, f.users.managerA],
      ),
    );
    await db.query(`delete from public.approval_workflows where business_id = $1 and request_type = 'letter_request'`, [f.bizA]);
    const before = (await db.query(`select 1 from public.notifications where user_id = $1`, [f.users.managerA])).rows.length;
    await requestLetter(f.users.staffA, "Quiet one");
    const after = (await db.query(`select 1 from public.notifications where user_id = $1`, [f.users.managerA])).rows.length;
    expect(after).toBe(before);
  });
});
