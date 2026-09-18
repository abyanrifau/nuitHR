import { describe, expect, it } from "vitest";
import { CORE_MODULE_KEYS, MODULES, allResources } from "@/modules/registry";
import {
  applyBundle,
  BUNDLES,
  dependentsOf,
  disableModule,
  enableModule,
  normalizeSelection,
  previewDisable,
  recommendationsFor,
} from "@/modules/selection";
import { estimateMonthlyPrice } from "@/modules/pricing";
import { DEFAULT_ROLES } from "@/modules/roles";
import { adminNavigation, moduleForPath, portalNavigation, type AccessContext } from "@/modules/access";
import { appConfig } from "@/config/app.config";

describe("module registry", () => {
  it("has unique module keys and resource keys", () => {
    const keys = MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const res = allResources().map((r) => r.key);
    expect(new Set(res).size).toBe(res.length);
  });

  it("only references modules that exist", () => {
    const keys = new Set(MODULES.map((m) => m.key));
    for (const m of MODULES) {
      for (const dep of [...m.requires, ...m.recommends]) expect(keys.has(dep)).toBe(true);
    }
  });

  it("has no dependency cycles", () => {
    const visit = (key: string, path: string[]) => {
      expect(path).not.toContain(key);
      for (const dep of MODULES.find((m) => m.key === key)!.requires) visit(dep, [...path, key]);
    };
    for (const m of MODULES) visit(m.key, []);
  });

  it("gives every optional module a price and every core module the core price", () => {
    for (const m of MODULES.filter((x) => !x.core)) {
      expect(appConfig.pricing.modules).toHaveProperty(m.key);
    }
  });

  it("gives module cards 3-4 features", () => {
    for (const m of MODULES) {
      expect(m.features.length).toBeGreaterThanOrEqual(3);
      expect(m.features.length).toBeLessThanOrEqual(4);
    }
  });
});

describe("module selection rules", () => {
  it("auto-enables Payroll when Transport Allowance is turned on, with a friendly note", () => {
    const r = enableModule(CORE_MODULE_KEYS, "transport");
    expect(r.selected).toContain("payroll");
    expect(r.autoEnabled).toHaveLength(1);
    expect(r.autoEnabled[0].message).toMatch(/Transport allowance claims needs Payroll.*turned Payroll on too/);
  });

  it("warns that turning off Payroll also turns off Transport Allowance", () => {
    const selected = normalizeSelection(["payroll", "transport", "leave"]);
    expect(previewDisable(selected, "payroll")).toEqual({ allowed: true, alsoDisabled: ["transport"] });
    const r = disableModule(selected, "payroll");
    expect(r.selected).not.toContain("payroll");
    expect(r.selected).not.toContain("transport");
    expect(r.selected).toContain("leave");
  });

  it("never allows core modules to be turned off", () => {
    const selected = normalizeSelection([]);
    for (const key of CORE_MODULE_KEYS) {
      expect(previewDisable(selected, key).allowed).toBe(false);
      expect(disableModule(selected, key).selected).toContain(key);
    }
  });

  it("always includes core modules and requirements, and drops unknown keys", () => {
    const sel = normalizeSelection(["transport", "not-a-module"]);
    for (const key of CORE_MODULE_KEYS) expect(sel).toContain(key);
    expect(sel).toContain("payroll");
    expect(sel).not.toContain("not-a-module");
  });

  it("dependentsOf only lists enabled modules", () => {
    expect(dependentsOf("payroll", normalizeSelection(["payroll"]))).toEqual([]);
  });

  it("builds every industry bundle from the spec", () => {
    const expected: Record<string, string[]> = {
      hospitality: ["attendance", "leave", "payroll", "transport", "compliance", "onboarding"],
      restaurant: ["attendance", "leave", "payroll", "compliance"],
      retail: ["attendance", "leave", "payroll"],
      office: ["leave", "payroll", "recruitment", "performance", "learning"],
      construction: ["attendance", "leave", "payroll", "compliance", "expenses"],
      basics: [],
    };
    for (const b of BUNDLES) {
      const sel = applyBundle(b.key).selected;
      const optional = sel.filter((k) => !CORE_MODULE_KEYS.includes(k));
      expect(optional.sort()).toEqual(expected[b.key].sort());
    }
  });

  it("recommends Attendance and Leave alongside Payroll without forcing them", () => {
    const sel = normalizeSelection(["payroll"]);
    expect(sel).not.toContain("attendance");
    expect(recommendationsFor(sel).map((r) => r.module)).toEqual(expect.arrayContaining(["attendance", "leave"]));
  });
});

