import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/utils";

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/app/people?x=1#top")).toBe("/app/people?x=1#top");
    expect(safeNextPath("/staff")).toBe("/staff");
  });
  it("refuses anything that could leave the site", () => {
    const bs = String.fromCharCode(92);
    const tab = String.fromCharCode(9);
    const nl = String.fromCharCode(10);
    for (const bad of ["//evil.com", "/" + bs + "evil.com", "/" + tab + "/evil.com", "/" + tab + "evil.com", "https://evil.com", "evil.com", "/" + nl + "/evil.com", bs + bs + "evil.com"]) {
      expect(safeNextPath(bad)).toBe("/app");
    }
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
  });
});
