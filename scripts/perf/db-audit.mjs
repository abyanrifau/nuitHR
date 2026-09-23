// Read-only checks on the live database: foreign keys without an index,
// and security (RLS) policies that call auth.uid() or helper functions
// once per row instead of once per query.
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

const fks = await sql`
  with fk as (
    select c.conrelid, c.conname, c.conkey, c.conrelid::regclass::text as tbl,
           (select array_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
      from pg_constraint c
      join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = c.conrelid)
     where c.contype = 'f' and n.nspname = 'public')
  select tbl, cols from fk
   where not exists (
     select 1 from pg_index i
      where i.indrelid = fk.conrelid
        and (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] @> fk.conkey
        and (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] <@ fk.conkey)
   order by 1`;
console.log(`Foreign keys with no index: ${fks.length}`);
for (const f of fks) console.log(`  ${f.tbl} (${f.cols.join(", ")})`);

const pol = await sql`
  select schemaname||'.'||tablename as tbl, policyname, cmd, coalesce(qual,'') as qual, coalesce(with_check,'') as chk
    from pg_policies where schemaname in ('public','storage')`;
const perRow = pol.filter((p) => /auth\.uid\(\)|auth\.jwt\(\)/.test((p.qual + p.chk).replace(/\(\s*select\s+auth\.(uid|jwt)\(\)[^)]*\)/gi, "")));
console.log(`\nPolicies: ${pol.length}; calling auth.uid()/auth.jwt() per row: ${perRow.length}`);
for (const p of perRow.slice(0, 40)) console.log(`  ${p.tbl} [${p.cmd}] ${p.policyname}: ${(p.qual || p.chk).slice(0, 140)}`);
const helpers = {};
for (const p of pol) for (const m of (p.qual + " " + p.chk).matchAll(/private\.([a-z_]+)\(/g)) helpers[m[1]] = (helpers[m[1]] ?? 0) + 1;
console.log(`\nHelper functions used in policies:`, helpers);
const sample = pol.find((p) => p.tbl === "public.employees" && p.cmd === "SELECT");
console.log(`\nExample, employees SELECT:\n  ${sample?.qual}`);
await sql.end();
