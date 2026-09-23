// Preload for `next start`: logs every request the server makes to Supabase,
// with when it started and how long it took, to scripts/perf output.
import { appendFileSync } from "node:fs";
const out = process.env.PERF_LOG;
const orig = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("supabase.co")) return orig(input, init);
  const t0 = performance.now();
  try {
    return await orig(input, init);
  } finally {
    const u = new URL(url);
    appendFileSync(out, `${Math.round(t0)}\t${Math.round(performance.now() - t0)}\t${(init?.method ?? "GET").padEnd(5)}\t${u.pathname}${u.search.slice(0, 90)}\n`);
  }
};
