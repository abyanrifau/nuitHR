-- =====================================================================
-- 0019 PLATFORM ADMIN AND SUBSCRIPTIONS
--   * Plan fields on each company: paid-until date, custom price or discount
--   * Plan status worked out from the dates: trial, active, grace (7 days
--     after the end), suspended (read-only) or cancelled
--   * Suspended companies are read-only: every change is refused by the
--     database, whatever screen it comes from. Viewing and exporting still work.
--   * Payments (recorded by Nuit Works), private admin notes, an admin audit
--     log and a record of reminder emails
--   * Support access shows everything except pay, and never allows changes
--   * Admin-only reports, callable with the server's secret key only
-- =====================================================================

-- ---------------------------------------------------------------------
-- Is this request made with the server's secret key (service role)?
-- Inside functions that run with elevated rights current_user changes,
-- but the role the request came in with stays in the "role" setting.
-- ---------------------------------------------------------------------
create or replace function private.is_service_request() returns boolean
language sql stable as $$
  select coalesce(current_setting('role', true), '') = 'service_role'
      or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
$$;

-- ---------------------------------------------------------------------
-- Plan fields
-- ---------------------------------------------------------------------
alter table public.businesses drop constraint if exists businesses_plan_status_check;
alter table public.businesses add constraint businesses_plan_status_check
  check (plan_status in ('trial', 'active', 'past_due', 'suspended', 'cancelled'));
alter table public.businesses
  add column if not exists paid_until timestamptz,
  add column if not exists custom_monthly_price numeric(12,2) check (custom_monthly_price is null or custom_monthly_price >= 0),
  add column if not exists discount_percent numeric(5,2) check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  add column if not exists price_override_until date,
  add column if not exists plan_note text;

-- Companies can't change their own plan, dates or price; only Nuit Works (server key) can.
create or replace function private.guard_business_plan() returns trigger
language plpgsql as $$
begin
  if private.is_client_context() and not private.is_service_request() and tg_op = 'UPDATE'
     and (new.plan_status is distinct from old.plan_status
          or new.trial_ends_at is distinct from old.trial_ends_at
          or new.paid_until is distinct from old.paid_until
          or new.custom_monthly_price is distinct from old.custom_monthly_price
          or new.discount_percent is distinct from old.discount_percent
          or new.price_override_until is distinct from old.price_override_until
          or new.plan_note is distinct from old.plan_note) then
    raise exception 'Only Harbor can change your plan' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_business_plan on public.businesses;
create trigger guard_business_plan before update on public.businesses
  for each row execute function private.guard_business_plan();

-- ---------------------------------------------------------------------
-- Plan status from the dates
-- ---------------------------------------------------------------------
create or replace function private.plan_state(p_status text, p_trial_ends timestamptz, p_paid_until timestamptz)
returns text
language sql stable as $$
  select case
    when p_status in ('suspended', 'cancelled') then p_status
    when coalesce(case when p_status = 'trial' then p_trial_ends else p_paid_until end, 'infinity'::timestamptz) > now() then
      case when p_status = 'trial' then 'trial' else 'active' end
    when case when p_status = 'trial' then p_trial_ends else p_paid_until end + interval '7 days' > now() then 'grace'
    else 'suspended'
  end
$$;

create or replace function private.business_state(p_business uuid) returns text
language sql stable security definer set search_path = '' as $$
  select private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until) from public.businesses b where b.id = p_business
$$;

create or replace function private.business_read_only(p_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.business_state(p_business) in ('suspended', 'cancelled'), false)
$$;

-- What members see about their company's plan (banners, Workspace → Billing).
create or replace function public.my_plan(p_business uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until),
    'plan_status', b.plan_status,
    'trial_ends_at', b.trial_ends_at,
    'paid_until', b.paid_until,
    'ends_at', case when b.plan_status = 'trial' then b.trial_ends_at else b.paid_until end,
    'custom_monthly_price', b.custom_monthly_price,
    'discount_percent', b.discount_percent,
    'price_override_until', b.price_override_until)
  from public.businesses b
  where b.id = p_business and b.id in (select private.my_business_ids())
