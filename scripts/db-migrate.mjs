#!/usr/bin/env node
/**
 * Installs (or updates) the database tables in your Supabase project.
 *
 *   npm run db:migrate           apply any new database changes
 *   npm run db:migrate -- --status   list which changes are applied
 *
 * It reads DATABASE_URL from .env.local, runs every file in
 * supabase/migrations that hasn't been applied yet (oldest first), and
 * remembers what it ran. Each file runs in a transaction, so a failure
 * leaves the database unchanged.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

const root = process.cwd();
if (existsSync(path.join(root, ".env.local"))) config({ path: path.join(root, ".env.local"), quiet: true });
config({ quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(`
  ✖ DATABASE_URL is missing.

    1. In Supabase, click "Connect" at the top of your project.
    2. Choose "Session pooler" and copy the connection string.
    3. Replace [YOUR-PASSWORD] with your database password.
    4. Paste it into .env.local as:  DATABASE_URL=postgresql://...
`);
  process.exit(1);
}

const dir = path.join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const statusOnly = process.argv.includes("--status");

const sql = postgres(url, { max: 1, ssl: url.includes("localhost") ? false : "require", onnotice: () => {} });

try {
  await sql`create schema if not exists private`;
  await sql`create table if not exists private.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from private.schema_migrations`).map((r) => r.name));

  if (statusOnly) {
    for (const f of files) console.log(`${applied.has(f) ? "✔ applied" : "• pending"}  ${f}`);
    process.exit(0);
  }

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("✔ Database is already up to date.");
  }
  for (const file of pending) {
    process.stdout.write(`→ Applying ${file} … `);
    const body = readFileSync(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into private.schema_migrations (name) values (${file})`;
    });
    console.log("done");
  }
  if (pending.length) console.log(`✔ Applied ${pending.length} change(s). Your database is ready.`);
} catch (err) {
  console.error(`\n✖ Database setup failed: ${err.message}`);
  if (/password authentication failed/i.test(err.message)) {
    console.error("  The database password in DATABASE_URL is wrong. Reset it in Supabase → Project Settings → Database.");
  } else if (/ENOTFOUND|getaddrinfo/i.test(err.message)) {
    console.error("  The address in DATABASE_URL can't be found. Copy the Session pooler string again from Supabase → Connect.");
  }
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
