import "server-only";
import type { BusinessAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Report } from "@/lib/time/reports";

/** Payroll reports from finalized and paid pay runs (the figures people were actually paid). */
export type PayReportKind = "department" | "branch" | "cost" | "ytd" | "pension" | "tax";

export const PAY_REPORTS: { key: PayReportKind; label: string; description: string; yearly?: boolean }[] = [
  { key: "department", label: "By department", description: "Earnings, deductions, net pay and cost for each department." },
  { key: "branch", label: "By location", description: "The same totals for each location." },
  { key: "cost", label: "Cost to company", description: "Each person's earnings plus what the company pays on top (employer pension)." },
  { key: "ytd", label: "Year to date", description: "Each person's totals for the year so far.", yearly: true },
  { key: "pension", label: "Pension", description: "Pensionable pay and contributions. Check the rates before you file." },
  { key: "tax", label: "Tax", description: "Taxable pay and income tax. Check the tax bands before you file." },
];

type Pe = {
  run_id: string;
  employee_id: string;
  employee_code: string | null;
  employee_name: string;
  department_name: string | null;
  branch_name: string | null;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  employer_contributions: number;
  taxable_pay: number;
  pensionable_pay: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function buildPayReport(active: BusinessAccess, kind: PayReportKind, range: { start: string; end: string; label: string }): Promise<Report & { runs: number }> {
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("payroll_runs")
    .select("id")
    .eq("business_id", active.business_id)
    .in("status", ["finalized", "paid"])
    .gte("pay_date", range.start)
    .lte("pay_date", range.end);
  const runIds = (runs ?? []).map((r) => r.id);
  const [{ data: pe }, { data: lines }] = runIds.length
    ? await Promise.all([
        supabase
          .from("payroll_run_employees")
          .select("run_id, employee_id, employee_code, employee_name, department_name, branch_name, gross_pay, total_deductions, net_pay, employer_contributions, taxable_pay, pensionable_pay")
          .in("run_id", runIds)
          .limit(20000),
        supabase.from("payroll_run_lines").select("employee_id, code, amount").in("run_id", runIds).in("code", ["TAX", "PENSION", "PENSION_ER"]).limit(50000),
      ])
    : [{ data: [] as Pe[] }, { data: [] as { employee_id: string; code: string; amount: number }[] }];
  const rows = ((pe ?? []) as Pe[]).map((p) => ({ ...p, gross_pay: Number(p.gross_pay), total_deductions: Number(p.total_deductions), net_pay: Number(p.net_pay), employer_contributions: Number(p.employer_contributions), taxable_pay: Number(p.taxable_pay), pensionable_pay: Number(p.pensionable_pay) }));
  const stat = (emp: string, code: string) => (lines ?? []).filter((l) => l.employee_id === emp && l.code === code).reduce((a, l) => a + Number(l.amount), 0);
  const def = PAY_REPORTS.find((r) => r.key === kind)!;
  const title = `${def.label}, ${range.label}`;
  const money = { numeric: true };

  // One line per person, adding up every run in the range.
  const perPerson = () => {
    const m = new Map<string, Pe & { runs: number }>();
    for (const p of rows) {
      const cur = m.get(p.employee_id);
      if (!cur) m.set(p.employee_id, { ...p, runs: 1 });
      else {
        cur.gross_pay += p.gross_pay;
        cur.total_deductions += p.total_deductions;
        cur.net_pay += p.net_pay;
        cur.employer_contributions += p.employer_contributions;
        cur.taxable_pay += p.taxable_pay;
        cur.pensionable_pay += p.pensionable_pay;
        cur.runs += 1;
      }
    }
    return [...m.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
  };
  const withTotal = (data: (string | number)[][], from: number) => {
    if (!data.length) return data;
    const total: (string | number)[] = data[0].map((_, i) => (i < from ? (i === 1 ? "Total" : "") : r2(data.reduce((a, r) => a + Number(r[i] || 0), 0))));
    return [...data, total];
  };

  if (kind === "department" || kind === "branch") {
    const key = kind === "department" ? "department_name" : "branch_name";
    const g = new Map<string, { people: Set<string>; gross: number; ded: number; net: number; er: number }>();
    for (const p of rows) {
      const k = p[key] ?? (kind === "department" ? "No department" : "No location");
      const cur = g.get(k) ?? { people: new Set(), gross: 0, ded: 0, net: 0, er: 0 };
      cur.people.add(p.employee_id);
      cur.gross += p.gross_pay;
      cur.ded += p.total_deductions;
      cur.net += p.net_pay;
      cur.er += p.employer_contributions;
      g.set(k, cur);
    }
    const data = [...g]
      .sort((a, b) => b[1].gross - a[1].gross)
      .map(([k, v]) => [k, v.people.size, r2(v.gross), r2(v.ded), r2(v.net), r2(v.er), r2(v.gross + v.er)]);
    return {
      title,
      runs: runIds.length,
      columns: [{ label: kind === "department" ? "Department" : "Location" }, { label: "People", numeric: true }, { label: "Earnings", ...money }, { label: "Deductions", ...money }, { label: "Net pay", ...money }, { label: "Employer pension", ...money }, { label: "Cost to company", ...money }],
      rows: data.length ? [...withTotal(data, 2).slice(0, -1), ["Total", new Set(rows.map((p) => p.employee_id)).size, ...withTotal(data, 2).at(-1)!.slice(2)]] : data,
    };
  }
  if (kind === "cost") {
    const data = perPerson().map((p) => [p.employee_code ?? "", p.employee_name, p.department_name ?? "", r2(p.gross_pay), r2(p.employer_contributions), r2(p.gross_pay + p.employer_contributions)]);
    return {
      title,
      runs: runIds.length,
      columns: [{ label: "Employee no." }, { label: "Name" }, { label: "Department" }, { label: "Earnings", ...money }, { label: "Employer pension", ...money }, { label: "Cost to company", ...money }],
      rows: withTotal(data, 3),
    };
  }
  if (kind === "ytd") {
    const data = perPerson().map((p) => [p.employee_code ?? "", p.employee_name, p.runs, r2(p.gross_pay), r2(stat(p.employee_id, "TAX")), r2(stat(p.employee_id, "PENSION")), r2(p.total_deductions), r2(p.net_pay), r2(p.employer_contributions)]);
    return {
      title,
      runs: runIds.length,
      columns: [{ label: "Employee no." }, { label: "Name" }, { label: "Pay runs", numeric: true }, { label: "Earnings", ...money }, { label: "Income tax", ...money }, { label: "Pension (staff)", ...money }, { label: "All deductions", ...money }, { label: "Net pay", ...money }, { label: "Employer pension", ...money }],
      rows: withTotal(data, 3),
    };
  }
  if (kind === "pension") {
    const data = perPerson()
      .map((p) => [p.employee_code ?? "", p.employee_name, r2(p.pensionable_pay), r2(stat(p.employee_id, "PENSION")), r2(stat(p.employee_id, "PENSION_ER")), r2(stat(p.employee_id, "PENSION") + stat(p.employee_id, "PENSION_ER"))])
      .filter((r) => Number(r[5]) > 0);
    return {
      title,
      runs: runIds.length,
      note: "Check the pension rates against the current Maldives Pension Administration Office rules before you file.",
      columns: [{ label: "Employee no." }, { label: "Name" }, { label: "Pensionable pay", ...money }, { label: "Staff contribution", ...money }, { label: "Employer contribution", ...money }, { label: "Total", ...money }],
      rows: withTotal(data, 2),
    };
  }
  const data = perPerson().map((p) => [p.employee_code ?? "", p.employee_name, r2(p.taxable_pay), r2(stat(p.employee_id, "TAX"))]);
  return {
    title,
    runs: runIds.length,
    note: "Check the tax bands against the current MIRA rules before you file.",
    columns: [{ label: "Employee no." }, { label: "Name" }, { label: "Taxable pay (after pension)", ...money }, { label: "Income tax", ...money }],
    rows: withTotal(data, 2),
  };
}