$$;
revoke all on function public.my_plan(uuid) from public, anon;
grant execute on function public.my_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Read-only when suspended: refuse changes made by people (not by the
-- server key or scheduled jobs, which have no signed-in user).
-- ---------------------------------------------------------------------
create or replace function private.block_when_read_only() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_bid uuid;
begin
  if auth.uid() is null or private.is_service_request() then return coalesce(new, old); end if;
  v_bid := coalesce((v_row ->> 'business_id')::uuid, case when tg_table_name = 'businesses' then (v_row ->> 'id')::uuid end);
  if v_bid is not null and private.business_read_only(v_bid) then
    raise exception 'This company''s Harbor plan is paused, so changes can''t be saved. You can still view and export your data. Contact Nuit Works to reactivate.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- Tables that stay writable while paused: reading notifications, choosing
-- notification settings, exporting data, and turning support access on.
create or replace function private.read_only_exempt(p_table text) returns boolean
language sql immutable as $$
  select p_table in ('notifications', 'notification_preferences', 'notification_deliveries', 'data_exports',
                     'support_access_grants', 'audit_log', 'onboarding_drafts',
                     'platform_payments', 'platform_admin_notes', 'platform_audit_log', 'platform_billing_reminders')
$$;

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

    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'business_id')
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

-- Files: no uploads or deletions while paused (downloads still work).
do $$
declare d text;
begin
  d := pg_get_functiondef('private.storage_can(text, text)'::regprocedure);
  d := replace(d,
    '  v_area := parts[2];',
    '  if p_action <> ''view'' and parts[2] <> ''exports'' and private.business_read_only(v_bid) then
    return false;
  end if;

  v_area := parts[2];');
  if d not like '%business_read_only(v_bid)%' then
    raise exception 'storage_can did not match the expected text';
  end if;
  execute d;
end $$;

-- ---------------------------------------------------------------------
-- Support access: read-only, and never pay data
-- ---------------------------------------------------------------------
create or replace function private.my_scopes(p_resource text, p_action text)
returns table (business_id uuid, employee_id uuid, scope text)
language sql stable security definer set search_path = '' as $$
  select m.business_id, m.employee_id,
         case when r.is_owner then 'all'
              else (select rp.scope from public.role_permissions rp
                     where rp.role_id = m.role_id and rp.resource = p_resource and rp.action = p_action)
         end
    from public.business_members m
    join public.roles r on r.id = m.role_id and r.business_id = m.business_id
   where m.user_id = auth.uid() and m.status = 'active'
  union all
  -- Temporary support access is read-only and leaves out pay.
  select g.business_id, null::uuid, 'all'
    from public.support_access_grants g
   where p_action = 'view' and p_resource not in ('compensation', 'payroll', 'payslips')
     and g.revoked_at is null and g.expires_at > now()
     and exists (select 1 from public.platform_admins p where p.user_id = auth.uid())
     and not exists (select 1 from public.business_members m2 where m2.business_id = g.business_id and m2.user_id = auth.uid())
$$;

-- Companies a platform admin may open as support right now.
create or replace function public.my_support_access()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'business_id', b.id,
    'business_name', b.name,
    'logo_path', b.logo_path,
    'currency', b.currency,
    'timezone', b.timezone,
    'date_format', b.date_format,
    'country', b.country,
    'onboarding_completed_at', b.onboarding_completed_at,
    'support_expires_at', g.expires_at,
    'modules', coalesce((select jsonb_agg(bm.module_key order by bm.module_key)
                           from public.business_modules bm
                          where bm.business_id = b.id and bm.enabled), '[]'::jsonb)
  ) order by b.name), '[]'::jsonb)
  from public.businesses b
  join lateral (select max(g2.expires_at) as expires_at from public.support_access_grants g2
                 where g2.business_id = b.id and g2.revoked_at is null and g2.expires_at > now()) g on g.expires_at is not null
  where exists (select 1 from public.platform_admins p where p.user_id = auth.uid())
    and not exists (select 1 from public.business_members m where m.business_id = b.id and m.user_id = auth.uid())
$$;
revoke all on function public.my_support_access() from public, anon;
grant execute on function public.my_support_access() to authenticated;

