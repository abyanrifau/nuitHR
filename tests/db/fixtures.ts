/**
 * Builds two separate businesses with people in every default role, so
 * tests can check what each person can and cannot see.
 *
 *   Business A "Lagoon Guesthouse": owner, HR manager, payroll officer,
 *     manager (employee M), staff member S1 (reports to M),
 *     staff member S2 (other department, no manager), accountant (admin).
 *   Business B "Reef Cafe": owner, employee X, and the same accountant.
 */
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createUser, type TxLike } from "./harness";
import { defaultRolesPayload } from "@/modules/roles";
import { normalizeSelection } from "@/modules/selection";

export interface Fixture {
  users: Record<
    "ownerA" | "hrA" | "payrollA" | "managerA" | "staffA" | "staffA2" | "ownerB" | "staffB" | "accountant" | "support" | "outsider",
    string
  >;
  bizA: string;
  bizB: string;
  empA: { M: string; S1: string; S2: string };
  empB: { X: string };
  deptA: { ops: string; kitchen: string };
  deptB: string;
  roleA: Record<string, string>;
}

export async function one<T = Record<string, unknown>>(tx: TxLike, sql: string, params: unknown[] = []): Promise<T> {
  const r = await tx.query<T>(sql, params);
  return r.rows[0];
}

async function createBusiness(db: PGlite, owner: string, name: string, modules: string[]): Promise<string> {
  return asUser(db, owner, async (tx) => {
    const r = await one<{ id: string }>(tx, `select public.create_business($1::jsonb, $2::jsonb, $3::text[]) as id`, [
      JSON.stringify({ name, industry: "guesthouse" }),
      JSON.stringify(defaultRolesPayload()),
      normalizeSelection(modules),
    ]);
    return r.id;
  });
}

export async function buildFixture(db: PGlite): Promise<Fixture> {
  const users = {
    ownerA: await createUser(db, "owner.a@test.mv", "Aishath Owner"),
    hrA: await createUser(db, "hr.a@test.mv", "Hawwa HR"),
    payrollA: await createUser(db, "payroll.a@test.mv", "Ibrahim Payroll"),
    managerA: await createUser(db, "manager.a@test.mv", "Mohamed Manager"),
    staffA: await createUser(db, "staff.a@test.mv", "Fathimath Staff"),
    staffA2: await createUser(db, "staff2.a@test.mv", "Ali Staff"),
    ownerB: await createUser(db, "owner.b@test.mv", "Ahmed Owner B"),
    staffB: await createUser(db, "staff.b@test.mv", "Mariyam Staff B"),
    accountant: await createUser(db, "accountant@test.mv", "Shared Accountant"),
    support: await createUser(db, "support@vendor.test", "Vendor Support"),
    outsider: await createUser(db, "outsider@test.mv", "Outsider"),
  };

  const bizA = await createBusiness(db, users.ownerA, "Lagoon Guesthouse", ["attendance", "leave", "payroll", "transport"]);
  const bizB = await createBusiness(db, users.ownerB, "Reef Cafe", ["attendance", "leave"]);

  const setupA = await asUser(db, users.ownerA, async (tx) => {
    const roles = await tx.query<{ key: string; id: string }>(`select key, id from public.roles where business_id = $1`, [bizA]);
    const roleA = Object.fromEntries(roles.rows.map((r) => [r.key, r.id]));
    const branch = await one<{ id: string }>(tx, `insert into public.branches (business_id, name) values ($1, 'Male Office') returning id`, [bizA]);
    const ops = await one<{ id: string }>(
      tx,
      `insert into public.departments (business_id, name, branch_id) values ($1, 'Front Office', $2) returning id`,
      [bizA, branch.id],
    );
    const kitchen = await one<{ id: string }>(tx, `insert into public.departments (business_id, name) values ($1, 'Kitchen') returning id`, [bizA]);
    const emp = async (code: string, first: string, dept: string, manager: string | null) =>
      (
        await one<{ id: string }>(
          tx,
          `insert into public.employees (business_id, employee_code, first_name, last_name, department_id, manager_id, branch_id, join_date)
           values ($1, $2, $3, 'Test', $4, $5, $6, '2024-01-01') returning id`,
          [bizA, code, first, dept, manager, branch.id],
        )
      ).id;
    const M = await emp("E001", "Mohamed", ops.id, null);
    const S1 = await emp("E002", "Fathimath", ops.id, M);
    const S2 = await emp("E003", "Ali", kitchen.id, null);

    const member = (user: string, role: string, employee: string | null) =>
      tx.query(`insert into public.business_members (business_id, user_id, role_id, employee_id) values ($1, $2, $3, $4)`, [
        bizA,
        user,
        roleA[role],
        employee,
      ]);
    await member(users.hrA, "hr_manager", null);
    await member(users.payrollA, "payroll_officer", null);
    await member(users.managerA, "manager", M);
    await member(users.staffA, "employee", S1);
    await member(users.staffA2, "employee", S2);
    await member(users.accountant, "admin", null);

    for (const [e, salary] of [
      [M, 25000],
      [S1, 12000],
      [S2, 11000],
    ] as const) {
      await tx.query(
        `insert into public.employee_compensation (business_id, employee_id, effective_date, basic_salary) values ($1, $2, '2024-01-01', $3)`,
        [bizA, e, salary],
      );
    }
    return { roleA, empA: { M, S1, S2 }, deptA: { ops: ops.id, kitchen: kitchen.id } };
  });

  const setupB = await asUser(db, users.ownerB, async (tx) => {
    const admin = await one<{ id: string }>(tx, `select id from public.roles where business_id = $1 and key = 'admin'`, [bizB]);
    const employeeRole = await one<{ id: string }>(tx, `select id from public.roles where business_id = $1 and key = 'employee'`, [bizB]);
    const dept = await one<{ id: string }>(tx, `insert into public.departments (business_id, name) values ($1, 'Kitchen') returning id`, [bizB]);
    const X = await one<{ id: string }>(
      tx,
      `insert into public.employees (business_id, employee_code, first_name, department_id) values ($1, 'B001', 'Mariyam', $2) returning id`,
      [bizB, dept.id],
    );
    await tx.query(`insert into public.business_members (business_id, user_id, role_id, employee_id) values ($1, $2, $3, $4)`, [
      bizB,
      users.staffB,
      employeeRole.id,
      X.id,
    ]);
    await tx.query(`insert into public.business_members (business_id, user_id, role_id) values ($1, $2, $3)`, [bizB, users.accountant, admin.id]);
    await tx.query(
      `insert into public.employee_compensation (business_id, employee_id, effective_date, basic_salary) values ($1, $2, '2024-01-01', 9000)`,
      [bizB, X.id],
    );
    return { empB: { X: X.id }, deptB: dept.id };
  });

  await asService(db, (tx) => tx.query(`insert into public.platform_admins (user_id) values ($1)`, [users.support]));

  return { users, bizA, bizB, ...setupA, ...setupB };
}
