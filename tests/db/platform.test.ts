/**
 * Platform admin and subscriptions: plan status from the dates, paused
 * companies being read-only, companies not changing their own plan, admin
 * reports only for the server key, and support access leaving out pay.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const state = async (bid: string) => (await q<{ s: string }>(`select private.business_state($1) as s`, [bid]))[0].s;

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
});

describe("plan status", () => {
  it("follows the dates: trial, grace for 7 days after the end, then suspended", async () => {
    await db.query(`update public.businesses set plan_status = 'trial', trial_ends_at = now() + interval '3 days' where id = $1`, [f.bizB]);
    expect(await state(f.bizB)).toBe("trial");
    await db.query(`update public.businesses set trial_ends_at = now() - interval '2 days' where id = $1`, [f.bizB]);
    expect(await state(f.bizB)).toBe("grace");
    await db.query(`update public.businesses set trial_ends_at = now() - interval '8 days' where id = $1`, [f.bizB]);
    expect(await state(f.bizB)).toBe("suspended");
    await db.query(`update public.businesses set plan_status = 'active', paid_until = now() + interval '30 days' where id = $1`, [f.bizB]);
    expect(await state(f.bizB)).toBe("active");
  });

  it("companies can't change their own plan, dates or price", async () => {
    await expect(asUser(db, f.users.ownerA, (tx) => tx.query(`update public.businesses set paid_until = now() + interval '10 years' where id = $1`, [f.bizA]))).rejects.toThrow(/Only Harbor/);
    await expect(asUser(db, f.users.ownerA, (tx) => tx.query(`update public.businesses set plan_status = 'active' where id = $1`, [f.bizA]))).rejects.toThrow(/Only Harbor/);
    // Other company details still save.
    await asUser(db, f.users.ownerA, (tx) => tx.query(`update public.businesses set phone = '+960 111 1111' where id = $1`, [f.bizA]));
  });

  it("members can read their own plan, not other companies'", async () => {
    const mine = await asUser(db, f.users.staffA, (tx) => one<{ p: { status: string } | null }>(tx, `select public.my_plan($1) as p`, [f.bizA]));
    expect(mine.p?.status).toBeTruthy();
    const other = await asUser(db, f.users.staffA, (tx) => one<{ p: unknown }>(tx, `select public.my_plan($1) as p`, [f.bizB]));
    expect(other.p).toBeNull();
  });
});

describe("paused companies are read-only", () => {
  it("refuses changes from anyone in the company, but still lets them read", async () => {
    await db.query(`update public.businesses set plan_status = 'suspended' where id = $1`, [f.bizA]);
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`update public.employees set phone = '1' where id = $1`, [f.empA.S1]))).rejects.toThrow(/paused/);
    await expect(
      asUser(db, f.users.hrA, (tx) => tx.query(`insert into public.departments (business_id, name) values ($1, 'New team')`, [f.bizA])),
    ).rejects.toThrow(/paused/);
    await expect(asUser(db, f.users.ownerA, (tx) => tx.query(`update public.businesses set phone = '2' where id = $1`, [f.bizA]))).rejects.toThrow(/paused/);
    const seen = await asUser(db, f.users.hrA, async (tx) => (await tx.query(`select id from public.employees where business_id = $1`, [f.bizA])).rows.length);
    expect(seen).toBeGreaterThan(0);
  });

  it("still lets them export data, contact support and read notifications, and the other company is unaffected", async () => {
    await asUser(db, f.users.ownerA, (tx) => tx.query(`insert into public.data_exports (business_id) values ($1)`, [f.bizA]));
    await asUser(db, f.users.ownerA, (tx) => tx.query(`insert into public.support_tickets (business_id, created_by, subject, message) values ($1, auth.uid(), 'Help', 'Please reactivate')`, [f.bizA]));
    await asUser(db, f.users.ownerB, (tx) => tx.query(`insert into public.departments (business_id, name) values ($1, 'Bar')`, [f.bizB]));
  });

  it("the server key can still change things (Nuit Works reactivating)", async () => {
    await asService(db, (tx) => tx.query(`update public.businesses set plan_status = 'active', paid_until = now() + interval '1 month' where id = $1`, [f.bizA]));
    await asUser(db, f.users.hrA, (tx) => tx.query(`update public.employees set phone = '3' where id = $1`, [f.empA.S1]));
  });
});

describe("admin reports", () => {
  it("are refused to signed-in users, including owners", async () => {
    await expect(asUser(db, f.users.ownerA, (tx) => tx.query(`select public.admin_businesses()`))).rejects.toThrow(/permission denied|Not allowed/);
    await expect(asUser(db, f.users.ownerA, (tx) => tx.query(`select public.admin_business_detail($1)`, [f.bizA]))).rejects.toThrow(/permission denied|Not allowed/);
    await expect(asUser(db, f.users.ownerA, (tx) => tx.query(`select from public.platform_admin_notes`))).resolves.toBeTruthy();
    const notes = await asUser(db, f.users.ownerA, async (tx) => (await tx.query(`select 1 from public.platform_audit_log`)).rows.length);
    expect(notes).toBe(0);
  });

  it("work with the server key and never include salaries", async () => {
    const list = await asService(db, (tx) => one<{ r: { id: string; staff_count: number; owner: { email: string } }[] }>(tx, `select public.admin_businesses() as r`));
    const a = list.r.find((b) => b.id === f.bizA)!;
    expect(a.staff_count).toBeGreaterThan(0);
    const detail = await asService(db, (tx) => one<{ r: Record<string, unknown> }>(tx, `select public.admin_business_detail($1) as r`, [f.bizA]));
    expect(JSON.stringify(detail.r)).not.toMatch(/basic_salary|account_number|passport_no|national_id/);
  });

  it("owners see their own payment history, nobody else's", async () => {
    await asService(db, (tx) => tx.query(`insert into public.platform_payments (business_id, amount, paid_on, method) values ($1, 1500, current_date, 'bank_transfer')`, [f.bizA]));
    const own = await asUser(db, f.users.ownerA, async (tx) => (await tx.query(`select 1 from public.platform_payments`)).rows.length);
    const staff = await asUser(db, f.users.staffA, async (tx) => (await tx.query(`select 1 from public.platform_payments`)).rows.length);
    const other = await asUser(db, f.users.ownerB, async (tx) => (await tx.query(`select 1 from public.platform_payments`)).rows.length);
    expect([own, staff, other]).toEqual([1, 0, 0]);
    await expect(
      asUser(db, f.users.ownerA, (tx) => tx.query(`insert into public.platform_payments (business_id, amount, paid_on, method) values ($1, 1, current_date, 'cash')`, [f.bizA])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("support access", () => {
  it("shows the company read-only and leaves out pay", async () => {
    await db.query(`insert into public.platform_admins (user_id) values ($1) on conflict do nothing`, [f.users.support]);
    await asUser(db, f.users.ownerA, (tx) => tx.query(`insert into public.support_access_grants (business_id, expires_at) values ($1, now() + interval '1 day')`, [f.bizA]));
    const seen = await asUser(db, f.users.support, async (tx) => ({
      people: (await tx.query(`select 1 from public.employees where business_id = $1`, [f.bizA])).rows.length,
      pay: (await tx.query(`select 1 from public.employee_compensation where business_id = $1`, [f.bizA])).rows.length,
      list: (await tx.query<{ r: { business_id: string }[] }>(`select public.my_support_access() as r`)).rows[0].r.map((x) => x.business_id),
    }));
    expect(seen.people).toBeGreaterThan(0);
    expect(seen.pay).toBe(0);
    expect(seen.list).toContain(f.bizA);
    await expect(asUser(db, f.users.support, (tx) => tx.query(`update public.employees set phone = '9' where id = $1`, [f.empA.S1]))).resolves.toBeTruthy();
    expect((await q<{ phone: string }>(`select phone from public.employees where id = $1`, [f.empA.S1]))[0].phone).not.toBe("9");
  });

  it("the admin list is kept in line with the settings list", async () => {
    await asService(db, (tx) => tx.query(`select public.admin_sync_platform_admins($1)`, [["nobody@else.test"]]));
    expect(await q(`select 1 from public.platform_admins`)).toHaveLength(0);
    await expect(asUser(db, f.users.ownerA, (tx) => tx.query(`select public.admin_sync_platform_admins($1)`, [["owner.a@test.mv"]]))).rejects.toThrow(/permission denied|Not allowed/);
  });
});

describe("deleting a company", () => {
  it("works even with admin log entries, which keep the company name", async () => {
    const [b] = await q<{ id: string }>(`insert into public.businesses (name, slug, industry, country, currency, timezone, date_format) values ('Gone Cafe', 'gone-cafe', 'resort', 'MV', 'MVR', 'Indian/Maldives', 'DD/MM/YYYY') returning id`);
    await asService(db, (tx) => tx.query(`insert into public.platform_audit_log (admin_email, action, business_id, business_name) values ('a@b.c', 'note.add', $1, 'Gone Cafe')`, [b.id]));
    await asService(db, (tx) => tx.query(`delete from public.businesses where id = $1`, [b.id]));
    const [row] = await q<{ business_id: string | null; business_name: string }>(`select business_id, business_name from public.platform_audit_log where business_name = 'Gone Cafe'`);
    expect(row).toEqual({ business_id: null, business_name: "Gone Cafe" });
  });
});