-- ---------------------------------------------------------------------
-- Nuit Works tables (only the server key reads and writes these,
-- except that owners can see their own payment history)
-- ---------------------------------------------------------------------
create table if not exists public.platform_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'MVR',
  paid_on date not null,
  method text not null check (method in ('bank_transfer', 'mobile_payment', 'cash', 'other')),
  reference text,
  receipt_path text,
  period_start date,
  period_end date,
  notes text,
  recorded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index if not exists platform_payments_business_idx on public.platform_payments (business_id, paid_on desc);
alter table public.platform_payments enable row level security;
drop policy if exists owner_select on public.platform_payments;
create policy owner_select on public.platform_payments for select to authenticated
  using (private.is_owner(business_id));

create table if not exists public.platform_admin_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
alter table public.platform_admin_notes enable row level security;

create table if not exists public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid,
  admin_email text not null,
  action text not null,
  business_id uuid references public.businesses (id) on delete set null,
  business_name text,
  reason text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_business_idx on public.platform_audit_log (business_id, created_at desc);
create index if not exists platform_audit_created_idx on public.platform_audit_log (created_at desc);
alter table public.platform_audit_log enable row level security;

create table if not exists public.platform_billing_reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null,
  period_end timestamptz,
  sent_at timestamptz not null default now(),
  unique (business_id, kind, period_end)
);
alter table public.platform_billing_reminders enable row level security;

-- Nobody signed in to the app reads or writes these; only the server key (which skips these rules).
drop policy if exists no_app_access on public.platform_admin_notes;
create policy no_app_access on public.platform_admin_notes for all to authenticated using (false) with check (false);
drop policy if exists no_app_access on public.platform_audit_log;
create policy no_app_access on public.platform_audit_log for all to authenticated using (false) with check (false);
drop policy if exists no_app_access on public.platform_billing_reminders;
create policy no_app_access on public.platform_billing_reminders for all to authenticated using (false) with check (false);

-- ---------------------------------------------------------------------
-- Keep the platform_admins table (used by support access) in line with
-- the PLATFORM_ADMIN_EMAILS setting. Server key only.
-- ---------------------------------------------------------------------
create or replace function public.admin_sync_platform_admins(p_emails text[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  delete from public.platform_admins p
   where not exists (select 1 from auth.users u where u.id = p.user_id and lower(u.email) = any (select lower(x) from unnest(p_emails) x));
  insert into public.platform_admins (user_id)
  select u.id from auth.users u
   where lower(u.email) = any (select lower(x) from unnest(p_emails) x) and u.email_confirmed_at is not null
  on conflict (user_id) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Admin reports (server key only). Never returns people's HR data.
-- ---------------------------------------------------------------------
create or replace function public.admin_businesses()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', b.id, 'name', b.name, 'slug', b.slug, 'industry', b.industry, 'country', b.country, 'currency', b.currency,
        'employee_count_range', b.employee_count_range, 'created_at', b.created_at, 'onboarding_completed_at', b.onboarding_completed_at,
        'plan_status', b.plan_status, 'status', private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until),
        'trial_ends_at', b.trial_ends_at, 'paid_until', b.paid_until,
        'custom_monthly_price', b.custom_monthly_price, 'discount_percent', b.discount_percent, 'price_override_until', b.price_override_until,
        'staff_count', (select count(*) from public.employees e where e.business_id = b.id and e.status in ('active', 'probation', 'on_leave', 'suspended')),
        'modules', coalesce((select jsonb_agg(bm.module_key order by bm.module_key) from public.business_modules bm where bm.business_id = b.id and bm.enabled), '[]'::jsonb),
        'owner', (select jsonb_build_object('name', p.full_name, 'email', u.email, 'phone', coalesce(p.phone, b.phone))
                    from public.business_members m join public.roles r on r.id = m.role_id and r.is_owner
                    join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
                   where m.business_id = b.id and m.status = 'active' order by m.created_at limit 1),
        'last_active', (select max(u.last_sign_in_at) from public.business_members m join auth.users u on u.id = m.user_id
                         where m.business_id = b.id and m.status = 'active'),
        'last_payment', (select max(pp.paid_on) from public.platform_payments pp where pp.business_id = b.id),
        'support_until', (select max(g.expires_at) from public.support_access_grants g where g.business_id = b.id and g.revoked_at is null and g.expires_at > now())
      ) as x
      from public.businesses b
    ) t
  );
end $$;

