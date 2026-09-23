/**
 * Celebrations on Home: everyone in the company sees birthdays (day and
 * month only), anniversaries and new joiners; hidden birthdays stay hidden;
 * admins can switch the card off; other companies see nothing.
 * Pictures: set by HR and admins, never by staff themselves.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";

let db: PGlite;
let f: Fixture;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

type Card = {
  enabled: boolean;
  birthdays?: { employee_id: string; day: number; month: number }[];
  anniversaries?: { employee_id: string; years: number }[];
  joiners?: { employee_id: string }[];
};
const card = (user: string, bid: string) => asUser(db, user, (tx) => one<{ r: Card }>(tx, `select public.celebrations($1) as r`, [bid])).then((x) => x.r);

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
  const [{ today }] = await q<{ today: string }>(`select private.biz_today($1)::text as today`, [f.bizA]);
  // S1: birthday in two days (born 1990), joined three years ago today + 3 days.
  await q(
    `update public.employees set date_of_birth = ($2::date + 2) - interval '36 years', join_date = ($2::date + 3) - interval '3 years', status = 'active' where id = $1`,
    [f.empA.S1, today],
  );
  // S2: joined a week ago, birthday next month.
  await q(`update public.employees set date_of_birth = ($2::date + 40) - interval '30 years', join_date = $2::date - 7, status = 'active' where id = $1`, [
    f.empA.S2,
    today,
  ]);
});

describe("celebrations", () => {
  it("shows staff their colleagues' birthdays, without the year", async () => {
    const c = await card(f.users.staffA2, f.bizA);
    const b = c.birthdays!.find((x) => x.employee_id === f.empA.S1)!;
    expect(b).toBeTruthy();
    expect(b.day).toBeGreaterThan(0);
    expect(JSON.stringify(c)).not.toMatch(/date_of_birth|19\d\d-\d\d-\d\d/);
    expect(c.birthdays!.some((x) => x.employee_id === f.empA.S2)).toBe(false);
  });

  it("lists anniversaries with the number of years, and new joiners", async () => {
    const c = await card(f.users.staffA, f.bizA);
    expect(c.anniversaries!.find((x) => x.employee_id === f.empA.S1)?.years).toBe(3);
    expect(c.joiners!.some((x) => x.employee_id === f.empA.S2)).toBe(true);
  });

  it("leaves out a birthday the person has hidden", async () => {
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.set_my_birthday_hidden($1, true)`, [f.bizA]));
    const c = await card(f.users.staffA2, f.bizA);
    expect(c.birthdays!.some((x) => x.employee_id === f.empA.S1)).toBe(false);
    await asUser(db, f.users.staffA, (tx) => tx.query(`select public.set_my_birthday_hidden($1, false)`, [f.bizA]));
  });

  it("shows nothing when the company switches the card off", async () => {
    await q(`update public.businesses set celebrations_enabled = false where id = $1`, [f.bizA]);
    expect(await card(f.users.staffA, f.bizA)).toEqual({ enabled: false });
    await q(`update public.businesses set celebrations_enabled = true where id = $1`, [f.bizA]);
  });

  it("is refused to people from another company", async () => {
    await expect(card(f.users.ownerB, f.bizA)).rejects.toThrow(/Not allowed/);
  });
});

describe("pictures", () => {
  it("are not set by staff themselves", async () => {
    const own = `users/${f.users.staffA}/0b1c2d3e-4f50-4617-8899-aabbccddeeff.webp`;
    await expect(asUser(db, f.users.staffA, (tx) => tx.query(`select public.set_my_photo($1, $2)`, [f.bizA, own]))).rejects.toThrow(/HR team/);
  });

  it("can be set by HR for themselves, only from their own folder", async () => {
    const own = `users/${f.users.hrA}/0b1c2d3e-4f50-4617-8899-aabbccddeeff.webp`;
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.set_my_photo($1, $2)`, [f.bizA, own]))).resolves.toBeTruthy();
    const someoneElses = `users/${f.users.ownerA}/0b1c2d3e-4f50-4617-8899-aabbccddeeff.webp`;
    await expect(asUser(db, f.users.hrA, (tx) => tx.query(`select public.set_my_photo($1, $2)`, [f.bizA, someoneElses]))).rejects.toThrow(/Not allowed/);
  });
});

describe("one person's time off balances", () => {
  it("are shown to their manager and HR, not to a colleague", async () => {
    const as = (u: string) => asUser(db, u, (tx) => tx.query(`select * from public.employee_leave_balances($1, $2)`, [f.bizA, f.empA.S1]));
    await expect(as(f.users.hrA)).resolves.toBeTruthy();
    await expect(as(f.users.managerA)).resolves.toBeTruthy();
    await expect(as(f.users.staffA2)).rejects.toThrow(/permission/);
  });
});
