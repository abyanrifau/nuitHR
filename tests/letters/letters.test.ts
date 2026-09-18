import { describe, expect, it } from "vitest";
import { mergeValues, renderTemplate } from "@/lib/letters/merge";
import { renderLetterPdf } from "@/lib/letters/pdf";

const data = {
  employee: {
    first_name: "Aishath",
    last_name: "Shifza",
    employee_code: "EMP-0001",
    join_date: "2022-03-01",
    exit_date: null,
    national_id: "A123456",
    passport_no: null,
    nationality: "MV",
    position: "Receptionist",
    department: "Front office",
    salary: { amount: 12000, currency: "MVR" },
  },
  company: { name: "Sunset Resort", address: "K. Malé", registration_no: null, date_format: "DD/MM/YYYY" },
  letter: { purpose: "a bank loan", date: "2026-09-19" },
};

describe("letters", () => {
  it("fills in merge fields and flags missing ones", () => {
    const r = renderTemplate("{{employee.full_name}} joined on {{employee.join_date}} earning {{employee.salary}}. Passport {{employee.passport_no}}.", mergeValues(data));
    expect(r.text).toBe("Aishath Shifza joined on 01/03/2022 earning MVR 12,000.00. Passport [Passport no.].");
    expect(r.missing).toEqual(["employee.passport_no"]);
  });

  it("draws a PDF", async () => {
    const pdf = await renderLetterPdf({
      company: { name: "Sunset Resort", address: "K. Malé", phone: null, email: null, registration_no: "C-1/2020", footer: "Sunset Resort · K. Malé" },
      images: {},
      signatory: { name: "Ali Ahmed", title: "HR manager" },
      date: "19/09/2026",
      reference: "EMP-0001/20260919/ABCD",
      addressedTo: "The Manager",
      subject: "To whom it may concern",
      body: "First paragraph.\n\nSecond paragraph.",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe("payslips", () => {
  it("draws a payslip PDF", async () => {
    const { renderPayslipPdf } = await import("@/lib/payroll/payslip");
    const pdf = await renderPayslipPdf({
      company: { name: "Sunset Resort", address: "K. Malé", logo: null, currency: "MVR", date_format: "DD/MM/YYYY", footer: null },
      run: { name: "September 2026 payroll", period_start: "2026-09-01", period_end: "2026-09-30", pay_date: "2026-09-28" },
      person: { employee_name: "Sara Staff", employee_code: "E2", position_title: "Receptionist", department_name: "Front office", bank_name: "Bank of Maldives", bank_account_number: "7730000123456", paid_days: 30, period_days: 30, gross_pay: 12085, total_deductions: 840, net_pay: 11245, employer_contributions: 840 },
      lines: [
        { name: "Basic salary", kind: "earning", amount: 12000, quantity: 30, sort: 0 },
        { name: "Transport claim 19 Sep", kind: "earning", amount: 85, quantity: null, sort: 60 },
        { name: "Pension (7%)", kind: "deduction", amount: 840, quantity: null, sort: 90 },
        { name: "Employer pension (7%)", kind: "employer_contribution", amount: 840, quantity: null, sort: 95 },
      ],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PAYSLIP_OUT) (await import("node:fs")).writeFileSync(process.env.PAYSLIP_OUT, pdf);
  });
});
