/**
 * PERFORMANCE TEST ACCOUNT (for measuring page speed while signed in).
 *
 *   npx tsx scripts/perf/session.mts setup <state-file>
 *   npx tsx scripts/perf/session.mts teardown <state-file>
 *
 * "setup" creates a throwaway login, gives it the sample company from
 * scripts/demo-data.ts, and writes that login's session cookies to the
 * state file. "teardown" deletes the company and the login again.
 * Keep the state file out of the project folder: it holds a live session.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLIC_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const [cmd, stateFile] = process.argv.slice(2);
if (!stateFile) throw new Error("Pass a state file path.");
const run = (...args: string[]) => execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/demo-data.ts", ...args], { stdio: "inherit" });

if (cmd === "setup") {
  const email = `perf-check-${Date.now()}@example.com`;
  const password = randomBytes(18).toString("base64url") + "1a";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Speed Test" } });
  if (error) throw error;
  writeFileSync(stateFile, JSON.stringify({ email, userId: data.user.id }));
  run("create", email);

  const jar = new Map<string, string>();
  const ssr = createServerClient(URL_, PUBLIC_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const signIn = await ssr.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const { data: biz } = await admin.from("businesses").select("id").eq("created_by", data.user.id).single();
  jar.set("active_business_id", biz!.id);
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  writeFileSync(stateFile, JSON.stringify({ email, userId: data.user.id, businessId: biz!.id, cookie, cookies: [...jar] }));
  console.log(`Ready: ${email}`);
} else if (cmd === "teardown") {
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  run("remove", state.email);
  const { error } = await admin.auth.admin.deleteUser(state.userId);
  if (error) throw error;
  rmSync(stateFile);
  console.log(`Removed ${state.email}`);
} else {
  throw new Error("Use setup or teardown.");
}
