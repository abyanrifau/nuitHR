-- =====================================================================
-- 0008 TOOLS RESTRUCTURE
--   * Transport allowance claims + Expense claims become one "Claims" tool.
--     Transport is a built-in claim type next to meals, travel, supplies
--     and any custom types a business creates. Each type has its own rules.
--   * Claims no longer needs Payroll.
--   * Existing data is copied, never deleted: old claim tables stay as a
--     read-only archive, and every old claim appears under Claims.
--   * contact_messages stores the public contact form.
-- Internal keys (attendance, leave, recruitment...) stay the same; only
-- the names people see changed.
-- =====================================================================

create table public.claim_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  key text not null default 'custom' check (key in ('transport','meals','travel','supplies','custom')),
  cutoff_day smallint check (cutoff_day between 1 and 28),       -- claims after this day move to the next payroll
  max_amount numeric(12,2) check (max_amount is null or max_amount > 0),
  requires_receipt boolean not null default true,
  payout_method text not null default 'payroll' check (payout_method in ('payroll','separate')),
  account_code_id uuid,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, account_code_id) references public.account_codes (business_id, id) on delete set null (account_code_id)
);
create unique index claim_types_one_per_builtin on public.claim_types (business_id, key) where key <> 'custom';

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  claim_type_id uuid not null,
  claim_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'MVR',
  description text,
  route text,                                   -- transport: from/to
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid','cancelled')),
  -- 'payroll' = added to the next payroll run; 'separate' = paid outside payroll.
  -- Approved + not paid + (separate, or Payroll switched off) shows as "to be paid".
  payout_method text not null default 'payroll' check (payout_method in ('payroll','separate')),
  target_period_start date,
  is_late boolean not null default false,
  payroll_run_id uuid,
  paid_at timestamptz,
  paid_reference text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  legacy_source text check (legacy_source in ('transport_claims','expense_claims')),
  legacy_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (legacy_source, legacy_id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, claim_type_id) references public.claim_types (business_id, id),
  foreign key (business_id, payroll_run_id) references public.payroll_runs (business_id, id) on delete set null (payroll_run_id)
);
create index claims_status_idx on public.claims (business_id, status, claim_date);
create index claims_employee_idx on public.claims (business_id, employee_id);

-- Public contact form (written only by the server; nobody can read it through the API).
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  phone text,
  message text not null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.contact_messages enable row level security;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
call private.std_rls('claim_types', 'claims', null, true);

alter table public.claims enable row level security;
create policy tenant_select on public.claims for select to authenticated
  using (business_id in (select private.biz_all('claims', 'view'))
         or employee_id in (select private.emp_scope('claims', 'view')));
-- Staff submit their own claims, always as 'pending'.
create policy tenant_insert on public.claims for insert to authenticated
  with check ((business_id in (select private.biz_all('claims', 'create'))
               or employee_id in (select private.emp_scope('claims', 'create')))
              and (status = 'pending' or business_id in (select private.biz_all('claims', 'approve'))));
create policy tenant_update on public.claims for update to authenticated
  using (business_id in (select private.biz_all('claims', 'edit')))
  with check (business_id in (select private.biz_all('claims', 'edit')));
create policy tenant_delete on public.claims for delete to authenticated
  using (business_id in (select private.biz_all('claims', 'delete')));

create trigger audit_claims after update or delete on public.claims
  for each row execute function private.audit_row('claims', 'employee_id');

-- The old claim tables become a read-only archive (their rows are copied into claims below).
drop policy if exists tenant_select on public.transport_claims;
drop policy if exists tenant_insert on public.transport_claims;
drop policy if exists tenant_update on public.transport_claims;
drop policy if exists tenant_delete on public.transport_claims;
create policy archive_select on public.transport_claims for select to authenticated
  using (business_id in (select private.biz_all('claims', 'view'))
         or employee_id in (select private.emp_scope('claims', 'view')));

drop policy if exists tenant_select on public.expense_claims;
drop policy if exists tenant_insert on public.expense_claims;
drop policy if exists tenant_update on public.expense_claims;
drop policy if exists tenant_delete on public.expense_claims;
create policy archive_select on public.expense_claims for select to authenticated
  using (business_id in (select private.biz_all('claims', 'view'))
         or employee_id in (select private.emp_scope('claims', 'view')));

