import { describe, expect, it } from "vitest";
import { CORE_MODULE_KEYS, FOUNDATION_TOOLS, MODULES, TOOL_STAGES, allResources, toolsInStage } from "@/modules/registry";
import { dependentsOf, disableModule, enableModule, normalizeSelection, previewDisable, recommendationsFor } from "@/modules/selection";
import { estimateMonthlyPrice } from "@/modules/pricing";
import { DEFAULT_ROLES } from "@/modules/roles";
import { adminNavigation, moduleForPath, portalNavigation, portalTabs, type AccessContext } from "@/modules/access";
import { isComplete, recommendTools, selectionFromAnswers, SETUP_QUESTIONS } from "@/modules/setup-questions";
import { appConfig } from "@/config/app.config";

describe("tool registry", () => {
  it("has unique keys and resource keys", () => {
    const keys = MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const res = allResources().map((r) => r.key);
    expect(new Set(res).size).toBe(res.length);
  });

  it("uses the new lineup: foundation plus hire, run, pay and grow", () => {
    expect(FOUNDATION_TOOLS.map((m) => m.name)).toEqual(["People directory", "Requests", "Letters & files", "Access & roles", "Staff app"]);
    expect(toolsInStage("hire").map((m) => m.name)).toEqual(["Hiring", "Joiners & leavers"]);
    expect(toolsInStage("run").map((m) => m.name)).toEqual(["Time & shifts", "Time off", "Permits & renewals"]);
    expect(toolsInStage("pay").map((m) => m.name)).toEqual(["Payroll", "Claims"]);
    expect(toolsInStage("grow").map((m) => m.name)).toEqual(["Training", "Reviews & goals"]);
    expect(TOOL_STAGES.map((s) => s.label)).toEqual(["Hire", "Run", "Pay", "Grow"]);
  });

  it("only references tools that exist, with no dependency cycles", () => {
    const keys = new Set(MODULES.map((m) => m.key));
    const visit = (key: string, path: string[]) => {
      expect(path).not.toContain(key);
      for (const dep of MODULES.find((m) => m.key === key)!.requires) visit(dep, [...path, key]);
    };
    for (const m of MODULES) {
      for (const dep of [...m.requires, ...m.recommends]) expect(keys.has(dep)).toBe(true);
      visit(m.key, []);
    }
  });

  it("prices every add-on tool", () => {
    for (const m of MODULES.filter((x) => !x.core)) expect(appConfig.pricing.tools).toHaveProperty(m.key);
  });

  it("gives every listed tool a tagline, 3-4 short points and 4-6 outcomes", () => {
    for (const m of MODULES.filter((x) => !x.builtIn)) {
      expect(m.features.length).toBeGreaterThanOrEqual(3);
      expect(m.features.length).toBeLessThanOrEqual(4);
      expect(m.outcomes.length).toBeGreaterThanOrEqual(4);
      expect(m.outcomes.length).toBeLessThanOrEqual(6);
    }
  });
});

describe("tool selection rules", () => {
  it("lets Claims work without Payroll", () => {
    const r = enableModule(CORE_MODULE_KEYS, "claims");
    expect(r.selected).toContain("claims");
    expect(r.selected).not.toContain("payroll");
    expect(r.autoEnabled).toEqual([]);
    expect(previewDisable(normalizeSelection(["payroll", "claims"]), "payroll")).toEqual({ allowed: true, alsoDisabled: [] });
  });

  it("maps the old transport and expense keys to Claims", () => {
    expect(normalizeSelection(["transport"])).toContain("claims");
    expect(normalizeSelection(["expenses"])).toContain("claims");
    expect(normalizeSelection(["transport"])).not.toContain("transport");
  });

  it("never allows foundation tools to be switched off", () => {
    const selected = normalizeSelection([]);
    for (const key of CORE_MODULE_KEYS) {
      expect(previewDisable(selected, key).allowed).toBe(false);
      expect(disableModule(selected, key).selected).toContain(key);
    }
  });

  it("drops unknown keys and lists dependents only when enabled", () => {
    expect(normalizeSelection(["not-a-tool"])).not.toContain("not-a-tool");
    expect(dependentsOf("payroll", normalizeSelection(["payroll"]))).toEqual([]);
  });

  it("recommends time, time off and claims alongside payroll without forcing them", () => {
    const sel = normalizeSelection(["payroll"]);
    expect(sel).not.toContain("attendance");
    expect(recommendationsFor(sel).map((r) => r.module)).toEqual(expect.arrayContaining(["attendance", "leave", "claims"]));
  });
});

describe("setup questions", () => {
  it("has 6 to 8 questions", () => {
    expect(SETUP_QUESTIONS.length).toBeGreaterThanOrEqual(6);
    expect(SETUP_QUESTIONS.length).toBeLessThanOrEqual(8);
  });

  it("recommends tools from answers, each with a reason", () => {
    const answers = {
      work_pattern: "shifts",
      track_leave: "yes",
      payroll: "here",
      reimburse: "yes",
      permits: "yes",
      hiring: "no",
      starters: "yes",
      develop: "neither",
    };
    expect(isComplete(answers)).toBe(true);
    const recs = recommendTools(answers);
    expect(recs.map((r) => r.key).sort()).toEqual(["attendance", "claims", "compliance", "leave", "onboarding", "payroll"]);
    expect(recs.find((r) => r.key === "attendance")!.reason).toBe("Because your staff work shifts");
  });

  it("suggests only the foundation when nothing else fits", () => {
    const none = {
      work_pattern: "fixed",
      track_leave: "no",
      payroll: "elsewhere",
      reimburse: "no",
      permits: "no",
      hiring: "no",
      starters: "no",
      develop: "neither",
    };
    expect(recommendTools(none)).toEqual([]);
    expect(selectionFromAnswers(none)).toEqual(normalizeSelection([]));
  });

  it("covers hiring, training and reviews", () => {
    const keys = recommendTools({ hiring: "yes", develop: "both" }).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["recruitment", "onboarding", "learning", "performance"]));
  });
});

