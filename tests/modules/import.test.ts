import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { parseDate, previewImport, templateCsv } from "@/modules/employee-import";
import { defaultSetup, SETUP_ORDER, SETUP_SCHEMAS, type SetupModule } from "@/modules/setup-defaults";
import { holidaySeeds } from "@/modules/data/holidays-mv";

const ctx = { branches: ["Malé Office", "Resort Island"], existingCodes: ["E0001"], existingEmails: ["taken@x.mv"], businessCountry: "MV" };

describe("CSV", () => {
  it("handles quotes, commas, line breaks and Excel's BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\n\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["multi\nline", "z"]]);
    expect(parseCsv(toCsv([["x, y", 'q"'], ["1", ""]]))).toEqual([["x, y", 'q"'], ["1", ""]]);
  });
});

describe("dates", () => {
  it("reads DD/MM/YYYY and ISO dates and rejects impossible ones", () => {
    expect(parseDate("05/03/2025")).toBe("2025-03-05");
    expect(parseDate("5-3-2025")).toBe("2025-03-05");
    expect(parseDate("2025-03-05")).toBe("2025-03-05");
    expect(parseDate("31/02/2025")).toBeNull();
    expect(parseDate("March 5")).toBeNull();
  });
});

describe("employee import preview", () => {
  it("accepts the downloadable template as-is", () => {
    const p = previewImport(templateCsv(), ctx);
    expect(p.fileErrors).toEqual([]);
    expect(p.errorCount).toBe(0);
    expect(p.validCount).toBe(2);
    expect(p.rows[1].data).toMatchObject({ nationality: "IN", is_expatriate: true, join_date: "2024-06-15", contract_type: "fixed_term" });
    expect(p.rows[0].data.is_expatriate).toBe(false);
  });

  it("gives a clear message for each problem, with the spreadsheet row number", () => {
    const csv = [
      "Employee ID,First name,Email,Branch,Join date,Gender,Nationality,Contract type,Manager's employee ID",
      "E0001,Ali,ali@x.mv,Malé Office,01/01/2025,m,MV,permanent,",
      "X1,,bad-email,Atlantis,32/01/2025,robot,Narnia,forever,NOPE",
      "X2,Sara,taken@x.mv,resort island,01/01/2025,f,maldivian,Part time,X2",
      "X2,Omar,omar@x.mv,,,,,,",
    ].join("\n");
    const p = previewImport(csv, ctx);
    const errs = (line: number) => p.rows.find((r) => r.line === line)!.errors.join(" | ");
    expect(errs(2)).toMatch(/Employee ID "E0001" is already used/);
    expect(errs(3)).toMatch(/First name is missing/);
    expect(errs(3)).toMatch(/isn't a valid email/);
    expect(errs(3)).toMatch(/Branch "Atlantis" doesn't exist/);
    expect(errs(3)).toMatch(/isn't a date/);
    expect(errs(3)).toMatch(/Gender "robot"/);
    expect(errs(3)).toMatch(/Nationality "Narnia"/);
    expect(errs(3)).toMatch(/Contract type "forever"/);
    expect(errs(3)).toMatch(/Manager ID "NOPE"/);
    expect(errs(4)).toMatch(/taken@x.mv already belongs/);
    expect(errs(4)).toMatch(/can't be their own manager/);
    expect(p.rows.find((r) => r.line === 4)!.data).toMatchObject({ branch: "Resort Island", contract_type: "part_time", nationality: "MV" });
    expect(errs(5)).toMatch(/also appears on row 4/);
    expect(p.errorCount).toBe(4);
  });

  it("explains files it can't use", () => {
    expect(previewImport("", ctx).fileErrors[0]).toMatch(/empty/);
    expect(previewImport("Name,Age\nA,1", ctx).fileErrors[0]).toMatch(/First name/);
    expect(previewImport("First name,Shoe size\nAli,9", ctx).fileNotices[0]).toMatch(/Shoe size/);
  });
});

describe("quick-setup defaults", () => {
  it("are valid for every module and every industry", () => {
    for (const industry of ["resort", "guesthouse", "hotel", "restaurant", "retail", "office", "construction", "manufacturing", "other"] as const) {
      for (const m of SETUP_ORDER as SetupModule[]) {
        const result = SETUP_SCHEMAS[m].safeParse(defaultSetup(m, { industry, country: "MV" }));
        expect(result.success, `${m}/${industry}: ${JSON.stringify(!result.success && result.error.issues)}`).toBe(true);
      }
    }
  });

  it("pre-loads Maldives holidays for this year and next only for the Maldives", () => {
    const h = holidaySeeds("MV", new Date("2026-09-18"));
    expect(h.some((x) => x.date === "2026-07-26")).toBe(true);
    expect(h.some((x) => x.date === "2027-11-11")).toBe(true);
    expect(holidaySeeds("IN", new Date("2026-09-18"))).toEqual([]);
  });
});
