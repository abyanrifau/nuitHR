/**
 * Times the main signed-in pages.
 *   npx tsx scripts/perf/measure.mts <base-url> <state-file> [runs]
 * "open" = typing the address (full page); "switch" = clicking a link in
 * the app, which fetches only the page data (an RSC request).
 */
import { readFileSync } from "node:fs";

const [base, stateFile, runsArg] = process.argv.slice(2);
const { cookie } = JSON.parse(readFileSync(stateFile, "utf8"));
const RUNS = Number(runsArg ?? 7);
const PAGES: [string, string][] = [
  ["Home", "/app"],
  ["People", "/app/people"],
  ["Requests", "/app/requests"],
  ["Time off", "/app/time-off"],
  ["Payroll", "/app/payroll"],
  ["Workspace", "/app/workspace/company"],
];

async function once(path: string, rsc: boolean) {
  const t0 = performance.now();
  const res = await fetch(base + path + (rsc ? `?_rsc=${Math.random().toString(36).slice(2, 7)}` : ""), {
    redirect: "manual",
    headers: { cookie, ...(rsc ? { RSC: "1" } : {}), "cache-control": "no-cache" },
  });
  const ttfb = performance.now() - t0;
  const body = await res.arrayBuffer();
  const total = performance.now() - t0;
  if (res.status !== 200) throw new Error(`${path} returned ${res.status} ${res.headers.get("location") ?? ""}`);
  return { ttfb, total, bytes: body.byteLength, region: res.headers.get("x-vercel-id")?.split("::").slice(0, -1).join("→") ?? "local" };
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const rows = [];
for (const [name, path] of PAGES) {
  await once(path, false);
  const open = [], sw = [];
  let region = "", kb = 0;
  for (let i = 0; i < RUNS; i++) {
    const a = await once(path, false);
    const b = await once(path, true);
    open.push(a.total);
    sw.push(b.total);
    region = a.region;
    kb = Math.round(a.bytes / 1024);
  }
  rows.push({ page: name, open_ms: Math.round(median(open)), switch_ms: Math.round(median(sw)), html_kb: kb, region });
}
console.table(rows);
console.log(JSON.stringify(rows));