drop policy if exists tenant_select on public.expense_categories;
drop policy if exists tenant_insert on public.expense_categories;
drop policy if exists tenant_update on public.expense_categories;
drop policy if exists tenant_delete on public.expense_categories;
create policy archive_select on public.expense_categories for select to authenticated
  using (business_id in (select private.my_business_ids()));

-- Payroll lines may now come from a claim.
alter table public.payroll_run_lines drop constraint if exists payroll_run_lines_source_check;
alter table public.payroll_run_lines add constraint payroll_run_lines_source_check
  check (source in ('salary','component','overtime','leave','absence','claim','transport_claim','expense_claim','loan','statutory','manual','adjustment'));

-- ---------------------------------------------------------------------
-- Tool list: Transport + Expenses become Claims
-- ---------------------------------------------------------------------
delete from private.module_catalog where key in ('transport', 'expenses');
insert into private.module_catalog (key, is_core, requires) values ('claims', false, '{}')
on conflict (key) do update set requires = '{}';


-- Starter claim types are added the first time Claims is switched on.

create or replace function private.seed_module_defaults(p_business uuid, p_module text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tpl uuid;
begin
  if p_module = 'compliance' and not exists (select 1 from public.compliance_types where business_id = p_business) then
    insert into public.compliance_types (business_id, name, key, applies_to, remind_days_before, field_schema) values
      (p_business, 'Work permit', 'work_permit', 'expatriates', '{90,60,30,7}',
        '[{"key":"permit_no","label":"Work permit number","type":"text"},{"key":"employer_on_permit","label":"Employer named on permit","type":"text"},{"key":"deposit_amount","label":"Deposit amount","type":"number"},{"key":"insurance_policy_no","label":"Insurance policy number","type":"text"},{"key":"insurance_expiry","label":"Insurance expiry","type":"date"}]'::jsonb),
      (p_business, 'Passport', 'passport', 'all', '{180,90,30}', '[]'::jsonb),
      (p_business, 'Visa', 'visa', 'expatriates', '{60,30,7}', '[]'::jsonb),
      (p_business, 'Employment contract', 'contract', 'all', '{60,30,7}', '[]'::jsonb),
      (p_business, 'Medical check', 'medical', 'expatriates', '{30,7}', '[]'::jsonb),
      (p_business, 'Professional licence', 'license', 'all', '{60,30}', '[]'::jsonb);
  end if;

  if p_module = 'expenses' and not exists (select 1 from public.expense_categories where business_id = p_business) then
    insert into public.expense_categories (business_id, name, requires_receipt)
    select p_business, c, c <> 'Other' from unnest(array['Travel','Meals','Office supplies','Fuel','Phone & internet','Other']) c;
  end if;

  if p_module = 'onboarding' and not exists (select 1 from public.checklist_templates where business_id = p_business) then
    insert into public.checklist_templates (business_id, name, kind, is_default)
    values (p_business, 'Standard onboarding', 'onboarding', true) returning id into v_tpl;
    insert into public.checklist_template_tasks (business_id, template_id, title, assignee_type, due_offset_days, sort) values
      (p_business, v_tpl, 'Sign the employment contract', 'hr', 0, 1),
      (p_business, v_tpl, 'Collect ID card or passport copy', 'hr', 0, 2),
      (p_business, v_tpl, 'Prepare uniform and equipment', 'manager', 0, 3),
      (p_business, v_tpl, 'Orientation and property tour', 'manager', 1, 4),
      (p_business, v_tpl, 'Set up system access', 'hr', 1, 5),
      (p_business, v_tpl, 'Add your bank details', 'employee', 3, 6),
      (p_business, v_tpl, 'Read the staff handbook', 'employee', 7, 7);

    insert into public.checklist_templates (business_id, name, kind, is_default)
    values (p_business, 'Standard offboarding', 'offboarding', true) returning id into v_tpl;
    insert into public.checklist_template_tasks (business_id, template_id, title, assignee_type, due_offset_days, sort) values
      (p_business, v_tpl, 'Return company property (keys, uniform, devices)', 'manager', 0, 1),
      (p_business, v_tpl, 'Hold exit interview', 'hr', -2, 2),
      (p_business, v_tpl, 'Calculate final settlement', 'hr', 0, 3),
      (p_business, v_tpl, 'Remove system access', 'hr', 0, 4),
      (p_business, v_tpl, 'Clearance sign-off', 'manager', 0, 5);
  end if;

  if p_module = 'performance' and not exists (select 1 from public.review_templates where business_id = p_business) then
    insert into public.review_templates (business_id, name, description, is_default)
    values (p_business, 'Basic review', 'A simple review that works for any role.', true) returning id into v_tpl;
    insert into public.review_questions (business_id, template_id, section, question, kind, audience, sort) values
      (p_business, v_tpl, 'Performance', 'How well were goals and responsibilities met this period?', 'rating_text', 'all', 1),
      (p_business, v_tpl, 'Performance', 'Quality of work and attention to detail', 'rating', 'all', 2),
      (p_business, v_tpl, 'Teamwork', 'Works well with colleagues and guests/customers', 'rating_text', 'all', 3),
      (p_business, v_tpl, 'Growth', 'What went especially well?', 'text', 'all', 4),
      (p_business, v_tpl, 'Growth', 'What should be the focus for the next period?', 'text', 'all', 5);
  end if;

  if p_module = 'payroll' and not exists (select 1 from public.account_codes where business_id = p_business) then
    insert into public.account_codes (business_id, code, name, account_type, mapping_key) values
      (p_business, '6000', 'Salaries and wages', 'expense', 'salary_expense'),
      (p_business, '6010', 'Allowances', 'expense', 'allowance_expense'),
      (p_business, '6020', 'Overtime', 'expense', 'overtime_expense'),
      (p_business, '6030', 'Employer pension contribution', 'expense', 'pension_employer_expense'),
      (p_business, '6040', 'Staff reimbursements', 'expense', 'reimbursement_expense'),
      (p_business, '2100', 'Net salaries payable', 'liability', 'net_pay_payable'),
      (p_business, '2110', 'Pension payable', 'liability', 'pension_payable'),
      (p_business, '2120', 'Income tax payable', 'liability', 'tax_payable'),
      (p_business, '1300', 'Staff loans and advances', 'asset', 'staff_loans');
  end if;
  if p_module = 'claims' and not exists (select 1 from public.claim_types where business_id = p_business) then
    insert into public.claim_types (business_id, name, key, cutoff_day, requires_receipt, payout_method, is_system, sort) values
      (p_business, 'Transport', 'transport', 20, true, 'payroll', true, 1),
      (p_business, 'Meals', 'meals', null, true, 'payroll', true, 2),
      (p_business, 'Travel', 'travel', null, true, 'payroll', true, 3),
      (p_business, 'Supplies', 'supplies', null, true, 'payroll', true, 4),
      (p_business, 'Other', 'custom', null, false, 'payroll', false, 5);
  end if;
end $$;

-- Accepts the old tool keys for a while, so an older copy of the app keeps working.

create or replace function public.set_business_modules(p_business uuid, p_enabled text[])
returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_missing text;
  v_unknown text;
  v_newly text[];
  k text;
begin
  -- Old keys from before tools were renamed: Transport + Expense claims became Claims.
  p_enabled := array(select distinct case when x in ('transport', 'expenses') then 'claims' else x end from unnest(p_enabled) x);

  if p_business not in (select private.biz_all('modules', 'edit')) then
    raise exception 'You don''t have permission to change tools' using errcode = '42501';
  end if;

  select string_agg(x, ', ') into v_unknown
    from unnest(p_enabled) x where x not in (select key from private.module_catalog);
  if v_unknown is not null then
    raise exception 'Unknown tool: %', v_unknown using errcode = '22023';
  end if;

  select string_agg(c.key, ', ') into v_missing
    from private.module_catalog c where c.is_core and not (c.key = any(p_enabled));
  if v_missing is not null then
    raise exception 'The foundation tools are always included (%).', v_missing using errcode = '22023';
  end if;

  select string_agg(format('%s needs %s', c.key, r), '; ') into v_missing
    from private.module_catalog c, unnest(c.requires) r
   where c.key = any(p_enabled) and not (r = any(p_enabled));
  if v_missing is not null then
    raise exception 'A required tool is missing: %', v_missing using errcode = '22023';
  end if;

  select coalesce(array_agg(x), '{}') into v_newly from unnest(p_enabled) x
   where not exists (select 1 from public.business_modules bm
                      where bm.business_id = p_business and bm.module_key = x and bm.enabled);

  insert into public.business_modules (business_id, module_key, enabled, enabled_at, disabled_at)
  select p_business, x, true, now(), null from unnest(p_enabled) x
  on conflict (business_id, module_key) do update
    set enabled = true,
        enabled_at = case when public.business_modules.enabled then public.business_modules.enabled_at else now() end,
        disabled_at = null;

  update public.business_modules set enabled = false, disabled_at = now()
   where business_id = p_business and enabled and not (module_key = any(p_enabled));

  -- Starter data for every switched-on tool that is missing it (safe to repeat).
  foreach k in array p_enabled loop
    perform private.seed_module_defaults(p_business, k);
  end loop;

  return v_newly;
end $$;

drop function if exists public.apply_module_setup(uuid, text, jsonb);

create or replace function public.apply_module_setup(p_business uuid, p_module text, p_config jsonb, p_mark_done boolean default true)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_res text;
  v_act text := 'edit';
  d jsonb;
  x jsonb;
  v_dept uuid;
  v_sched uuid;
  v_tax uuid;
  v_tpl uuid;
  v_policy uuid;
begin
  v_res := case p_module
    when 'employees' then 'org'
    when 'leave' then 'leave'
    when 'attendance' then 'attendance'
    when 'payroll' then 'payroll'
    when 'transport' then 'claims'
    when 'claims' then 'claims'
    when 'performance' then 'reviews'
    else null end;
  if v_res is null then
    raise exception 'Tool % has no settings to apply', p_module using errcode = '22023';
  end if;
  if p_module = 'employees' then v_act := 'create'; end if;
  if p_business not in (select private.biz_all(v_res, v_act)) then
    raise exception 'You don''t have permission to change this tool''s settings' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business
                  and module_key = case when p_module = 'transport' then 'claims' else p_module end and enabled) then
    raise exception 'Switch the tool on first' using errcode = '22023';
  end if;

  -- Departments & positions -------------------------------------------
  if p_module = 'employees' then
    for d in select * from jsonb_array_elements(coalesce(p_config -> 'departments', '[]'::jsonb)) loop
      continue when coalesce(trim(d ->> 'name'), '') = '';
      insert into public.departments (business_id, name) values (p_business, trim(d ->> 'name'))
      on conflict (business_id, name) do update set is_active = true
      returning id into v_dept;
      for x in select * from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) loop
        continue when coalesce(trim(x #>> '{}'), '') = '';
        insert into public.positions (business_id, title, department_id) values (p_business, trim(x #>> '{}'), v_dept)
        on conflict (business_id, title, department_id) do nothing;
      end loop;
    end loop;
  end if;

  -- Leave types & public holidays --------------------------------------
  if p_module = 'leave' then
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'leave_types', '[]'::jsonb)) loop
      insert into public.leave_types (business_id, code, name, entitlement_days, is_paid, accrual_method,
                                      carry_forward_max, gender_eligibility, requires_document, sort)
      values (p_business, upper(x ->> 'code'), x ->> 'name', coalesce((x ->> 'days')::numeric, 0),
              coalesce((x ->> 'paid')::boolean, true), coalesce(x ->> 'accrual', 'upfront'),
              coalesce((x ->> 'carry_forward')::numeric, 0), coalesce(x ->> 'gender', 'any'),
              coalesce((x ->> 'requires_document')::boolean, false), coalesce((x ->> 'sort')::int, 0))
      on conflict (business_id, code) do update set
        name = excluded.name, entitlement_days = excluded.entitlement_days, is_paid = excluded.is_paid,
        accrual_method = excluded.accrual_method, carry_forward_max = excluded.carry_forward_max,
        gender_eligibility = excluded.gender_eligibility, requires_document = excluded.requires_document,
        is_active = true;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'holidays', '[]'::jsonb)) loop
      insert into public.public_holidays (business_id, name, holiday_date, country)
      values (p_business, x ->> 'name', (x ->> 'date')::date, coalesce(x ->> 'country', 'MV'))
      on conflict (business_id, holiday_date, name) do nothing;
    end loop;
  end if;

  -- Shifts & attendance rules ------------------------------------------
  if p_module = 'attendance' then
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'shifts', '[]'::jsonb)) loop
      insert into public.shifts (business_id, name, start_time, end_time, break_minutes, crosses_midnight, color)
      values (p_business, x ->> 'name', (x ->> 'start')::time, (x ->> 'end')::time,
              coalesce((x ->> 'break_minutes')::int, 60), (x ->> 'end')::time <= (x ->> 'start')::time,
              coalesce(x ->> 'color', '#64748b'))
      on conflict (business_id, name) do update set
        start_time = excluded.start_time, end_time = excluded.end_time, break_minutes = excluded.break_minutes,
        crosses_midnight = excluded.crosses_midnight, is_active = true;
    end loop;
    if p_config ? 'policy' then
      x := p_config -> 'policy';
      select id into v_policy from public.attendance_policies where business_id = p_business and is_default;
      if v_policy is null then
        insert into public.attendance_policies (business_id, name, is_default) values (p_business, 'Standard rules', true)
        returning id into v_policy;
      end if;
      update public.attendance_policies set
        grace_minutes = coalesce((x ->> 'grace_minutes')::int, grace_minutes),
        late_mark_after_minutes = coalesce((x ->> 'grace_minutes')::int, late_mark_after_minutes),
        half_day_min_hours = coalesce((x ->> 'half_day_min_hours')::numeric, half_day_min_hours),
        full_day_hours = coalesce((x ->> 'full_day_hours')::numeric, full_day_hours),
        overtime_enabled = coalesce((x ->> 'overtime_enabled')::boolean, overtime_enabled),
        overtime_after_minutes = coalesce((x ->> 'overtime_after_minutes')::int, overtime_after_minutes),
        overtime_rate_weekday = coalesce((x ->> 'overtime_rate_weekday')::numeric, overtime_rate_weekday),
        overtime_rate_rest_day = coalesce((x ->> 'overtime_rate_rest_day')::numeric, overtime_rate_rest_day),
        overtime_rate_holiday = coalesce((x ->> 'overtime_rate_holiday')::numeric, overtime_rate_holiday),
        require_gps = coalesce((x ->> 'require_gps')::boolean, require_gps),
        require_selfie = coalesce((x ->> 'require_selfie')::boolean, require_selfie)
      where id = v_policy;
    end if;
  end if;

  -- Pay cycle, pension, tax, pay components ----------------------------
  if p_module = 'payroll' then
    perform private.seed_module_defaults(p_business, 'payroll');
    if p_config ? 'schedule' then
      x := p_config -> 'schedule';
      select id into v_sched from public.pay_schedules where business_id = p_business and is_default;
      if v_sched is null then
        insert into public.pay_schedules (business_id, name, frequency, pay_day, period_start_day, is_default)
        values (p_business, coalesce(x ->> 'name', 'Monthly payroll'), coalesce(x ->> 'frequency', 'monthly'),
                coalesce((x ->> 'pay_day')::smallint, 28), coalesce((x ->> 'period_start_day')::smallint, 1), true);
      else
        update public.pay_schedules set
          frequency = coalesce(x ->> 'frequency', frequency),
          pay_day = coalesce((x ->> 'pay_day')::smallint, pay_day),
          period_start_day = coalesce((x ->> 'period_start_day')::smallint, period_start_day)
        where id = v_sched;
      end if;
    end if;
    if p_config ? 'pension' then
      x := p_config -> 'pension';
      update public.pension_schemes set is_active = false where business_id = p_business and is_active;
      insert into public.pension_schemes (business_id, name, employee_rate, employer_rate, applies_to, notes)
      values (p_business, x ->> 'name', (x ->> 'employee_rate')::numeric, (x ->> 'employer_rate')::numeric,
              coalesce(x ->> 'applies_to', 'locals'), x ->> 'note');
    end if;
    if p_config ? 'tax' then
      x := p_config -> 'tax';
      update public.tax_tables set is_active = false where business_id = p_business and is_active;
      insert into public.tax_tables (business_id, name, basis, notes)
      values (p_business, x ->> 'name', coalesce(x ->> 'basis', 'monthly'), x ->> 'note')
      returning id into v_tax;
      insert into public.tax_brackets (business_id, tax_table_id, lower_bound, upper_bound, rate, sort)
      select p_business, v_tax, (br ->> 'lower')::numeric, nullif(br ->> 'upper', '')::numeric, (br ->> 'rate')::numeric, ord::int
        from jsonb_array_elements(coalesce(x -> 'brackets', '[]'::jsonb)) with ordinality as t(br, ord);
    end if;
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'components', '[]'::jsonb)) loop
      insert into public.pay_components (business_id, code, name, kind, category, is_taxable, is_pensionable, calc_type, sort)
      values (p_business, upper(x ->> 'code'), x ->> 'name', coalesce(x ->> 'kind', 'earning'), coalesce(x ->> 'category', 'allowance'),
              coalesce((x ->> 'taxable')::boolean, true), coalesce((x ->> 'pensionable')::boolean, false),
              coalesce(x ->> 'calc_type', 'fixed'), coalesce((x ->> 'sort')::int, 0))
      on conflict (business_id, code) do nothing;
    end loop;
  end if;

  -- Claim cut-off day (the old transport setting now lives on the Transport claim type)
  if p_module in ('transport', 'claims') then
    perform private.seed_module_defaults(p_business, 'claims');
    if p_config ? 'claims_cutoff_day' then
      update public.claim_types set cutoff_day = (p_config ->> 'claims_cutoff_day')::smallint
       where business_id = p_business and key = 'transport';
    end if;
  end if;

  -- First review cycle --------------------------------------------------
  if p_module = 'performance' then
    perform private.seed_module_defaults(p_business, 'performance');
    if p_config ? 'cycle' then
      x := p_config -> 'cycle';
      select id into v_tpl from public.review_templates where business_id = p_business order by is_default desc, created_at limit 1;
      -- Saving again updates the same draft cycle instead of creating a copy.
      update public.review_cycles set
        period_type = coalesce(x ->> 'period_type', 'annual'), period_start = (x ->> 'period_start')::date,
        period_end = (x ->> 'period_end')::date, self_review_due = nullif(x ->> 'self_review_due', '')::date,
        manager_review_due = nullif(x ->> 'manager_review_due', '')::date
      where business_id = p_business and status = 'draft' and lower(name) = lower(trim(x ->> 'name'));
      if not found then
        insert into public.review_cycles (business_id, name, period_type, period_start, period_end,
                                          self_review_due, manager_review_due, template_id)
        values (p_business, trim(x ->> 'name'), coalesce(x ->> 'period_type', 'annual'), (x ->> 'period_start')::date,
                (x ->> 'period_end')::date, nullif(x ->> 'self_review_due', '')::date,
                nullif(x ->> 'manager_review_due', '')::date, v_tpl);
      end if;
    end if;
  end if;

  if p_mark_done then
    update public.business_modules set setup_completed_at = now()
     where business_id = p_business and module_key = case when p_module = 'transport' then 'claims' else p_module end;
  end if;