create or replace function public.admin_business_detail(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', now())::date;
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'business', to_jsonb(b) - 'signature_path' - 'stamp_path' || jsonb_build_object('status', private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until)),
      'admins', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'email', u.email, 'phone', p.phone, 'role', r.name,
                                                               'is_owner', r.is_owner, 'last_sign_in', u.last_sign_in_at) order by r.is_owner desc, r.name)
                            from public.business_members m join public.roles r on r.id = m.role_id
                            join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
                           where m.business_id = b.id and m.status = 'active'
                             and (r.is_owner or r.key in ('admin', 'hr_manager', 'payroll_officer'))), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(br.name order by br.name) from public.branches br where br.business_id = b.id), '[]'::jsonb),
      'staff_count', (select count(*) from public.employees e where e.business_id = b.id and e.status in ('active', 'probation', 'on_leave', 'suspended')),
      'logins', (select count(*) from public.business_members m where m.business_id = b.id and m.status = 'active'),
      'modules', coalesce((select jsonb_agg(bm.module_key order by bm.module_key) from public.business_modules bm where bm.business_id = b.id and bm.enabled), '[]'::jsonb),
      'last_active', (select max(u.last_sign_in_at) from public.business_members m join auth.users u on u.id = m.user_id where m.business_id = b.id and m.status = 'active'),
      'payroll_runs', (select count(*) from public.payroll_runs pr where pr.business_id = b.id),
      'requests_this_month', (select count(*) from public.approval_requests ar where ar.business_id = b.id and ar.created_at >= v_month),
      'support_until', (select max(g.expires_at) from public.support_access_grants g where g.business_id = b.id and g.revoked_at is null and g.expires_at > now())
    )
    from public.businesses b where b.id = p_business
  );
end $$;

-- Which owners should get a reminder email today (not sent yet for this period end).
create or replace function public.admin_billing_reminders_due()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('business_id', t.id, 'business_name', t.name, 'kind', t.kind, 'period_end', t.ends_at,
                                                 'plan_status', t.plan_status, 'timezone', t.timezone, 'owner_emails', t.owners)), '[]'::jsonb)
    from (
      select b.id, b.name, b.plan_status, b.timezone, e.ends_at,
             case
               when private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until) = 'suspended' and b.plan_status <> 'suspended' then 'suspended'
               when e.ends_at between now() and now() + interval '1 day' then 'ends_1'
               when e.ends_at between now() + interval '1 day' and now() + interval '7 days' then 'ends_7'
             end as kind,
             (select coalesce(jsonb_agg(u.email), '[]'::jsonb) from public.business_members m join public.roles r on r.id = m.role_id and r.is_owner
                join auth.users u on u.id = m.user_id where m.business_id = b.id and m.status = 'active') as owners
        from public.businesses b
        cross join lateral (select case when b.plan_status = 'trial' then b.trial_ends_at else b.paid_until end as ends_at) e
       where b.plan_status not in ('cancelled') and e.ends_at is not null and b.onboarding_completed_at is not null
    ) t
    where t.kind is not null
      and not exists (select 1 from public.platform_billing_reminders r
                       where r.business_id = t.id and r.kind = t.kind and r.period_end = t.ends_at)
  );
end $$;

-- Nuit Works can switch tools on or off for a company (same rules as the company's own screen).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.set_business_modules(uuid, text[])'::regprocedure);
  d := replace(d,
    'if p_business not in (select private.biz_all(''modules'', ''edit'')) then',
    'if not private.is_service_request() and p_business not in (select private.biz_all(''modules'', ''edit'')) then');
  if d not like '%is_service_request()%' then
    raise exception 'set_business_modules did not match the expected text';
  end if;
  execute d;
end $$;

revoke all on function public.admin_sync_platform_admins(text[]) from public, anon, authenticated;
revoke all on function public.admin_businesses() from public, anon, authenticated;
revoke all on function public.admin_business_detail(uuid) from public, anon, authenticated;
revoke all on function public.admin_billing_reminders_due() from public, anon, authenticated;
grant execute on function public.admin_sync_platform_admins(text[]) to service_role;
grant execute on function public.admin_businesses() to service_role;
grant execute on function public.admin_business_detail(uuid) to service_role;
grant execute on function public.admin_billing_reminders_due() to service_role;
grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
