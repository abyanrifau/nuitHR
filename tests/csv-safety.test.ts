import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("CSV exports", () => {
  it("stops text from running as a spreadsheet formula", () => {
    const out = toCsv([["=HYPERLINK(\"http://evil\")", "+1+2", "@SUM(A1)", "-cmd"]]);
    expect(out.startsWith("\"'=HYPERLINK")).toBe(true);
    expect(out).toContain("'+1+2");
    expect(out).toContain("'@SUM(A1)");
    expect(out).toContain("'-cmd");
  });

  it("leaves ordinary numbers and text alone", () => {
    expect(toCsv([["-250.00", "12000", "+5", "Aishath"]])).toBe("-250.00,12000,+5,Aishath\r\n");
  });
});