describe("pricing", () => {
  it("adds base + per-employee for core and each selected module", () => {
    const p = appConfig.pricing.modules;
    const est = estimateMonthlyPrice(normalizeSelection(["leave", "payroll"]), 20);
    expect(est.lines.map((l) => l.key)).toEqual(["core", "leave", "payroll"]);
    expect(est.monthlyTotal).toBe(
      p.core.base + p.core.perEmployee * 20 + p.leave.base + p.leave.perEmployee * 20 + p.payroll.base + p.payroll.perEmployee * 20,
    );
  });

  it("treats invalid employee counts as 1", () => {
    expect(estimateMonthlyPrice([], Number.NaN).employees).toBe(1);
    expect(estimateMonthlyPrice([], -5).employees).toBe(1);
  });
});

describe("default roles", () => {
  const resources = new Map(allResources().map((r) => [r.key, r]));

  it("only grants actions that exist on each resource", () => {
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) {
        expect(resources.get(p.resource)?.actions).toContain(p.action);
      }
    }
  });

  it("keeps salary and payroll data away from Admin, HR Manager and Managers (except their own)", () => {
    for (const key of ["admin", "hr_manager", "manager", "employee"]) {
      const role = DEFAULT_ROLES.find((r) => r.key === key)!;
      const salary = role.permissions.filter((p) => ["compensation", "payroll", "payslips"].includes(p.resource));
      for (const p of salary) expect(p.scope).toBe("own");
      expect(salary.some((p) => p.resource === "payroll")).toBe(false);
    }
    const payroll = DEFAULT_ROLES.find((r) => r.key === "payroll_officer")!;
    expect(payroll.permissions).toContainEqual({ resource: "compensation", action: "view", scope: "all" });
  });

  it("limits managers to their team", () => {
    const mgr = DEFAULT_ROLES.find((r) => r.key === "manager")!;
    expect(mgr.permissions.every((p) => p.scope !== "all")).toBe(true);
  });
});

describe("navigation adapts to enabled modules", () => {
  const owner = (modules: string[]): AccessContext => ({
    isOwner: true,
    modules: normalizeSelection(modules),
    permissions: [],
  });

  it("hides disabled modules from the sidebar and portal", () => {
    const hrefs = adminNavigation(owner([])).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/app/employees");
    expect(hrefs).not.toContain("/app/payroll");
    const withPayroll = adminNavigation(owner(["payroll"])).flatMap((g) => g.items.map((i) => i.href));
    expect(withPayroll).toContain("/app/payroll");
    expect(portalNavigation(owner([])).map((p) => p.href)).not.toContain("/portal/clock");
    expect(portalNavigation(owner(["attendance"])).map((p) => p.href)).toContain("/portal/clock");
  });

  it("hides items the user has no permission for", () => {
    const staff: AccessContext = {
      isOwner: false,
      modules: normalizeSelection(["payroll", "leave"]),
      permissions: DEFAULT_ROLES.find((r) => r.key === "employee")!.permissions,
    };
    const hrefs = adminNavigation(staff).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain("/app/payroll");
    expect(portalNavigation(staff).map((p) => p.href)).toEqual(expect.arrayContaining(["/portal/payslips", "/portal/leave"]));
  });

  it("maps URLs to their module", () => {
    expect(moduleForPath("/app/attendance/roster")?.key).toBe("attendance");
    expect(moduleForPath("/app/payroll/runs/123")?.key).toBe("payroll");
    expect(moduleForPath("/portal/claims")?.key).toBe("transport");
    expect(moduleForPath("/app")).toBeUndefined();
  });
});
