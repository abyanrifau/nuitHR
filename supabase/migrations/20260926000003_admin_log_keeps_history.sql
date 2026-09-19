-- =====================================================================
-- 0021 Deleting a company keeps Nuit Works' admin log.
--   The admin log's link to the company is cleared when the company is
--   deleted (the company name stays in the entry). The general rule that a
--   record can't move to another company must not block that.
-- =====================================================================
create or replace procedure private.finalize_tenant_tables()
language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'updated_at')
       and not exists (select 1 from pg_trigger where tgname = 'trg_set_updated_at' and tgrelid = format('public.%I', r.relname)::regclass) then
      execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function private.set_updated_at()', r.relname);
    end if;

    -- The admin log outlives the companies it mentions, so it's left out here.
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'business_id')
       and r.relname <> 'platform_audit_log'
       and not exists (select 1 from pg_trigger where tgname = 'trg_lock_business_id' and tgrelid = format('public.%I', r.relname)::regclass) then
      execute format('create trigger trg_lock_business_id before update on public.%I for each row execute function private.lock_business_id()', r.relname);
    end if;

    -- Paused companies are read-only.
    if (r.relname = 'businesses' or exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'business_id'))
       and not private.read_only_exempt(r.relname)
       and not exists (select 1 from pg_trigger where tgname = 'trg_read_only' and tgrelid = format('public.%I', r.relname)::regclass) then
      execute format('create trigger trg_read_only before insert or update or delete on public.%I for each row execute function private.block_when_read_only()', r.relname);
    end if;
  end loop;

  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise exception 'Security check failed: table public.% has no Row Level Security', r.relname;
  end loop;
end $$;

drop trigger if exists trg_lock_business_id on public.platform_audit_log;

call private.finalize_tenant_tables();
