/**
 * The Transport + Expense claims merge: old data moves into Claims with
 * nothing lost or duplicated, old tool switches and permissions carry
 * over, and the new claims table keeps each company's data private.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);

  // Recreate what an older copy of the app would have stored (written directly, as the old app did).
  await q(`update public.pay_schedules set claims_cutoff_day = 18 where business_id = $1`, [f.bizA]);
  await q(
    `insert into public.pay_schedules (business_id, name, is_default, claims_cutoff_day) values ($1, 'Monthly', true, 18) on conflict do nothing`,
    [f.bizA],
  );
  await q(
    `insert into public.transport_claims (business_id, employee_id, claim_date, route, description, amount, status)
     values ($1, $2, '2026-09-02', 'Malé to Hulhumalé', 'Ferry to site', 60, 'approved'),
            ($1, $2, '2026-09-05', 'Villingili to Malé', null, 30, 'pending')`,
    [f.bizA, f.empA.S1],
  );
  const cat = await q<{ id: string }>(
    `insert into public.expense_categories (business_id, name, max_amount) values ($1, 'Stationery', 500) returning id`,
    [f.bizA],
  );
  await q(
    `insert into public.expense_claims (business_id, employee_id, category_id, expense_date, amount, description, status, reimbursement_method)
     values ($1, $2, $3, '2026-09-03', 120, 'Printer paper', 'reimbursed', 'separate')`,
    [f.bizA, f.empA.S2, cat[0].id],
  );
  // Company B still has the old tool switches and an old permission.
  await q(`delete from public.business_modules where business_id = $1 and module_key = 'claims'`, [f.bizB]);
  await q(`insert into public.business_modules (business_id, module_key, enabled) values ($1, 'transport', true), ($1, 'expenses', false)`, [f.bizB]);
  const mgr = await q<{ id: string }>(`select id from public.roles where business_id = $1 and key = 'manager'`, [f.bizB]);
  await q(`delete from public.role_permissions where role_id = $1 and resource = 'claims'`, [mgr[0].id]);
  await q(
    `insert into public.role_permissions (business_id, role_id, resource, action, scope) values ($1, $2, 'transport_claims', 'approve', 'team'), ($1, $2, 'expenses', 'approve', 'own')`,
    [f.bizB, mgr[0].id],
  );

  await db.exec(`select private.migrate_legacy_tools(); select private.migrate_legacy_claims();`);
  // Running it again must not copy anything twice.
  await db.exec(`select private.migrate_legacy_tools(); select private.migrate_legacy_claims();`);
});

describe("moving old claims into Claims", () => {
  it("puts every old transport claim under the Transport type, keeping its details and status", async () => {
    const rows = await q<{ route: string; amount: string; status: string; type_key: string; legacy_source: string }>(
      `select c.route, c.amount, c.status, ct.key as type_key, c.legacy_source
         from public.claims c join public.claim_types ct on ct.id = c.claim_type_id
        where c.business_id = $1 and c.legacy_source = 'transport_claims' order by c.claim_date`,
      [f.bizA],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type_key === "transport")).toBe(true);
    expect(rows[0]).toMatchObject({ route: "Malé to Hulhumalé", status: "approved" });
    expect(Number(rows[0].amount)).toBe(60);
    expect(rows[1].status).toBe("pending");
  });

  it("turns old expense categories into claim types and keeps paid expenses as paid", async () => {
    const rows = await q<{ name: string; status: string; payout_method: string; max_amount: string }>(
      `select ct.name, c.status, c.payout_method, ct.max_amount
         from public.claims c join public.claim_types ct on ct.id = c.claim_type_id
        where c.business_id = $1 and c.legacy_source = 'expense_claims'`,
      [f.bizA],
    );
    expect(rows).toEqual([{ name: "Stationery", status: "paid", payout_method: "separate", max_amount: "500.00" }]);
  });

  it("copies nothing twice and deletes nothing", async () => {
    expect((await q(`select 1 from public.claims where business_id = $1`, [f.bizA])).length).toBe(3);
    expect((await q(`select 1 from public.transport_claims`)).length).toBe(2);
    expect((await q(`select 1 from public.expense_claims`)).length).toBe(1);
  });

  it("carries the old transport cut-off day over to the Transport type", async () => {
    const t = await q<{ cutoff_day: number }>(`select cutoff_day from public.claim_types where business_id = $1 and key = 'transport'`, [f.bizA]);
    expect(t[0].cutoff_day).toBe(18);
  });

  it("switches Claims on where Transport or Expenses was on, and removes the old switches", async () => {
    const mods = await q<{ module_key: string; enabled: boolean }>(`select module_key, enabled from public.business_modules where business_id = $1`, [
      f.bizB,
    ]);
    expect(mods.find((m) => m.module_key === "claims")?.enabled).toBe(true);
    expect(mods.some((m) => ["transport", "expenses"].includes(m.module_key))).toBe(false);
    expect((await q(`select 1 from public.claim_types where business_id = $1`, [f.bizB])).length).toBeGreaterThan(0);
  });

  it("gives roles the same access to Claims (the wider of the two old permissions)", async () => {
    const perms = await q<{ resource: string; action: string; scope: string }>(
      `select rp.resource, rp.action, rp.scope from public.role_permissions rp join public.roles r on r.id = rp.role_id
        where r.business_id = $1 and r.key = 'manager' and rp.resource in ('claims', 'transport_claims', 'expenses')`,
      [f.bizB],
    );
    expect(perms).toEqual([{ resource: "claims", action: "approve", scope: "team" }]);
  });
});

describe("who can see and submit claims", () => {
  const count = (who: string, sql: string, params: unknown[] = []) =>
    asUser(db, who, async (tx) => Number((await one<{ n: number }>(tx, `select count(*)::int as n from (${sql}) x`, params)).n));

  it("shows staff only their own claims and managers only their team's", async () => {
    expect(await count(f.users.staffA, `select 1 from public.claims`)).toBe(2);
    expect(await count(f.users.staffA2, `select 1 from public.claims`)).toBe(1);
    expect(await count(f.users.managerA, `select 1 from public.claims`)).toBe(2); // S1 reports to M; S2 doesn't
    expect(await count(f.users.payrollA, `select 1 from public.claims`)).toBe(3);
    expect(await count(f.users.ownerB, `select 1 from public.claims where business_id = $1`, [f.bizA])).toBe(0);
  });

  it("lets staff send a claim for themselves, only as pending", async () => {
    const type = await q<{ id: string }>(`select id from public.claim_types where business_id = $1 and key = 'meals'`, [f.bizA]);
    const insert = (who: string, emp: string, status: string) =>
      asUser(db, who, (tx) =>
        tx.query(
          `insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, status) values ($1, $2, $3, '2026-09-10', 45, $4)`,
          [f.bizA, emp, type[0].id, status],
        ),
      );
    await insert(f.users.staffA, f.empA.S1, "pending");
    await expect(insert(f.users.staffA, f.empA.S1, "approved")).rejects.toThrow(/row-level security/);
    await expect(insert(f.users.staffA, f.empA.S2, "pending")).rejects.toThrow(/row-level security/);
    const upd = await asUser(db, f.users.staffA, (tx) => tx.query(`update public.claims set status = 'approved' returning id`));
    expect(upd.rows).toHaveLength(0);
  });

  it("keeps the old claim tables read-only", async () => {
    await expect(
      asUser(db, f.users.staffA, (tx) =>
        tx.query(`insert into public.transport_claims (business_id, employee_id, claim_date, route, amount) values ($1, $2, '2026-09-11', 'x', 5)`, [
          f.bizA,
          f.empA.S1,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