end $$;

revoke all on function public.apply_module_setup(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.apply_module_setup(uuid, text, jsonb, boolean) to authenticated;

create or replace function private.storage_can(p_name text, p_action text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := string_to_array(p_name, '/');
  v_bid uuid;
  v_emp uuid;
  v_area text;
  v_resource text;
  v_emp_scoped boolean := true;
begin
  if coalesce(array_length(parts, 1), 0) < 3 then
    return false;
  end if;
  begin
    v_bid := parts[1]::uuid;
  exception when others then
    return false;
  end;
  if v_bid not in (select private.my_business_ids()) then
    return false;
  end if;

  v_area := parts[2];
  case v_area
    when 'branding' then
      if p_action = 'view' then return true; end if;
      v_resource := 'settings'; v_emp_scoped := false;
    when 'learning' then
      if p_action = 'view' then return true; end if;
      v_resource := 'learning'; v_emp_scoped := false;
    when 'recruitment' then v_resource := 'recruitment'; v_emp_scoped := false;
    when 'exports' then v_resource := 'data_export'; v_emp_scoped := false;
    when 'documents' then v_resource := 'documents';
    when 'photos' then v_resource := 'employees';
    when 'attendance' then v_resource := 'attendance';
    when 'leave' then v_resource := 'leave';
    when 'transport', 'expenses', 'claims' then v_resource := 'claims';
    when 'payslips' then v_resource := 'payslips';
    when 'letters' then v_resource := 'letters';
    when 'compliance' then v_resource := 'compliance';
    when 'certificates' then v_resource := 'training';
    when 'onboarding' then v_resource := 'onboarding';
    else return false;
  end case;

  if not v_emp_scoped then
    -- Settings and course content have no separate create/delete permission: changing files needs 'edit'.
    if v_resource in ('settings', 'learning') and p_action in ('create', 'delete') then
      return v_bid in (select private.biz_all(v_resource, 'edit'));
    end if;
    return v_bid in (select private.biz_all(v_resource, p_action));
  end if;

  begin
    v_emp := parts[3]::uuid;
  exception when others then
    return false;
  end;
  if not exists (select 1 from public.employees e where e.id = v_emp and e.business_id = v_bid) then
    return false;
  end if;

  -- Staff can always upload their own attachments for requests they are allowed to make
  -- (leave/claims/expenses/attendance selfies are also covered by 'create' own scope).
  return v_bid in (select private.biz_all(v_resource, p_action))
      or v_emp in (select private.emp_scope(v_resource, p_action));
end $$;

create or replace function public.get_setup_checklist(p_business uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_business not in (select private.my_business_ids()) then '{}'::jsonb else jsonb_build_object(
    'system.profile', (select address is not null and phone is not null from public.businesses where id = p_business),
    'documents.branding', (select logo_path is not null from public.businesses where id = p_business),
    'org.departments', exists (select 1 from public.departments where business_id = p_business),
    'employees.first', exists (select 1 from public.employees where business_id = p_business),
    'roles.invite', (select count(*) > 1 from public.business_members where business_id = p_business)
                    or exists (select 1 from public.invitations where business_id = p_business and revoked_at is null),
    'approvals.chains', exists (select 1 from public.approval_workflows where business_id = p_business),
    'notifications.test', exists (select 1 from public.notification_channels where business_id = p_business and last_tested_at is not null),
    'portal.announcement', exists (select 1 from public.announcements where business_id = p_business),
    'attendance.shifts', exists (select 1 from public.business_modules where business_id = p_business
                                  and module_key = 'attendance' and setup_completed_at is not null),
    'attendance.geofence', exists (select 1 from public.branches where business_id = p_business and latitude is not null),
    'leave.types', exists (select 1 from public.business_modules where business_id = p_business
                            and module_key = 'leave' and setup_completed_at is not null),
    'leave.holidays', exists (select 1 from public.public_holidays where business_id = p_business),
    'recruitment.vacancy', exists (select 1 from public.vacancies where business_id = p_business),
    'onboarding.template', exists (select 1 from public.checklist_templates where business_id = p_business and kind = 'onboarding'),
    'compliance.items', exists (select 1 from public.compliance_items where business_id = p_business),
    'payroll.schedule', exists (select 1 from public.pay_schedules where business_id = p_business),
    'payroll.statutory', exists (select 1 from public.business_modules where business_id = p_business
                                  and module_key = 'payroll' and setup_completed_at is not null),
    'payroll.salaries', exists (select 1 from public.employee_compensation where business_id = p_business),
    'claims.types', exists (select 1 from public.business_modules where business_id = p_business
                             and module_key = 'claims' and setup_completed_at is not null),
    'learning.course', exists (select 1 from public.courses where business_id = p_business),
    'performance.cycle', exists (select 1 from public.review_cycles where business_id = p_business)
  ) end
$$;

-- ---------------------------------------------------------------------
-- One-time moves. Written as functions so they are safe to run again and
-- can be tested: nothing is copied twice, nothing is deleted.
-- ---------------------------------------------------------------------

-- Businesses that had Transport or Expense claims switched on get Claims.
create or replace function private.migrate_legacy_tools()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_modules (business_id, module_key, enabled, enabled_at, disabled_at, setup_completed_at)
  select bm.business_id, 'claims', bool_or(bm.enabled), min(bm.enabled_at),
         case when bool_or(bm.enabled) then null else max(bm.disabled_at) end,
         max(bm.setup_completed_at)
    from public.business_modules bm
   where bm.module_key in ('transport', 'expenses')
   group by bm.business_id
  on conflict (business_id, module_key) do update
    set enabled = public.business_modules.enabled or excluded.enabled;

  delete from public.business_modules where module_key in ('transport', 'expenses');

  -- Roles keep the same access: the widest scope of either old claim permission.
  insert into public.role_permissions (business_id, role_id, resource, action, scope)
  select rp.business_id, rp.role_id, 'claims', rp.action,
         (array_agg(rp.scope order by case rp.scope when 'all' then 1 when 'team' then 2 else 3 end))[1]
    from public.role_permissions rp
   where rp.resource in ('transport_claims', 'expenses')
   group by rp.business_id, rp.role_id, rp.action
  on conflict (role_id, resource, action) do nothing;
  delete from public.role_permissions where resource in ('transport_claims', 'expenses');

  update public.approval_workflows set request_type = 'claim' where request_type in ('transport_claim', 'expense_claim');
  update public.approval_requests set request_type = 'claim', module_key = 'claims'
   where request_type in ('transport_claim', 'expense_claim');
end $$;

-- Every old transport and expense claim appears under Claims.
create or replace function private.migrate_legacy_claims()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  -- Starter claim types (including "Transport") for any business with old claims or the Claims tool.
  for r in
    select business_id from public.transport_claims
    union select business_id from public.expense_claims
    union select business_id from public.expense_categories
    union select business_id from public.business_modules where module_key = 'claims'
  loop
    perform private.seed_module_defaults(r.business_id, 'claims');
  end loop;

  -- The old transport cut-off day becomes the Transport type's cut-off.
  update public.claim_types ct set cutoff_day = ps.claims_cutoff_day
    from public.pay_schedules ps
   where ps.business_id = ct.business_id and ps.is_default and ps.claims_cutoff_day is not null
     and ct.key = 'transport' and ps.claims_cutoff_day between 1 and 28;

  -- Old expense categories become claim types (matched by name).
  insert into public.claim_types (business_id, name, key, max_amount, requires_receipt, account_code_id, is_active, sort)
  select ec.business_id, ec.name, 'custom', ec.max_amount, ec.requires_receipt, ec.account_code_id, ec.is_active, 50
    from public.expense_categories ec
   where not exists (select 1 from public.claim_types ct where ct.business_id = ec.business_id and lower(ct.name) = lower(ec.name));

  insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, description, route, receipt_path,
                             status, payout_method, target_period_start, is_late, payroll_run_id, paid_at, decided_by,
                             decided_at, decision_comment, created_by, created_at, legacy_source, legacy_id)
  select t.business_id, t.employee_id, ct.id, t.claim_date, t.amount, t.description, t.route, t.receipt_path,
         t.status, 'payroll', t.target_period_start, t.is_late, t.payroll_run_id,
         case when t.status = 'paid' then t.updated_at end, t.decided_by, t.decided_at, t.decision_comment,
         t.created_by, t.created_at, 'transport_claims', t.id
    from public.transport_claims t
    join public.claim_types ct on ct.business_id = t.business_id and ct.key = 'transport'
  on conflict (legacy_source, legacy_id) do nothing;

  insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, currency, description, receipt_path,
                             status, payout_method, payroll_run_id, paid_at, paid_reference, decided_by, decided_at,
                             decision_comment, created_by, created_at, legacy_source, legacy_id)
  select e.business_id, e.employee_id, ct.id, e.expense_date, e.amount, e.currency, e.description, e.receipt_path,
         case e.status when 'reimbursed' then 'paid' else e.status end, e.reimbursement_method, e.payroll_run_id,
         e.paid_at, e.paid_reference, e.decided_by, e.decided_at, e.decision_comment, e.created_by, e.created_at,
         'expense_claims', e.id
    from public.expense_claims e
    join public.expense_categories ec on ec.id = e.category_id
    join public.claim_types ct on ct.business_id = e.business_id and lower(ct.name) = lower(ec.name)
  on conflict (legacy_source, legacy_id) do nothing;
end $$;

select private.migrate_legacy_tools();
select private.migrate_legacy_claims();

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
