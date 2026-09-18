/**
 * Staff app self-service: updating your own contact details and
 * emergency contacts, and the colleague directory. Each person can only
 * change their own record, and the directory never shows personal details.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
});

describe("my contact details", () => {
  it("lets staff update only their own contact fields", async () => {
    await asUser(db, f.users.staffA, (tx) =>
      tx.query(`select public.update_my_contact($1, '+960 777 1234', 'Me@Example.com', 'Malé', 'Addu')`, [f.bizA]),
    );
    const e = (await db.query<{ phone: string; personal_email: string; manager_id: string }>(`select phone, personal_email, manager_id from public.employees where id = $1`, [f.empA.S1])).rows[0];
    expect(e.phone).toBe("+960 777 1234");
    expect(e.personal_email).toBe("me@example.com");
    expect(e.manager_id).toBe(f.empA.M);
  });

  it("records the change in the history", async () => {
    const r = await db.query(`select 1 from public.audit_log where subject_employee_id = $1 and action = 'update' and actor_id = $2`, [f.empA.S1, f.users.staffA]);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("refuses logins without a staff profile, and bad emails", async () => {
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.update_my_contact($1, '1', '', '', '')`, [f.bizA]))).rejects.toThrow(/isn't linked/);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.update_my_contact($1, '1', 'not-an-email', '', '')`, [f.bizA]))).rejects.toThrow(/valid email/);
  });

  it("can't be used on another company", async () => {
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.update_my_contact($1, '1', '', '', '')`, [f.bizB]))).rejects.toThrow(/isn't linked/);
  });
});

describe("my emergency contacts", () => {
  it("adds, edits and removes my own contacts, keeping one first-to-call", async () => {
    const a = await asUser(db, f.users.staffA, (tx) => one<{ id: string }>(tx, `select public.save_my_emergency_contact($1, null, 'Aishath', 'Mother', '7771111', true) as id`, [f.bizA]));
    const b = await asUser(db, f.users.staffA, (tx) => one<{ id: string }>(tx, `select public.save_my_emergency_contact($1, null, 'Hassan', 'Brother', '7772222', true) as id`, [f.bizA]));
    const rows = (await db.query<{ id: string; is_primary: boolean }>(`select id, is_primary from public.employee_emergency_contacts where employee_id = $1`, [f.empA.S1])).rows;
    expect(rows.find((r) => r.id === a.id)?.is_primary).toBe(false);
    expect(rows.find((r) => r.id === b.id)?.is_primary).toBe(true);
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.delete_my_emergency_contact($1, $2)`, [f.bizA, a.id]));
    expect((await db.query(`select 1 from public.employee_emergency_contacts where id = $1`, [a.id])).rows.length).toBe(0);
  });

  it("can't touch someone else's contacts", async () => {
    const other = (await db.query<{ id: string }>(
      `insert into public.employee_emergency_contacts (business_id, employee_id, name) values ($1, $2, 'Other') returning id`,
      [f.bizA, f.empA.S2],
    )).rows[0];
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.save_my_emergency_contact($1, $2, 'Hacked', null, null, false)`, [f.bizA, other.id]))).rejects.toThrow(/not found/);
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.delete_my_emergency_contact($1, $2)`, [f.bizA, other.id]))).rejects.toThrow(/not found/);
  });
});

describe("colleague directory", () => {
  it("shows colleagues with work details only, and only in my company", async () => {
    const rows = await asUser(db, f.users.staffA, async (tx) => (await tx.query<Record<string, unknown>>(`select * from public.staff_directory($1)`, [f.bizA])).rows);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(rows[0])).not.toContain("phone");
    expect(Object.keys(rows[0])).not.toContain("personal_email");
    const none = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select * from public.staff_directory($1)`, [f.bizB])).rows);
    expect(none.length).toBe(0);
  });
});
