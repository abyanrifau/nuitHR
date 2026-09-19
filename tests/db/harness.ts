/**
 * In-memory Postgres (PGlite) with a minimal stand-in for Supabase's
 * `auth` and `storage` schemas, so the real migrations and Row Level
 * Security policies can be tested without Docker or a cloud project.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SUPABASE_STUBS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant select on auth.users to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

/** Creates an auth user (profile row is created by the trigger). */
export async function createUser(db: PGlite, email: string, fullName = email): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
     values ($1, jsonb_build_object('full_name', $2::text), now()) returning id`,
    [email, fullName],
  );
  return res.rows[0].id;
}

/**
 * Runs `fn` as a signed-in user (role `authenticated`, auth.uid() = userId),
 * exactly like a request coming through the Supabase API.
 * Pass null to run as an anonymous visitor.
 */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (tx: TxLike) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    return fn(tx);
  });
}

/** Runs as the trusted server (service role bypasses RLS). */
export async function asService<T>(db: PGlite, fn: (tx: TxLike) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`);
    return fn(tx);
  });
}

export type TxLike = {
  query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>;
  exec: (sql: string) => Promise<unknown>;
};
