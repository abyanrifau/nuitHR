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
