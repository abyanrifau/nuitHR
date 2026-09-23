/**
 * Phase 2 database functions: business profile, module switching (data is
 * kept), quick setup for each module, employee import, invitations and the
 * getting-started checklist.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";
import { MODULES } from "@/modules/registry";
import { normalizeSelection } from "@/modules/selection";
import { defaultSetup, SETUP_ORDER, type SetupModule } from "@/modules/setup-defaults";

let db: PGlite;
let f: Fixture;

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
});

const setModules = (who: string, biz: string, keys: string[]) =>
  asUser(db, who, (tx) => tx.query<{ r: string[] }>(`select public.set_business_modules($1, $2::text[]) as r`, [biz, keys]));

const count = async (who: string, sql: string, params: unknown[] = []) =>
  asUser(db, who, async (tx) => Number((await one<{ n: number }>(tx, `select count(*)::int as n from (${sql}) q`, params)).n));

describe("module catalog", () => {
  it("matches the module registry exactly (keys, core flags, requirements)", async () => {
    const rows = await db.query<{ key: string; is_core: boolean; requires: string[] }>(
      `select key, is_core, requires from private.module_catalog order by key`,
    );
    const fromDb = Object.fromEntries(rows.rows.map((r) => [r.key, { core: r.is_core, requires: [...r.requires].sort() }]));
    const fromRegistry = Object.fromEntries(MODULES.map((m) => [m.key, { core: m.core, requires: [...m.requires].sort() }]));
    expect(fromDb).toEqual(fromRegistry);
  });
});

describe("turning modules on and off", () => {
  it("keeps a module's data when it is switched off, and restores it when switched back on", async () => {
    await asUser(db, f.users.ownerA, (tx) =>
      tx.query(`insert into public.leave_types (business_id, name, code, entitlement_days) values ($1, 'Annual', 'AL', 30)`, [f.bizA]),
    );
    const withoutLeave = normalizeSelection(["attendance", "payroll", "claims"]);
    await setModules(f.users.ownerA, f.bizA, withoutLeave);
    const state = await asUser(db, f.users.ownerA, (tx) =>
      one<{ enabled: boolean }>(tx, `select enabled from public.business_modules where business_id = $1 and module_key = 'leave'`, [f.bizA]),
    );
    expect(state.enabled).toBe(false);
    expect(await count(f.users.ownerA, `select 1 from public.leave_types where business_id = $1`, [f.bizA])).toBe(1);

    await setModules(f.users.ownerA, f.bizA, normalizeSelection([...withoutLeave, "leave"]));
    const access = await asUser(db, f.users.ownerA, (tx) =>
      one<{ a: { business_id: string; modules: string[] }[] }>(tx, `select public.get_my_access() as a`),
    );
    expect(access.a.find((b) => b.business_id === f.bizA)?.modules).toContain("leave");
    expect(await count(f.users.ownerA, `select 1 from public.leave_types where business_id = $1`, [f.bizA])).toBe(1);
  });

  it("adds starter data the first time some modules are switched on", async () => {
    const r = await setModules(f.users.ownerA, f.bizA, normalizeSelection(["attendance", "leave", "payroll", "claims", "compliance", "onboarding"]));
    expect(r.rows[0].r.sort()).toEqual(["compliance", "onboarding"]);
    expect(await count(f.users.ownerA, `select 1 from public.compliance_types where business_id = $1`, [f.bizA])).toBe(6);
    expect(await count(f.users.ownerA, `select 1 from public.claim_types where business_id = $1 and key = 'transport'`, [f.bizA])).toBe(1);
    expect(await count(f.users.ownerA, `select 1 from public.checklist_templates where business_id = $1`, [f.bizA])).toBe(2);
    // switching off and on again doesn't duplicate anything
    await setModules(f.users.ownerA, f.bizA, normalizeSelection(["attendance", "leave", "payroll", "claims"]));
    await setModules(f.users.ownerA, f.bizA, normalizeSelection(["attendance", "leave", "payroll", "claims", "compliance", "onboarding"]));
    expect(await count(f.users.ownerA, `select 1 from public.compliance_types where business_id = $1`, [f.bizA])).toBe(6);
  });

  it("refuses to switch off core modules, break dependencies, or accept unknown modules", async () => {
    const base = normalizeSelection(["payroll", "claims"]);
    await expect(
      setModules(
        f.users.ownerA,
        f.bizA,
        base.filter((k) => k !== "approvals"),
      ),
    ).rejects.toThrow(/foundation tools are always included/);
    // Claims no longer needs Payroll.
    await setModules(
      f.users.ownerA,
      f.bizA,
      base.filter((k) => k !== "payroll"),
    );
    // An older copy of the app sending the old keys still works: they become Claims.
    await setModules(f.users.ownerA, f.bizA, [...base.filter((k) => k !== "claims"), "transport", "expenses"]);
    const on = await asUser(db, f.users.ownerA, (tx) =>
      tx.query<{ module_key: string }>(`select module_key from public.business_modules where business_id = $1 and enabled`, [f.bizA]),
    );
    expect(on.rows.map((r) => r.module_key)).toContain("claims");
    expect(on.rows.map((r) => r.module_key)).not.toContain("transport");
    await expect(setModules(f.users.ownerA, f.bizA, [...base, "spaceship"])).rejects.toThrow(/Unknown tool/);
  });

  it("only lets people with module rights change modules", async () => {
    await expect(setModules(f.users.staffA, f.bizA, normalizeSelection([]))).rejects.toThrow(/permission/);
    await expect(setModules(f.users.hrA, f.bizA, normalizeSelection([]))).rejects.toThrow(/permission/);
    await expect(setModules(f.users.ownerB, f.bizA, normalizeSelection([]))).rejects.toThrow(/permission/);
  });
});

describe("quick setup (wizard step 4)", () => {
  const apply = (who: string, module: SetupModule, config: unknown, biz = f.bizA) =>
    asUser(db, who, (tx) => tx.query(`select public.apply_module_setup($1, $2, $3::jsonb)`, [biz, module, JSON.stringify(config)]));

  it("applies every module's default setup, and running it twice creates no duplicates", async () => {
    await setModules(f.users.ownerA, f.bizA, normalizeSelection(["attendance", "leave", "payroll", "claims", "performance"]));
    for (const mod of SETUP_ORDER as SetupModule[]) {
      const config = defaultSetup(mod, { industry: "guesthouse", country: "MV", today: new Date("2026-09-18") });
      await apply(f.users.ownerA, mod, config);
      await apply(f.users.ownerA, mod, config);
    }
    const n = (sql: string) => count(f.users.ownerA, sql, [f.bizA]);
    expect(await n(`select 1 from public.departments where business_id = $1 and name = 'Excursions'`)).toBe(1);
    expect(
      await n(
        `select 1 from public.positions p join public.departments d on d.id = p.department_id where p.business_id = $1 and d.name = 'Excursions'`,
      ),
    ).toBe(2);
    expect(await n(`select 1 from public.leave_types where business_id = $1`)).toBe(6);
    expect(await n(`select 1 from public.public_holidays where business_id = $1 and holiday_date = '2026-07-26'`)).toBe(1);
    expect(await n(`select 1 from public.shifts where business_id = $1`)).toBe(3);
    expect(await n(`select 1 from public.shifts where business_id = $1 and name = 'Night' and crosses_midnight`)).toBe(1);
    expect(await n(`select 1 from public.attendance_policies where business_id = $1 and is_default`)).toBe(1);
    expect(await n(`select 1 from public.pay_schedules where business_id = $1 and is_default`)).toBe(1);
    expect(await n(`select 1 from public.pension_schemes where business_id = $1 and is_active and employee_rate = 7`)).toBe(1);
    expect(
      await n(`select 1 from public.tax_brackets tb join public.tax_tables t on t.id = tb.tax_table_id where tb.business_id = $1 and t.is_active`),
    ).toBe(5);
    // The 6 from the setup answers, plus the unapproved absence deduction every payroll company gets.
    expect(await n(`select 1 from public.pay_components where business_id = $1`)).toBe(7);
    expect(await n(`select 1 from public.account_codes where business_id = $1 and mapping_key = 'net_pay_payable'`)).toBe(1);
    expect(await n(`select 1 from public.review_cycles where business_id = $1`)).toBe(1);
    expect(await n(`select 1 from public.review_questions where business_id = $1`)).toBe(5);
    expect(await n(`select 1 from public.business_modules where business_id = $1 and setup_completed_at is not null`)).toBe(5);
  });

  it("sets the transport cut-off through the old key too (it now lives on the Transport claim type)", async () => {
    await apply(f.users.ownerA, "transport" as SetupModule, { claims_cutoff_day: 25 });
    expect(
      await count(f.users.ownerA, `select 1 from public.claim_types where business_id = $1 and key = 'transport' and cutoff_day = 25`, [f.bizA]),
    ).toBe(1);
  });

  it("needs the tool switched on first", async () => {
    await expect(apply(f.users.ownerB, "payroll", defaultSetup("payroll", { industry: "restaurant", country: "MV" }), f.bizB)).rejects.toThrow(
      /Switch the tool on first/,
    );
  });

  it("can apply starting settings without ticking the checklist", async () => {
    await setModules(f.users.ownerB, f.bizB, normalizeSelection(["attendance", "leave"]));
    await asUser(db, f.users.ownerB, (tx) =>
      tx.query(`select public.apply_module_setup($1, 'leave', $2::jsonb, false)`, [
        f.bizB,
        JSON.stringify(defaultSetup("leave", { industry: "restaurant", country: "MV" })),
      ]),
    );
    const c = await asUser(db, f.users.ownerB, (tx) =>
      one<{ c: Record<string, boolean> }>(tx, `select public.get_setup_checklist($1) as c`, [f.bizB]),
    );
    expect(c.c["leave.types"]).toBe(false);
    expect(await count(f.users.ownerB, `select 1 from public.leave_types where business_id = $1`, [f.bizB])).toBe(6);
  });

  it("checks permissions per module", async () => {
    const payroll = defaultSetup("payroll", { industry: "guesthouse", country: "MV" });
    await expect(apply(f.users.hrA, "payroll", payroll)).rejects.toThrow(/permission/);
    await expect(apply(f.users.staffA, "leave", { leave_types: [] })).rejects.toThrow(/permission/);
    await expect(apply(f.users.ownerB, "leave", { leave_types: [] })).rejects.toThrow(/permission/);
    await apply(f.users.payrollA, "payroll", payroll); // payroll officer is allowed
  });
});

describe("business profile & branches", () => {
  const save = (who: string, branches: unknown[], profile: Record<string, unknown> = {}) =>
    asUser(db, who, (tx) =>
      tx.query(`select public.save_business_profile($1, $2::jsonb, $3::jsonb)`, [
        f.bizA,
        JSON.stringify({ name: "Lagoon Guesthouse", industry: "guesthouse", address: "Majeedhee Magu, Male'", phone: "+9603001234", ...profile }),
        JSON.stringify(branches),
      ]),
    );

  it("saves the profile and syncs branches (unused ones are removed, used ones are kept but deactivated)", async () => {
    const before = await asUser(db, f.users.ownerA, (tx) =>
      tx.query<{ id: string; name: string }>(`select id, name from public.branches where business_id = $1`, [f.bizA]),
    );
    const male = before.rows.find((b) => b.name === "Male Office")!;
    await save(f.users.ownerA, [{ id: male.id, name: "Malé Office" }, { name: "Resort Island", atoll_island: "Baa Atoll" }, { name: "Spare" }]);
    await save(f.users.ownerA, [
      { id: male.id, name: "Malé Office" },
      { name: "Resort Island", atoll_island: "Baa Atoll" },
    ]);
    const rows = await asUser(db, f.users.ownerA, (tx) =>
      tx.query<{ name: string; is_active: boolean }>(`select name, is_active from public.branches where business_id = $1 order by name`, [f.bizA]),
    );
    expect(rows.rows).toEqual([
      { name: "Malé Office", is_active: true },
      { name: "Resort Island", is_active: true },
    ]);
    // Malé Office is used by employees; removing it from the list deactivates rather than deletes.
    await save(f.users.ownerA, [{ name: "Resort Island" }]);
    const male2 = await asUser(db, f.users.ownerA, (tx) =>
      one<{ is_active: boolean }>(tx, `select is_active from public.branches where id = $1`, [male.id]),
    );
    expect(male2.is_active).toBe(false);
    await save(f.users.ownerA, [{ id: male.id, name: "Malé Office" }, { name: "Resort Island" }]);
  });

  it("requires a branch, and refuses people without settings rights", async () => {
    await expect(save(f.users.ownerA, [])).rejects.toThrow(/at least one branch/);
    await expect(save(f.users.hrA, [{ name: "X" }])).rejects.toThrow(/permission/);
    await expect(save(f.users.ownerB, [{ name: "X" }])).rejects.toThrow(/permission/);
  });
});

describe("employee import", () => {
  const importRows = (who: string, rows: unknown[]) =>
    asUser(db, who, (tx) =>
      one<{ r: { employee_code: string; id: string }[] }>(tx, `select public.import_employees($1, $2::jsonb) as r`, [f.bizA, JSON.stringify(rows)]),
    );

  it("creates employees, missing departments/positions, IDs and reporting lines in one go", async () => {
    const r = await importRows(f.users.hrA, [
      {
        first_name: "Ahmed",
        last_name: "Naseem",
        department: "Excursions",
        position: "Dive Instructor",
        branch: "Resort Island",
        manager_code: "MGR9",
      },
      {
        employee_code: "MGR9",
        first_name: "Mariyam",
        department: "Spa",
        position: "Spa Manager",
        join_date: "2025-01-05",
        nationality: "LK",
        is_expatriate: true,
      },
    ]);
    expect(r.r).toHaveLength(2);
    expect(r.r[0].employee_code).toMatch(/^E\d{4}$/);
    const ahmed = await asUser(db, f.users.hrA, (tx) =>
      one<{ mgr: string; dept: string; pos: string }>(
        tx,
        `select m.employee_code as mgr, d.name as dept, p.title as pos from public.employees e
           join public.employees m on m.id = e.manager_id join public.departments d on d.id = e.department_id
           join public.positions p on p.id = e.position_id where e.id = $1`,
        [r.r[0].id],
      ),
    );
    expect(ahmed).toEqual({ mgr: "MGR9", dept: "Excursions", pos: "Dive Instructor" });
    expect(await count(f.users.hrA, `select 1 from public.departments where business_id = $1 and name = 'Spa'`, [f.bizA])).toBe(1);
  });

  it("saves nothing if any row fails", async () => {
    const before = await count(f.users.hrA, `select 1 from public.employees where business_id = $1`, [f.bizA]);
    await expect(importRows(f.users.hrA, [{ first_name: "Ok" }, { first_name: "Bad", branch: "Nowhere" }])).rejects.toThrow(
      /Row 2: branch "Nowhere"/,
    );
    await expect(importRows(f.users.hrA, [{ first_name: "Dup", employee_code: "MGR9" }])).rejects.toThrow(/already used/);
    await expect(importRows(f.users.hrA, [{ first_name: "Lost", manager_code: "NOPE" }])).rejects.toThrow(/manager ID "NOPE"/);
    expect(await count(f.users.hrA, `select 1 from public.employees where business_id = $1`, [f.bizA])).toBe(before);
  });

  it("is blocked for staff and other businesses", async () => {
    await expect(importRows(f.users.staffA, [{ first_name: "X" }])).rejects.toThrow(/row-level security/);
    await expect(importRows(f.users.ownerB, [{ first_name: "X" }])).rejects.toThrow(/row-level security/);
  });
});

describe("invitations", () => {
  const hash = (t: string) => createHash("sha256").update(t).digest("hex");
  const invite = (who: string, email: string, roleKey: string, token: string, extra = "") =>
    asUser(db, who, (tx) =>
      tx.query(
        `insert into public.invitations (business_id, email, role_id, token_hash${extra ? ", expires_at" : ""})
         values ($1, $2, (select id from public.roles where business_id = $1 and key = $3), $4${extra ? ", " + extra : ""})`,
        [f.bizA, email, roleKey, hash(token)],
      ),
    );

  it("lets a new person join with the right role through their link", async () => {
    await invite(f.users.hrA, "newhire@test.mv", "employee", "tok-good");
    const preview = await asUser(db, null, (tx) =>
      one<{ p: { business_name: string; status: string } }>(tx, `select public.get_invitation_preview('tok-good') as p`),
    );
    expect(preview.p).toMatchObject({ business_name: "Lagoon Guesthouse", status: "valid" });

    const newbie = await createUser(db, "NewHire@test.mv");
    const biz = await asUser(db, newbie, (tx) => one<{ b: string }>(tx, `select public.accept_invitation('tok-good') as b`));
    expect(biz.b).toBe(f.bizA);
    const access = await asUser(db, newbie, (tx) => one<{ a: { role_key: string }[] }>(tx, `select public.get_my_access() as a`));
    expect(access.a[0].role_key).toBe("employee");
    // accepting twice is harmless
    await asUser(db, newbie, (tx) => tx.query(`select public.accept_invitation('tok-good')`));
  });

  it("rejects the wrong email, used, expired or unknown links", async () => {
    await invite(f.users.hrA, "someone@test.mv", "employee", "tok-email");
    await expect(asUser(db, f.users.outsider, (tx) => tx.query(`select public.accept_invitation('tok-email')`))).rejects.toThrow(
      /sent to someone@test.mv/,
    );
    await expect(asUser(db, f.users.outsider, (tx) => tx.query(`select public.accept_invitation('tok-good')`))).rejects.toThrow(/already been used/);
    await invite(f.users.hrA, "outsider@test.mv", "employee", "tok-old", "now() - interval '1 day'");
    await expect(asUser(db, f.users.outsider, (tx) => tx.query(`select public.accept_invitation('tok-old')`))).rejects.toThrow(/expired/);
    await expect(asUser(db, f.users.outsider, (tx) => tx.query(`select public.accept_invitation('nope')`))).rejects.toThrow(/isn't valid/);
    const unknown = await asUser(db, null, (tx) => one<{ p: unknown }>(tx, `select public.get_invitation_preview('nope') as p`));
    expect(unknown.p).toBeNull();
  });

  it("only owners can invite owners", async () => {
    await expect(invite(f.users.accountant, "boss@test.mv", "owner", "tok-owner")).rejects.toThrow(/Only an owner/);
    await invite(f.users.ownerA, "coowner@test.mv", "owner", "tok-owner2");
  });

  it("hides invitations from staff", async () => {
    expect(await count(f.users.staffA, `select 1 from public.invitations`)).toBe(0);
    expect(await count(f.users.ownerB, `select 1 from public.invitations`)).toBe(0);
  });
});

describe("getting-started checklist", () => {
  it("reports what's done, and reveals nothing to outsiders", async () => {
    const c = await asUser(db, f.users.ownerA, (tx) =>
      one<{ c: Record<string, boolean> }>(tx, `select public.get_setup_checklist($1) as c`, [f.bizA]),
    );
    expect(c.c["org.departments"]).toBe(true);
    expect(c.c["employees.first"]).toBe(true);
    expect(c.c["leave.types"]).toBe(true);
    expect(c.c["learning.course"]).toBe(false);
    const outsider = await asUser(db, f.users.ownerB, (tx) =>
      one<{ c: Record<string, boolean> }>(tx, `select public.get_setup_checklist($1) as c`, [f.bizA]),
    );
    expect(outsider.c).toEqual({});
  });
});
