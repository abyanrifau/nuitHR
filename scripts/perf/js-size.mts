/**
 * How much JavaScript the browser downloads to open each page (gzipped),
 * and which libraries are in it.
 *   npx tsx scripts/perf/js-size.mts <base-url> <state-file>
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const [base, stateFile] = process.argv.slice(2);
const { cookie } = JSON.parse(readFileSync(stateFile, "utf8"));
const pages = ["/app", "/app/people", "/app/requests", "/app/time-off", "/app/payroll", "/app/workspace/company", "/app/people/new", "/staff", "/staff/time-off"];
const cache = new Map<string, { gz: number; libs: string[] }>();
const MARKERS: [string, RegExp][] = [["supabase-js", /supabase\.co|GoTrueClient|PostgrestClient/], ["sonner", /data-sonner-toaster/], ["lucide", /lucide/], ["zod", /ZodError|\$ZodType/], ["next-themes", /next-themes|data-theme/]];
const shared = new Set<string>();
const rows = [];
for (const p of pages) {
  const html = await (await fetch(base + p, { headers: { cookie } })).text();
  const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))];
  let total = 0;
  const libs = new Set<string>();
  for (const s of srcs) {
    if (!cache.has(s)) {
      const body = Buffer.from(await (await fetch(base + s)).arrayBuffer());
      const text = body.toString("utf8");
      cache.set(s, { gz: gzipSync(body).length, libs: MARKERS.filter(([, re]) => re.test(text)).map(([n]) => n) });
    }
    const c = cache.get(s)!;
    total += c.gz;
    c.libs.forEach((l) => libs.add(l));
  }
  rows.push({ page: p, scripts: srcs.length, js_kb_gzip: Math.round(total / 1024), libraries: [...libs].join(", ") });
}
console.table(rows);
void shared;
