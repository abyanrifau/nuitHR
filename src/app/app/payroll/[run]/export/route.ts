import { NextResponse, type NextRequest } from "next/server";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { can } from "@/modules/access";

/** Downloads for a pay run: bank transfer file, pay summary, payroll journal, pension report and tax report. */
export async function GET(req: NextRequest, { params }: RouteContext<"/app/payroll/[run]/export">) {
  const { run: id } = await params;
  const type = req.nextUrl.searchParams.get("type") ?? "summary";
  const active = await getActiveBusiness();
  if (!active) return new NextResponse("Sign in first.", { status: 401 });
  if (!can(toAccessContext(active), "payroll", "view")) return new NextResponse("You can't see payroll.", { status: 403 });
  const supabase = await createClient();
  const { data: run } = await supabase.from("payroll_runs").select("id, name, period_start, period_end, pay_date, status").eq("id", id).eq("business_id", active.business_id).maybeSingle();
  if (!run) return new NextResponse("Pay run not found.", { status: 404 });
  const [{ data: people }, { data: lines }, { data: accounts }] = await Promise.all([
    supabase.from("payroll_run_employees").select("*").eq("run_id", id).eq("status", "included").order("employee_name"),
    supabase.from("payroll_run_lines").select("employee_id, code, name, kind, amount, source, rate").eq("run_id", id),
    supabase.from("account_codes").select("code, name, mapping_key").eq("business_id", active.business_id),
  ]);
  const ppl = people ?? [];
  const ls = lines ?? [];
  const money = (n: number | string) => Number(n).toFixed(2);
  let rows: (string | number | null)[][];

  if (type === "bank") {
    rows = [["Employee no.", "Name", "Bank", "Account name", "Account number", "Amount", "Currency", "Reference"]];
    for (const p of ppl) rows.push([p.employee_code, p.employee_name, p.bank_name, p.bank_account_name ?? p.employee_name, p.bank_account_number, money(p.net_pay), active.currency, run.name]);
  } else if (type === "pension") {
    rows = [
      [`Pension report, ${run.name}. Check the rates against the current Maldives Pension Administration Office rules before you file.`],
      [],
      ["Employee no.", "Name", "Pensionable pay", "Employee rate %", "Employee contribution", "Employer rate %", "Employer contribution", "Total"],
    ];
    for (const p of ppl) {
      const emp = ls.filter((l) => l.employee_id === p.employee_id && l.code === "PENSION").reduce((a, l) => a + Number(l.amount), 0);
      const er = ls.filter((l) => l.employee_id === p.employee_id && l.code === "PENSION_ER").reduce((a, l) => a + Number(l.amount), 0);
      const rate = (code: string) => ls.find((l) => l.employee_id === p.employee_id && l.code === code)?.rate ?? "";
      if (emp || er) rows.push([p.employee_code, p.employee_name, money(p.pensionable_pay), rate("PENSION"), money(emp), rate("PENSION_ER"), money(er), money(emp + er)]);
    }
    const t = (code: string) => ls.filter((l) => l.code === code && ppl.some((p) => p.employee_id === l.employee_id)).reduce((a, l) => a + Number(l.amount), 0);
    rows.push([], ["", "Total", "", "", money(t("PENSION")), "", money(t("PENSION_ER")), money(t("PENSION") + t("PENSION_ER"))]);
  } else if (type === "tax") {
    rows = [
      [`Tax report, ${run.name}. Check the tax bands against the current MIRA rules before you file.`],
      [],
      ["Employee no.", "Name", "Taxable pay (after pension)", "Income tax"],
    ];
    let total = 0;
    for (const p of ppl) {
      const tax = ls.filter((l) => l.employee_id === p.employee_id && l.code === "TAX").reduce((a, l) => a + Number(l.amount), 0);
      total += tax;
      rows.push([p.employee_code, p.employee_name, money(p.taxable_pay), money(tax)]);
    }
    rows.push([], ["", "Total", money(ppl.reduce((a, p) => a + Number(p.taxable_pay), 0)), money(total)]);
  } else if (type === "journal") {
    // Totals by what they are, posted to the company's account codes where set up.
    const acct = (key: string, fallback: string) => {
      const a = (accounts ?? []).find((x) => x.mapping_key === key);
      return a ? [a.code, a.name] : ["", fallback];
    };
    const sum = (f: (l: (typeof ls)[number]) => boolean) => ls.filter((l) => ppl.some((p) => p.employee_id === l.employee_id) && f(l)).reduce((a, l) => a + Number(l.amount), 0);
    const earnings = sum((l) => l.kind === "earning" && l.source !== "expense_claim");
    const claims = sum((l) => l.source === "expense_claim");
    const penEmp = sum((l) => l.code === "PENSION");
    const penEr = sum((l) => l.code === "PENSION_ER");
    const tax = sum((l) => l.code === "TAX");
    const loans = sum((l) => l.source === "loan");
    const otherDed = sum((l) => l.kind === "deduction") - penEmp - tax - loans;
    const net = ppl.reduce((a, p) => a + Number(p.net_pay), 0);
    rows = [["Account code", "Account", "Debit", "Credit"]];
    const add = (key: string, fallback: string, debit: number, credit: number) => {
      if (!debit && !credit) return;
      const [code, name] = acct(key, fallback);
      rows.push([code, name, debit ? money(debit) : "", credit ? money(credit) : ""]);
    };
    add("salary_expense", "Salaries and wages", earnings, 0);
    add("claims_expense", "Staff claims", claims, 0);
    add("pension_employer_expense", "Employer pension", penEr, 0);
    add("net_pay_payable", "Net pay owed to staff", 0, net);
    add("pension_employee_payable", "Pension owed (staff part)", 0, penEmp);
    add("pension_employer_payable", "Pension owed (employer part)", 0, penEr);
    add("tax_payable", "Income tax owed", 0, tax);
    add("loans_receivable", "Staff loans repaid", 0, loans);
    add("other_deductions", "Other deductions", 0, otherDed);
  } else {
    rows = [["Employee no.", "Name", "Department", "Days paid", "Basic salary", "Earnings", "Deductions", "Net pay", "Employer pension"]];
    for (const p of ppl) rows.push([p.employee_code, p.employee_name, p.department_name, Number(p.paid_days).toFixed(1), money(p.basic_salary), money(p.gross_pay), money(p.total_deductions), money(p.net_pay), money(p.employer_contributions)]);
  }

  const name = `${run.name} ${type}`.replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase();
  return new NextResponse("﻿" + toCsv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
  });
}
