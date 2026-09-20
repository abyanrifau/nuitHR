import { afterEach, describe, expect, it, vi } from "vitest";

/** Email links and redirects must use the real web address, not the vercel.app one. */
const load = async () => {
  vi.resetModules();
  return (await import("../src/lib/env")).siteUrl();
};

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("the web address used in links", () => {
  it("uses the setting when it is there", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://harbor.nuit.works/";
    expect(await load()).toBe("https://harbor.nuit.works");
  });

  it("falls back to the address in the config file, not the vercel.app one", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_URL = "nuithr.vercel.app";
    vi.stubEnv("NODE_ENV", "production");
    expect(await load()).toBe("https://harbor.nuit.works");
    vi.unstubAllEnvs();
  });

  it("stays on localhost while developing", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;
    expect(await load()).toBe("http://localhost:3000");
  });
});
