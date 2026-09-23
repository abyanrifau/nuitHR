/** The formula checker and the "this rule is never reached" warning. */
import { describe, expect, it } from "vitest";
import { parseFormula } from "@/lib/payroll/formula";
import { TEMPLATES, unreachableRules, type PayRule } from "@/lib/payroll/pay-items";

const err = (text: string) => {
  const r = parseFormula(text);
  return r.ok ? "" : r.error;
};

describe("formula checker", () => {
  it("reads the example formula into a tree", () => {
    const r = parseFormula("IF(unapproved_absences >= 3, amount * 0.5, amount)");
    expect(r).toEqual({
      ok: true,
      ast: ["IF", [">=", ["var", "unapproved_absences"], ["num", 3]], ["*", ["var", "amount"], ["num", 0.5]], ["var", "amount"]],
    });
    expect(parseFormula("ROUND(basic_salary / working_days * unapproved_absences, 2)")).toMatchObject({
      ast: ["ROUND", ["*", ["/", ["var", "basic_salary"], ["var", "working_days"]], ["var", "unapproved_absences"]], ["num", 2]],
    });
    expect(parseFormula("-amount + 2 * (late_count - 3)").ok).toBe(true);
    expect(parseFormula("if(late_count > 3, 1, 0)").ok).toBe(true);
  });

  it("explains mistakes clearly, with where they are", () => {
    expect(err("amount * lates")).toBe('"lates" isn\'t a variable. Did you mean late_count? (character 10)');
    expect(err("IF(amount > 1, 2)")).toMatch(/IF needs 3 values/);
    expect(err("amount * (2 + 3")).toMatch(/closing bracket/);
    expect(err("amount 2")).toMatch(/Unexpected "2"/);
    expect(err("amount * 50%")).toMatch(/0\.5 for 50%/);
    expect(err("SUM(amount, 2)")).toMatch(/isn't a function you can use/);
    expect(err("1 < amount < 5")).toMatch(/AND\(/);
    expect(err("")).toBe("Type a formula.");
    // Nothing that looks like code gets through.
    expect(err("process.exit()")).not.toBe("");
    expect(err("amount; drop table x")).not.toBe("");
    expect(err("constructor.constructor('x')()")).not.toBe("");
  });
});

describe("rules that can never be reached", () => {
  const rule = (clauses: PayRule["clauses"], join: "and" | "or" = "and"): PayRule => ({ label: "", join, clauses, outcome: { type: "nothing" } });

  it("spots a rule that an earlier one always catches", () => {
    expect(unreachableRules([rule([{ var: "late_count", op: ">=", value: 3 }]), rule([{ var: "late_count", op: ">=", value: 5 }])])).toEqual([
      { index: 1, reason: "This rule is never reached: every case it covers is already caught by rule 1." },
    ]);
    // Two earlier rules together.
    expect(
      unreachableRules([rule([{ var: "late_count", op: "<", value: 3 }]), rule([{ var: "late_count", op: ">=", value: 3 }]), rule([{ var: "half_days", op: ">=", value: 1 }])]),
    ).toHaveLength(1);
    // A rule no number can match.
    expect(unreachableRules([rule([{ var: "late_count", op: ">", value: 5 }, { var: "late_count", op: "<", value: 2 }])])[0].reason).toMatch(/never match/);
  });

  it("doesn't warn about rules that can be reached", () => {
    const t = TEMPLATES.find((x) => x.key === "attendance_allowance")!;
    expect(unreachableRules(t.rules!)).toEqual([]);
    expect(unreachableRules([rule([{ var: "late_count", op: ">=", value: 5 }]), rule([{ var: "late_count", op: ">=", value: 3 }])])).toEqual([]);
    expect(
      unreachableRules([rule([{ var: "late_count", op: ">=", value: 3 }, { var: "half_days", op: ">=", value: 2 }]), rule([{ var: "late_count", op: ">=", value: 3 }])]),
    ).toEqual([]);
  });
});
