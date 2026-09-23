/**
 * Lists every signed-in page with how many database calls it makes and how
 * many "rounds" (calls that had to wait for an earlier one). Needs a local
 * `next start` with PERF_LOG and scripts/perf/log-fetch.mjs preloaded.
 *   npx tsx scripts/perf/waterfall.mts <base-url> <state-file> <log-file>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [base, stateFile, logFile] = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const bid = state.businessId;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped query builder in a test script
const first = async (table: string, extra: (q: any) => any = (q) => q) => ((await extra(db.from(table).select("id").eq("business_id", bid)).limit(1)).data?.[0]?.id as string) ?? "none";

const ids = {
  person: await first("employees"),
  run: await first("payroll_runs"),
  vacancy: await first("vacancies"),
  checklist: await first("employee_checklists"),
  course: await first("courses"),
  cycle: await first("review_cycles"),
  review: await first("reviews"),
  survey: await first("surveys"),
};
const routes = [
  "/app", "/app/account", "/app/claims", "/app/hiring", `/app/hiring/${ids.vacancy}`, "/app/hiring/new", "/app/joiners-leavers",
  `/app/joiners-leavers/${ids.checklist}`, "/app/joiners-leavers/checklists", "/app/letters", "/app/news", "/app/notifications", "/app/payroll",
  `/app/payroll/${ids.run}`, "/app/people", `/app/people/${ids.person}`, "/app/people/new", "/app/people/org-chart", "/app/permits", "/app/requests",
  "/app/reviews", `/app/reviews/${ids.cycle}`, "/app/reviews/goals", `/app/reviews/review/${ids.review}`, "/app/reviews/surveys", `/app/reviews/surveys/${ids.survey}`,
  "/app/time", "/app/time-off", "/app/time-off/calendar", "/app/time/roster", "/app/time/timesheets", "/app/training", `/app/training/${ids.course}`,
  "/app/training/paid", "/app/workspace/activity", "/app/workspace/billing", "/app/workspace/company", "/app/workspace/data", "/app/workspace/notifications",
  "/app/workspace/people", "/app/workspace/requests", "/app/workspace/support", "/app/workspace/tools",
  "/staff", "/staff/time", "/staff/time-off", "/staff/requests", "/staff/pay", "/staff/me", "/staff/notifications", "/staff/documents", "/staff/letters",
  "/staff/learning", "/staff/reviews", "/staff/surveys", "/staff/tasks", "/staff/claims", "/staff/goals",
];

const out: { route: string; status: number; ms: number; calls: number; rounds: number }[] = [];
for (const route of routes) {
  const get = () => fetch(`${base}${route}?_rsc`, { redirect: "manual", headers: { cookie: state.cookie, RSC: "1" } });
  await (await get()).arrayBuffer();
  writeFileSync(logFile, "");
  const t0 = performance.now();
  const res = await get();
  await res.arrayBuffer();
  const ms = Math.round(performance.now() - t0);
  await new Promise((r) => setTimeout(r, 150));
  const lines = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("\t").map((x, i) => (i < 2 ? Number(x) : x)) as [number, number, string, string]);
  lines.sort((a, b) => a[0] - b[0]);
  // A call starts a new round if it began after an earlier call had finished.
  let rounds = 0, roundEnd = -Infinity;
  for (const [start, dur] of lines) {
    if (start >= roundEnd - 5) { rounds++; roundEnd = start + dur; } else roundEnd = Math.max(roundEnd, start + dur);
  }
  out.push({ route: route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, "[id]"), status: res.status, ms, calls: lines.length, rounds });
}
out.sort((a, b) => b.rounds - a.rounds || b.ms - a.ms);
console.table(out);