describe("pricing", () => {
  it("charges the foundation base fee plus each add-on", () => {
    const { foundation, tools } = appConfig.pricing;
    const est = estimateMonthlyPrice(normalizeSelection(["leave", "payroll"]), 20);
    expect(est.lines.map((l) => l.key)).toEqual(["foundation", "leave", "payroll"]);
    expect(est.monthlyTotal).toBe(
      foundation.base + foundation.perPerson * 20 + tools.leave.base + tools.leave.perPerson * 20 + tools.payroll.base + tools.payroll.perPerson * 20,
    );
  });

  it("treats invalid headcounts as 1", () => {
    expect(estimateMonthlyPrice([], Number.NaN).people).toBe(1);
    expect(estimateMonthlyPrice([], -5).people).toBe(1);
  });

  it("has a 30-day trial by default", () => {
    expect(appConfig.trial.days).toBe(30);
  });
});

describe("default roles", () => {
  const resources = new Map(allResources().map((r) => [r.key, r]));

  it("only grants actions that exist on each resource", () => {
    for (const role of DEFAULT_ROLES) for (const p of role.permissions) expect(resources.get(p.resource)?.actions).toContain(p.action);
  });

  it("keeps salary and payroll away from Admin, HR Manager and Managers (except their own)", () => {
    for (const key of ["admin", "hr_manager", "manager", "employee"]) {
      const role = DEFAULT_ROLES.find((r) => r.key === key)!;
      const salary = role.permissions.filter((p) => ["compensation", "payroll", "payslips"].includes(p.resource));
      for (const p of salary) expect(p.scope).toBe("own");
      expect(salary.some((p) => p.resource === "payroll")).toBe(false);
    }
  });

  it("gives staff claims for themselves and managers claims for their team", () => {
    expect(DEFAULT_ROLES.find((r) => r.key === "employee")!.permissions).toContainEqual({ resource: "claims", action: "create", scope: "own" });
    expect(DEFAULT_ROLES.find((r) => r.key === "manager")!.permissions).toContainEqual({ resource: "claims", action: "approve", scope: "team" });
    expect(DEFAULT_ROLES.find((r) => r.key === "manager")!.permissions.every((p) => p.scope !== "all")).toBe(true);
  });
});

describe("navigation adapts to switched-on tools", () => {
  const owner = (modules: string[]): AccessContext => ({ isOwner: true, modules: normalizeSelection(modules), permissions: [] });
  const hrefs = (ctx: AccessContext) => adminNavigation(ctx).flatMap((s) => s.items.map((i) => i.href));

  it("orders the sidebar Home, Requests, stages, then Workspace", () => {
    const sections = adminNavigation(owner(["attendance", "payroll"]));
    expect(sections.map((s) => s.key)).toEqual(["home", "run", "pay", "workspace"]);
    expect(sections[0].items.slice(0, 2).map((i) => i.label)).toEqual(["Home", "Requests"]);
    expect(sections.at(-1)!.items.map((i) => i.label)).toContain("Tools");
  });

  it("hides switched-off tools from the sidebar and staff app", () => {
    expect(hrefs(owner([]))).not.toContain("/app/payroll");
    expect(hrefs(owner(["payroll"]))).toContain("/app/payroll");
    expect(portalNavigation(owner([])).map((p) => p.href)).not.toContain("/staff/time");
    expect(portalNavigation(owner(["attendance"])).map((p) => p.href)).toContain("/staff/time");
  });

  it("gives the staff app its five tabs in order when everything is on", () => {
    expect(portalTabs(owner(["attendance", "payroll", "leave", "claims"])).map((t) => t.label)).toEqual(["Home", "Time", "Requests", "Pay", "Me"]);
  });

  it("can limit the sidebar to pages that exist", () => {
    expect(adminNavigation(owner(["payroll"]), { onlyBuilt: true }).flatMap((s) => s.items.map((i) => i.href))).toEqual([
      "/app",
      "/app/requests",
      "/app/people",
      "/app/people/org-chart",
      "/app/letters",
      "/app/news",
      "/app/workspace/tools",
      "/app/workspace/people",
      "/app/workspace/requests",
      "/app/workspace/company",
      "/app/workspace/notifications",
      "/app/workspace/activity",
      "/app/workspace/data",
      "/app/workspace/support",
    ]);
  });

  it("hides items the person isn't allowed to see", () => {
    const staff: AccessContext = {
      isOwner: false,
      modules: normalizeSelection(["payroll", "leave"]),
      permissions: DEFAULT_ROLES.find((r) => r.key === "employee")!.permissions,
    };
    expect(hrefs(staff)).not.toContain("/app/payroll");
    expect(portalNavigation(staff).map((p) => p.href)).toEqual(expect.arrayContaining(["/staff/pay", "/staff/requests"]));
  });

  it("maps URLs to their tool", () => {
    expect(moduleForPath("/app/time/roster")?.key).toBe("attendance");
    expect(moduleForPath("/app/payroll/runs/123")?.key).toBe("payroll");
    expect(moduleForPath("/staff/requests/claim")?.key).toBe("claims");
    expect(moduleForPath("/app")).toBeUndefined();
  });
});
