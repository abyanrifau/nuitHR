/**
 * Default roles created for every new business. The Owner role is
 * special (full access, created by the database). Businesses can edit
 * these roles or create custom ones later in Settings → Roles.
 */
import { allResources } from "./registry";
import type { PermissionAction, PermissionScope } from "./types";

export interface PermissionGrant {
  resource: string;
  action: PermissionAction;
  scope: PermissionScope;
}

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: PermissionGrant[];
}

type Grants = Record<string, Partial<Record<PermissionAction, PermissionScope>>>;

function expand(grants: Grants): PermissionGrant[] {
  const known = new Map(allResources().map((r) => [r.key, r]));
  const out: PermissionGrant[] = [];
  for (const [resource, actions] of Object.entries(grants)) {
    const def = known.get(resource);
    if (!def) throw new Error(`Unknown permission resource "${resource}" in role templates`);
    for (const [action, scope] of Object.entries(actions) as [PermissionAction, PermissionScope][]) {
      if (!def.actions.includes(action)) continue;
      out.push({ resource, action, scope: def.employeeScoped ? scope : "all" });
    }
  }
  return out;
}

/** Every action on a resource at the given scope. */
function full(resource: string, scope: PermissionScope = "all"): Grants {
  const def = allResources().find((r) => r.key === resource);
  if (!def) throw new Error(`Unknown permission resource "${resource}"`);
  return { [resource]: Object.fromEntries(def.actions.map((a) => [a, scope])) };
}

const SALARY_RESOURCES = new Set(
  allResources()
    .filter((r) => r.ownerGrantOnly)
    .map((r) => r.key),
);

// Things every signed-in staff member can do for themselves.
const SELF_SERVICE: Grants = {
  employees: { view: "own" },
  compensation: { view: "own" },
  documents: { view: "own" },
  letters: { view: "own", create: "own" },
  approvals: { view: "own" },
  attendance: { view: "own", create: "own" },
  roster: { view: "own" },
  leave: { view: "own", create: "own" },
  payslips: { view: "own", export: "own" },
  claims: { view: "own", create: "own" },
  onboarding: { view: "own" },
  compliance: { view: "own" },
  training: { view: "own", edit: "own" },
  sponsorships: { view: "own", create: "own" },
  goals: { view: "own", create: "own", edit: "own" },
  reviews: { view: "own", edit: "own" },
  surveys: {},
};

function merge(...parts: Grants[]): Grants {
  const out: Grants = {};
  const rank = { own: 1, team: 2, all: 3 } as const;
  for (const part of parts) {
    for (const [res, actions] of Object.entries(part)) {
      out[res] ??= {};
      for (const [act, scope] of Object.entries(actions) as [PermissionAction, PermissionScope][]) {
        const prev = out[res][act];
        if (!prev || rank[scope] > rank[prev]) out[res][act] = scope;
      }
    }
  }
  return out;
}

const everythingExceptSalary = merge(
  ...allResources()
    .filter((r) => !SALARY_RESOURCES.has(r.key) && r.key !== "roles")
    .map((r) => full(r.key)),
);

export const DEFAULT_ROLES: RoleTemplate[] = [
  {
    key: "admin",
    name: "Admin",
    description: "Runs the system day to day. Everything except salary and payroll data.",
    permissions: expand(merge(everythingExceptSalary, { roles: { view: "all" } }, SELF_SERVICE)),
  },
  {
    key: "hr_manager",
    name: "HR Manager",
    description: "Manages people, leave, attendance, hiring, compliance, training and reviews.",
    permissions: expand(
      merge(
        full("employees"),
        full("org"),
        full("documents"),
        full("letters"),
        full("approvals"),
        full("attendance"),
        full("roster"),
        full("leave"),
        full("recruitment"),
        full("onboarding"),
        full("compliance"),
        full("learning"),
        full("training"),
        full("sponsorships"),
        full("goals"),
        full("reviews"),
        full("surveys"),
        full("announcements"),
        { users: { view: "all", create: "all", edit: "all" } },
        { claims: { view: "all", approve: "all", export: "all" } },
        { audit: { view: "all" }, settings: { view: "all" }, modules: { view: "all" }, roles: { view: "all" } },
        SELF_SERVICE,
      ),
    ),
  },
  {
    key: "payroll_officer",
    name: "Payroll Officer",
    description: "Runs payroll and looks after salaries, loans, claims and payslips.",
    permissions: expand(
      merge(
        full("payroll"),
        full("payslips"),
        full("compensation"),
        { employees: { view: "all", export: "all" }, org: { view: "all" } },
        { attendance: { view: "all", export: "all" }, leave: { view: "all", export: "all" } },
        full("claims"),
        { approvals: { view: "all", approve: "all" } },
        { settings: { view: "all" } },
        SELF_SERVICE,
      ),
    ),
  },
  {
    key: "manager",
    name: "Department Head / Manager",
    description: "Sees and approves requests for their own team only.",
    permissions: expand(
      merge(
        { employees: { view: "team" } },
        { documents: { view: "team" } },
        { approvals: { view: "team", approve: "team" } },
        { attendance: { view: "team", approve: "team", export: "team" } },
        { roster: { view: "team", create: "team", edit: "team", delete: "team" } },
        { leave: { view: "team", approve: "team", export: "team" } },
        { claims: { view: "team", approve: "team" } },
        { onboarding: { view: "team", edit: "team" } },
        { compliance: { view: "team" } },
        { training: { view: "team" } },
        { sponsorships: { view: "team" } },
        { goals: { view: "team", create: "team", edit: "team" } },
        { reviews: { view: "team", edit: "team", approve: "team" } },
        SELF_SERVICE,
      ),
    ),
  },
  {
    key: "employee",
    name: "Employee",
    description: "Uses the staff app to clock in, ask for time off, see payslips and send claims.",
    permissions: expand(SELF_SERVICE),
  },
];

/** Payload for the create_business() database function. */
export function defaultRolesPayload() {
  return DEFAULT_ROLES.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: r.permissions,
  }));
}
