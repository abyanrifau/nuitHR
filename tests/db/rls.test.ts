/**
 * Security tests for the database: tenant isolation, role permissions,
 * salary privacy, privilege-escalation guards, audit trail, payroll locks,
 * support access and file storage rules.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb, migrationFiles, MIGRATIONS_DIR, type TxLike } from "./harness";
import { buildFixture, one, type Fixture } from "./fixtures";
import { allResources } from "@/modules/registry";

let db: PGlite;
let f: Fixture;

beforeAll(async () => {
  db = await createTestDb();
  f = await buildFixture(db);
});

const count = async (tx: TxLike, sql: string, params: unknown[] = []) =>
  Number((await one<{ n: number }>(tx, `select count(*)::int as n from (${sql}) q`, params)).n);

async function expectDenied(p: Promise<unknown>, match?: RegExp) {
  await expect(p).rejects.toThrow(match ?? /row-level security|permission denied|42501|violates|cannot|only|must/i);
}

// ---------------------------------------------------------------------
describe("schema safety net", () => {
  it("has Row Level Security switched on for every public table, with at least one policy", async () => {
    const rows = await db.query<{ relname: string; rls: boolean; policies: number }>(`
      select c.relname, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`);
    expect(rows.rows.length).toBeGreaterThan(90);
    for (const r of rows.rows) {
      expect(r.rls, `${r.relname} RLS`).toBe(true);
      // contact_messages is written by the server only; no one may read it through the API.
      if (r.relname !== "contact_messages") expect(r.policies, `${r.relname} policies`).toBeGreaterThan(0);
    }
  });

  it("gives every business-data table a NOT NULL business_id (except the audit log)", async () => {
    const rows = await db.query<{ table_name: string; is_nullable: string }>(`
      select table_name, is_nullable from information_schema.columns
       where table_schema = 'public' and column_name = 'business_id'`);
    for (const r of rows.rows) {
      // audit_log: sign-ins without a business; onboarding_drafts: a user's wizard before the business exists
      if (r.table_name === "audit_log" || r.table_name === "onboarding_drafts") continue;
      expect(r.is_nullable, r.table_name).toBe("NO");
    }
  });

  it("gives every public table with business data a business_id column", async () => {
    const rows = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and not exists (select 1 from information_schema.columns col
                          where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'business_id')`);
    // Only per-user / platform tables may lack business_id.
    expect(rows.rows.map((r) => r.relname).sort()).toEqual(["businesses", "contact_messages", "platform_admins", "profiles"]);
  });

  it("only uses permission resources that exist in the module registry", () => {
    const known = new Set(allResources().map((r) => r.key));
    const used = new Set<string>();
    for (const file of migrationFiles()) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      for (const m of sql.matchAll(/private\.(?:biz_all|biz_with|emp_scope|self_scope|team_scope|std_rls)\(\s*'([a-z_]+)'(?:\s*,\s*'([a-z_]+)')?/g)) {
        // std_rls(table, resource, ...) - the resource is the second argument
        used.add(m[0].includes("std_rls") ? m[2] : m[1]);
      }
      for (const m of sql.matchAll(/v_resource := '([a-z_]+)'/g)) used.add(m[1]);
      for (const m of sql.matchAll(/audit_row\('([a-z_]+)'/g)) used.add(m[1]);
    }
    // Resources from before Transport + Expense claims were merged into Claims (old migrations still mention them).
    const legacy = new Set(["transport_claims", "expenses"]);
    const unknown = [...used].filter((r) => !known.has(r) && !legacy.has(r));
    expect(unknown).toEqual([]);
  });
});

// ---------------------------------------------------------------------
describe("tenant isolation", () => {
  it("never shows another business's rows in ANY table", async () => {
    const tables = await db.query<{ table_name: string }>(`
      select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'business_id'`);
    for (const who of [f.users.ownerB, f.users.staffB, f.users.outsider]) {
      await asUser(db, who, async (tx) => {
        for (const { table_name } of tables.rows) {
          const n = await count(tx, `select 1 from public.${table_name} where business_id = $1`, [f.bizA]);
          expect(n, `${table_name} leaked to another tenant`).toBe(0);
        }
        expect(await count(tx, `select 1 from public.businesses where id = $1`, [f.bizA])).toBe(0);
      });
    }
  });

  it("shows anonymous visitors nothing", async () => {
    await asUser(db, null, async (tx) => {
      expect(await count(tx, `select 1 from public.employees`)).toBe(0);
      expect(await count(tx, `select 1 from public.businesses`)).toBe(0);
    });
  });

  it("blocks writing into another business", async () => {
    await expectDenied(
      asUser(db, f.users.ownerB, (tx) =>
        tx.query(`insert into public.employees (business_id, employee_code, first_name) values ($1, 'HACK', 'Hacker')`, [f.bizA]),
      ),
    );
    const updated = await asUser(db, f.users.ownerB, (tx) =>
      tx.query(`update public.employees set first_name = 'Hacked' where business_id = $1 returning id`, [f.bizA]),
    );
    expect(updated.rows).toHaveLength(0);
    const deleted = await asUser(db, f.users.ownerB, (tx) => tx.query(`delete from public.employees where business_id = $1 returning id`, [f.bizA]));
    expect(deleted.rows).toHaveLength(0);
  });

  it("blocks linking a record to another business's data (composite foreign keys)", async () => {
    await expectDenied(
      asUser(db, f.users.ownerB, (tx) =>
        tx.query(`insert into public.employees (business_id, employee_code, first_name, department_id) values ($1, 'B999', 'X', $2)`, [
          f.bizB,
          f.deptA.ops,
        ]),
      ),
      /foreign key/,
    );
  });

  it("blocks moving a record to another business, even for someone in both", async () => {
    await expectDenied(
      asUser(db, f.users.accountant, (tx) => tx.query(`update public.departments set business_id = $1 where id = $2`, [f.bizB, f.deptA.kitchen])),
    );
  });

  it("lets a person who belongs to two businesses see both, and switch between them", async () => {
    await asUser(db, f.users.accountant, async (tx) => {
      const access = await one<{ a: { business_id: string }[] }>(tx, `select public.get_my_access() as a`);
      expect(access.a.map((b) => b.business_id).sort()).toEqual([f.bizA, f.bizB].sort());
      expect(await count(tx, `select 1 from public.employees where business_id = $1`, [f.bizA])).toBe(3);
      expect(await count(tx, `select 1 from public.employees where business_id = $1`, [f.bizB])).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------
describe("roles and scopes", () => {
  it("managers see only themselves and their team", async () => {
    await asUser(db, f.users.managerA, async (tx) => {
      const ids = (await tx.query<{ id: string }>(`select id from public.employees`)).rows.map((r) => r.id).sort();
      expect(ids).toEqual([f.empA.M, f.empA.S1].sort());
    });
  });

  it("staff see only their own employee record", async () => {
    await asUser(db, f.users.staffA, async (tx) => {
      const ids = (await tx.query<{ id: string }>(`select id from public.employees`)).rows.map((r) => r.id);
      expect(ids).toEqual([f.empA.S1]);
    });
  });

  it("department heads see their whole department", async () => {
    await asUser(db, f.users.ownerA, (tx) =>
      tx.query(`update public.departments set head_employee_id = $1 where id = $2`, [f.empA.M, f.deptA.kitchen]),
    );
    await asUser(db, f.users.managerA, async (tx) => {
      expect(await count(tx, `select 1 from public.employees where id = $1`, [f.empA.S2])).toBe(1);
    });
    await asUser(db, f.users.ownerA, (tx) => tx.query(`update public.departments set head_employee_id = null where id = $1`, [f.deptA.kitchen]));
  });

  it("everyone in the business can read reference data (departments, leave types)", async () => {
    await asUser(db, f.users.staffA, async (tx) => {
      expect(await count(tx, `select 1 from public.departments`)).toBe(2);
    });
  });

  it("staff cannot edit their own job details", async () => {
    const r = await asUser(db, f.users.staffA, (tx) =>
      tx.query(`update public.employees set status = 'terminated' where id = $1 returning id`, [f.empA.S1]),
    );
    expect(r.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe("salary privacy", () => {
  const salaries = (who: string) =>
    asUser(db, who, async (tx) =>
      (await tx.query<{ employee_id: string }>(`select employee_id from public.employee_compensation`)).rows.map((r) => r.employee_id),
    );

  it("owner and payroll officer see all salaries", async () => {
    expect(await salaries(f.users.ownerA)).toHaveLength(3);
    expect(await salaries(f.users.payrollA)).toHaveLength(3);
  });

  it("HR manager and admin see no salaries", async () => {
    expect(await salaries(f.users.hrA)).toHaveLength(0);
    // accountant is admin in both businesses
    expect(await salaries(f.users.accountant)).toHaveLength(0);
  });

  it("managers see only their own salary, not their team's", async () => {
    expect(await salaries(f.users.managerA)).toEqual([f.empA.M]);
  });

  it("staff see only their own salary", async () => {
    expect(await salaries(f.users.staffA)).toEqual([f.empA.S1]);
  });

  it("only the owner can grant salary access to a role", async () => {
    const grantAll = `insert into public.role_permissions (business_id, role_id, resource, action, scope)
                      values ($1, $2, 'compensation', 'view', 'all')
                      on conflict (role_id, resource, action) do update set scope = excluded.scope`;
    await expectDenied(asUser(db, f.users.accountant, (tx) => tx.query(grantAll, [f.bizA, f.roleA.hr_manager])));
    await asUser(db, f.users.ownerA, (tx) => tx.query(grantAll, [f.bizA, f.roleA.hr_manager]));
    expect(await salaries(f.users.hrA)).toHaveLength(3);
    await asUser(db, f.users.ownerA, (tx) =>
      tx.query(`update public.role_permissions set scope = 'own' where role_id = $1 and resource = 'compensation' and action = 'view'`, [
        f.roleA.hr_manager,
      ]),
    );
    expect(await salaries(f.users.hrA)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe("privilege-escalation guards", () => {
  it("an admin cannot make themselves owner", async () => {
    await expectDenied(
      asUser(db, f.users.accountant, (tx) =>
        tx.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [
          f.roleA.owner,
          f.bizA,
          f.users.accountant,
        ]),
      ),
    );
  });

  it("an admin cannot promote someone else to owner", async () => {
    await expectDenied(
      asUser(db, f.users.accountant, (tx) =>
        tx.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [f.roleA.owner, f.bizA, f.users.hrA]),
      ),
    );
  });

  it("an admin cannot create a role flagged as owner", async () => {
    await expectDenied(
      asUser(db, f.users.accountant, (tx) =>
        tx.query(`insert into public.roles (business_id, name, is_owner) values ($1, 'Sneaky', true)`, [f.bizA]),
      ),
    );
  });

  it("built-in roles cannot be deleted", async () => {
    await expectDenied(asUser(db, f.users.ownerA, (tx) => tx.query(`delete from public.roles where id = $1`, [f.roleA.hr_manager])));
  });

  it("the last owner cannot be removed or demoted", async () => {
    await expectDenied(
      asUser(db, f.users.ownerA, (tx) =>
        tx.query(`delete from public.business_members where business_id = $1 and user_id = $2`, [f.bizA, f.users.ownerA]),
      ),
    );
    await expectDenied(
      asUser(db, f.users.ownerA, (tx) =>
        tx.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [f.roleA.admin, f.bizA, f.users.ownerA]),
      ),
    );
  });

  it("staff cannot add themselves to another business", async () => {
    const roleB = await asUser(db, f.users.ownerB, (tx) =>
      one<{ id: string }>(tx, `select id from public.roles where business_id = $1 and key = 'admin'`, [f.bizB]),
    );
    await expectDenied(
      asUser(db, f.users.staffA, (tx) =>
        tx.query(`insert into public.business_members (business_id, user_id, role_id) values ($1, $2, $3)`, [f.bizB, f.users.staffA, roleB.id]),
      ),
    );
  });

  it("create_business refuses anonymous callers", async () => {
    await expectDenied(
      asUser(db, null, (tx) => tx.query(`select public.create_business('{"name":"X"}'::jsonb)`)),
      /permission denied|signed in/,
    );
  });
});

// ---------------------------------------------------------------------
describe("self-service requests", () => {
  let leaveType: string;

  beforeAll(async () => {
    leaveType = await asUser(
      db,
      f.users.ownerA,
      async (tx) =>
        (
          await one<{ id: string }>(
            tx,
            `insert into public.leave_types (business_id, name, code, entitlement_days) values ($1, 'Annual leave', 'AL', 30) returning id`,
            [f.bizA],
          )
        ).id,
    );
  });

  const apply = (who: string, employee: string, status = "pending") =>
    asUser(db, who, (tx) =>
      tx.query(
        `insert into public.leave_requests (business_id, employee_id, leave_type_id, start_date, end_date, days, status)
         values ($1, $2, $3, '2026-10-01', '2026-10-02', 2, $4) returning id`,
        [f.bizA, employee, leaveType, status],
      ),
    );

  it("staff can apply for their own leave", async () => {
    const r = await apply(f.users.staffA, f.empA.S1);
    expect(r.rows).toHaveLength(1);
  });

  it("staff cannot apply for someone else, or approve their own leave", async () => {
    await expectDenied(apply(f.users.staffA, f.empA.S2));
    await expectDenied(apply(f.users.staffA, f.empA.S1, "approved"));
  });

  it("staff cannot approve by editing their request", async () => {
    const r = await asUser(db, f.users.staffA, (tx) => tx.query(`update public.leave_requests set status = 'approved' returning id`));
    expect(r.rows).toHaveLength(0);
  });

  it("managers see their team's leave; other staff don't", async () => {
    await asUser(db, f.users.managerA, async (tx) => expect(await count(tx, `select 1 from public.leave_requests`)).toBe(1));
    await asUser(db, f.users.staffA2, async (tx) => expect(await count(tx, `select 1 from public.leave_requests`)).toBe(0));
  });
});

// ---------------------------------------------------------------------
describe("audit trail", () => {
  it("records salary changes with who, what and when", async () => {
    await asUser(db, f.users.payrollA, (tx) =>
      tx.query(`update public.employee_compensation set basic_salary = 13000 where employee_id = $1`, [f.empA.S1]),
    );
    const rows = await asUser(db, f.users.ownerA, (tx) =>
      tx.query<{ actor_id: string; changes: Record<string, { from: unknown; to: unknown }> }>(
        `select actor_id, changes from public.audit_log where entity_type = 'employee_compensation' and action = 'update' and subject_employee_id = $1`,
        [f.empA.S1],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].actor_id).toBe(f.users.payrollA);
    expect(Number(rows.rows[0].changes.basic_salary.to)).toBe(13000);
  });

  it("does not reveal salary history to people who can't see salaries", async () => {
    await asUser(db, f.users.hrA, async (tx) => {
      expect(await count(tx, `select 1 from public.audit_log where entity_type = 'employee_compensation'`)).toBe(0);
      // but HR can see employee profile history
      expect(await count(tx, `select 1 from public.audit_log where entity_type = 'employees'`)).toBeGreaterThan(0);
    });
  });

  it("cannot be written or erased by users", async () => {
    await expectDenied(
      asUser(db, f.users.ownerA, (tx) => tx.query(`insert into public.audit_log (business_id, action) values ($1, 'fake')`, [f.bizA])),
    );
    const del = await asUser(db, f.users.ownerA, (tx) => tx.query(`delete from public.audit_log returning id`));
    expect(del.rows).toHaveLength(0);
  });

  it("records sign-ins in every business the user belongs to", async () => {
    await asUser(db, f.users.accountant, (tx) => tx.query(`select public.log_sign_in('1.2.3.4', 'test')`));
    const n = await asService(db, (tx) =>
      count(tx, `select 1 from public.audit_log where action = 'sign_in' and actor_id = $1`, [f.users.accountant]),
    );
    expect(n).toBe(2);
  });
});

// ---------------------------------------------------------------------
describe("payroll lock", () => {
  it("prevents changes to a finalized run, and allows reversal with a reason by authorized roles", async () => {
    const runId = await asUser(db, f.users.payrollA, async (tx) => {
      const run = await one<{ id: string }>(
        tx,
        `insert into public.payroll_runs (business_id, name, period_start, period_end, pay_date) values ($1, 'Sept 2026', '2026-09-01', '2026-09-30', '2026-09-28') returning id`,
        [f.bizA],
      );
      const pre = await one<{ id: string }>(
        tx,
        `insert into public.payroll_run_employees (business_id, run_id, employee_id, employee_name, gross_pay, net_pay) values ($1, $2, $3, 'Fathimath', 12000, 11160) returning id`,
        [f.bizA, run.id, f.empA.S1],
      );
      await tx.query(`update public.payroll_runs set status = 'finalized', finalized_at = now() where id = $1`, [run.id]);
      return { run: run.id, pre: pre.id };
    });

    await expectDenied(
      asUser(db, f.users.payrollA, (tx) => tx.query(`update public.payroll_run_employees set net_pay = 99999 where id = $1`, [runId.pre])),
      /locked/,
    );
    await expectDenied(
      asUser(db, f.users.payrollA, (tx) => tx.query(`update public.payroll_runs set total_net = 1 where id = $1`, [runId.run])),
      /locked/,
    );
    await expectDenied(
      asUser(db, f.users.payrollA, (tx) => tx.query(`delete from public.payroll_runs where id = $1`, [runId.run])),
      /cannot be deleted/,
    );
    await expectDenied(
      asUser(db, f.users.payrollA, (tx) => tx.query(`update public.payroll_runs set status = 'reversed' where id = $1`, [runId.run])),
      /reversal_reason|check constraint/,
    );

    // Payslip becomes visible to the employee once published (allowed after finalization).
    await asUser(db, f.users.staffA, async (tx) => expect(await count(tx, `select 1 from public.payroll_run_employees`)).toBe(0));
    await asUser(db, f.users.payrollA, (tx) =>
      tx.query(`update public.payroll_run_employees set payslip_published_at = now() where id = $1`, [runId.pre]),
    );
    await asUser(db, f.users.staffA, async (tx) => expect(await count(tx, `select 1 from public.payroll_run_employees`)).toBe(1));
    await asUser(db, f.users.staffA2, async (tx) => expect(await count(tx, `select 1 from public.payroll_run_employees`)).toBe(0));

    await asUser(db, f.users.payrollA, (tx) =>
      tx.query(`update public.payroll_runs set status = 'reversed', reversal_reason = 'Wrong overtime rate', reversed_at = now() where id = $1`, [
        runId.run,
      ]),
    );
  });

  it("HR managers cannot see payroll runs at all", async () => {
    await asUser(db, f.users.hrA, async (tx) => expect(await count(tx, `select 1 from public.payroll_runs`)).toBe(0));
  });
});

// ---------------------------------------------------------------------
describe("support access", () => {
  it("vendor support sees nothing without a grant, read-only with one, and nothing after expiry", async () => {
    await asUser(db, f.users.support, async (tx) => expect(await count(tx, `select 1 from public.employees`)).toBe(0));

    const grant = await asUser(db, f.users.ownerA, (tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.support_access_grants (business_id, reason, expires_at) values ($1, 'Help with payroll', now() + interval '2 hours') returning id`,
        [f.bizA],
      ),
    );
    await asUser(db, f.users.support, async (tx) => {
      expect(await count(tx, `select 1 from public.employees where business_id = $1`, [f.bizA])).toBe(3);
      expect(await count(tx, `select 1 from public.employees where business_id = $1`, [f.bizB])).toBe(0);
    });
    const upd = await asUser(db, f.users.support, (tx) =>
      tx.query(`update public.employees set first_name = 'X' where business_id = $1 returning id`, [f.bizA]),
    );
    expect(upd.rows).toHaveLength(0);

    await asUser(db, f.users.ownerA, (tx) =>
      tx.query(`update public.support_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [grant.id]),
    );
    await asUser(db, f.users.support, async (tx) => expect(await count(tx, `select 1 from public.employees`)).toBe(0));
  });
});

// ---------------------------------------------------------------------
describe("file storage rules", () => {
  const canFile = (who: string, name: string, action: string) =>
    asUser(db, who, async (tx) => (await one<{ ok: boolean }>(tx, `select private.storage_can($1, $2) as ok`, [name, action])).ok);

  it("lets staff read their own payslip file but not a colleague's", async () => {
    expect(await canFile(f.users.staffA, `${f.bizA}/payslips/${f.empA.S1}/2026-09.pdf`, "view")).toBe(true);
    expect(await canFile(f.users.staffA, `${f.bizA}/payslips/${f.empA.S2}/2026-09.pdf`, "view")).toBe(false);
  });

  it("lets staff upload their own leave attachment and claim receipts", async () => {
    expect(await canFile(f.users.staffA, `${f.bizA}/leave/${f.empA.S1}/medical.jpg`, "create")).toBe(true);
    expect(await canFile(f.users.staffA, `${f.bizA}/transport/${f.empA.S1}/ferry.jpg`, "create")).toBe(true);
  });

  it("blocks other businesses and badly-formed paths", async () => {
    expect(await canFile(f.users.ownerB, `${f.bizA}/branding/logo.png`, "view")).toBe(false);
    expect(await canFile(f.users.ownerA, `${f.bizA}/payslips/${f.empB.X}/x.pdf`, "view")).toBe(false);
    expect(await canFile(f.users.ownerA, `not-a-uuid/branding/logo.png`, "view")).toBe(false);
    expect(await canFile(f.users.ownerA, `${f.bizA}/unknown-area/x/y`, "view")).toBe(false);
  });

  it("lets every member see branding, but only settings editors change it", async () => {
    expect(await canFile(f.users.staffA, `${f.bizA}/branding/logo.png`, "view")).toBe(true);
    expect(await canFile(f.users.staffA, `${f.bizA}/branding/logo.png`, "create")).toBe(false);
    expect(await canFile(f.users.accountant, `${f.bizA}/branding/logo.png`, "create")).toBe(true);
  });
});

// ---------------------------------------------------------------------
describe("public careers page", () => {
  it("shows only open public vacancies, and only when the careers page is on", async () => {
    const slug = await asUser(db, f.users.ownerA, async (tx) => {
      await tx.query(
        `insert into public.vacancies (business_id, title, slug, status, is_public, salary_min, salary_max) values ($1, 'Chef', 'chef', 'open', true, 10000, 15000)`,
        [f.bizA],
      );
      await tx.query(
        `insert into public.vacancies (business_id, title, slug, status, is_public) values ($1, 'Secret role', 'secret', 'open', false)`,
        [f.bizA],
      );
      return (await one<{ slug: string }>(tx, `select slug from public.businesses where id = $1`, [f.bizA])).slug;
    });
    const get = () =>
      asUser(
        db,
        null,
        async (tx) =>
          (
            await one<{ c: { vacancies: { title: string; salary_min: number | null }[] } | null }>(tx, `select public.get_public_careers($1) as c`, [
              slug,
            ])
          ).c,
      );
    expect(await get()).toBeNull();
    await asUser(db, f.users.ownerA, (tx) => tx.query(`update public.businesses set careers_page_enabled = true where id = $1`, [f.bizA]));
    const page = await get();
    expect(page?.vacancies.map((v) => v.title)).toEqual(["Chef"]);
    expect(page?.vacancies[0].salary_min).toBeNull(); // salary hidden unless show_salary
  });
});

// ---------------------------------------------------------------------
describe("business deletion", () => {
  it("removes all of a business's data without touching other businesses", async () => {
    const before = await asService(db, (tx) => count(tx, `select 1 from public.employees where business_id = $1`, [f.bizB]));
    await asService(db, (tx) => tx.query(`delete from public.businesses where id = $1`, [f.bizA]));
    await asService(db, async (tx) => {
      expect(await count(tx, `select 1 from public.employees where business_id = $1`, [f.bizA])).toBe(0);
      expect(await count(tx, `select 1 from public.payroll_runs where business_id = $1`, [f.bizA])).toBe(0);
      expect(await count(tx, `select 1 from public.employees where business_id = $1`, [f.bizB])).toBe(before);
    });
  });
});
