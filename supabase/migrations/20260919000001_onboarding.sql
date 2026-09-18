-- =====================================================================
-- 0007 ONBOARDING: business profile, module switching, quick setup,
-- invitations, employee import and the getting-started checklist.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Module catalog (mirror of src/modules/registry.ts; a test keeps them in sync)
-- ---------------------------------------------------------------------
create table private.module_catalog (
  key text primary key,
  is_core boolean not null,
  requires text[] not null default '{}'
);

insert into private.module_catalog (key, is_core, requires) values
  ('employees', true, '{}'), ('approvals', true, '{}'), ('documents', true, '{}'), ('roles', true, '{}'),
  ('dashboard', true, '{}'), ('notifications', true, '{}'), ('portal', true, '{}'), ('system', true, '{}'),
  ('attendance', false, '{}'), ('leave', false, '{}'), ('recruitment', false, '{}'), ('onboarding', false, '{}'),
  ('compliance', false, '{}'), ('payroll', false, '{}'), ('transport', false, '{payroll}'), ('expenses', false, '{}'),
  ('learning', false, '{}'), ('performance', false, '{}');

-- ---------------------------------------------------------------------
-- Business profile & branches (runs as the caller, so RLS applies)
--   p_profile  : { name, industry, country, currency, timezone, date_format, employee_count_range,
--                  address, registration_no, tin, phone, email, logo_path }
--   p_branches : [{ id?, name, atoll_island? }]
-- ---------------------------------------------------------------------
create or replace function public.save_business_profile(p_business uuid, p_profile jsonb, p_branches jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  b jsonb;
  v_keep uuid[] := '{}';
  v_id uuid;
begin
  if jsonb_array_length(coalesce(p_branches, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one branch or location' using errcode = '22023';
  end if;

  update public.businesses set
    name = coalesce(nullif(trim(p_profile ->> 'name'), ''), name),
    industry = coalesce(nullif(p_profile ->> 'industry', ''), industry),
    country = coalesce(nullif(p_profile ->> 'country', ''), country),
    currency = coalesce(nullif(p_profile ->> 'currency', ''), currency),
    timezone = coalesce(nullif(p_profile ->> 'timezone', ''), timezone),
    date_format = coalesce(nullif(p_profile ->> 'date_format', ''), date_format),
    employee_count_range = p_profile ->> 'employee_count_range',
    address = nullif(trim(p_profile ->> 'address'), ''),
    registration_no = nullif(trim(p_profile ->> 'registration_no'), ''),
    tin = nullif(trim(p_profile ->> 'tin'), ''),
    phone = nullif(trim(p_profile ->> 'phone'), ''),
    email = nullif(trim(p_profile ->> 'email'), ''),
    logo_path = case when p_profile ? 'logo_path' then nullif(p_profile ->> 'logo_path', '') else logo_path end
  where id = p_business;
  if not found then
    raise exception 'You don''t have permission to change this business' using errcode = '42501';
  end if;

  for b in select * from jsonb_array_elements(p_branches) loop
    if coalesce(trim(b ->> 'name'), '') = '' then continue; end if;
    v_id := nullif(b ->> 'id', '')::uuid;
    if v_id is not null then
      update public.branches set name = trim(b ->> 'name'), atoll_island = nullif(trim(b ->> 'atoll_island'), ''), is_active = true
       where id = v_id and business_id = p_business;
      if not found then v_id := null; end if;
    end if;
    if v_id is null then
      insert into public.branches (business_id, name, atoll_island)
      values (p_business, trim(b ->> 'name'), nullif(trim(b ->> 'atoll_island'), ''))
      on conflict (business_id, name) do update set is_active = true, atoll_island = excluded.atoll_island
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  -- Branches removed from the list: delete if unused, otherwise just deactivate.
  update public.branches br set is_active = false
   where br.business_id = p_business and not (br.id = any(v_keep))
     and exists (select 1 from public.employees e where e.branch_id = br.id);
  delete from public.branches br
   where br.business_id = p_business and not (br.id = any(v_keep))
     and not exists (select 1 from public.employees e where e.branch_id = br.id);
end $$;

revoke all on function public.save_business_profile(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_business_profile(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Default data for modules that have no setup screen (idempotent)
-- ---------------------------------------------------------------------
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
end $$;

-- ---------------------------------------------------------------------
-- Turn modules on/off. Data is never deleted: switching a module off only
-- hides it, and switching it back on restores everything.
-- p_enabled must list every module that should be ON.
-- ---------------------------------------------------------------------
create or replace function public.set_business_modules(p_business uuid, p_enabled text[])
returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_missing text;
  v_unknown text;
  v_newly text[];
  k text;
begin
  if p_business not in (select private.biz_all('modules', 'edit')) then
    raise exception 'You don''t have permission to change modules' using errcode = '42501';
  end if;

  select string_agg(x, ', ') into v_unknown
    from unnest(p_enabled) x where x not in (select key from private.module_catalog);
  if v_unknown is not null then
    raise exception 'Unknown module: %', v_unknown using errcode = '22023';
  end if;

  select string_agg(c.key, ', ') into v_missing
    from private.module_catalog c where c.is_core and not (c.key = any(p_enabled));
  if v_missing is not null then
    raise exception 'Core modules are always included (%).', v_missing using errcode = '22023';
  end if;

  select string_agg(format('%s needs %s', c.key, r), '; ') into v_missing
    from private.module_catalog c, unnest(c.requires) r
   where c.key = any(p_enabled) and not (r = any(p_enabled));
  if v_missing is not null then
    raise exception 'Missing required module: %', v_missing using errcode = '22023';
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

  foreach k in array v_newly loop
    perform private.seed_module_defaults(p_business, k);
  end loop;

  return v_newly;
end $$;

revoke all on function public.set_business_modules(uuid, text[]) from public, anon;
grant execute on function public.set_business_modules(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- Quick setup for one module (wizard step 4, or later from Settings).
-- Only adds/updates the settings it is given; safe to run again.
-- ---------------------------------------------------------------------
create or replace function public.apply_module_setup(p_business uuid, p_module text, p_config jsonb)
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
    when 'transport' then 'payroll'
    when 'performance' then 'reviews'
    else null end;
  if v_res is null then
    raise exception 'Module % has no quick setup', p_module using errcode = '22023';
  end if;
  if p_module = 'employees' then v_act := 'create'; end if;
  if p_business not in (select private.biz_all(v_res, v_act)) then
    raise exception 'You don''t have permission to set up this module' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business and module_key = p_module and enabled) then
    raise exception 'Turn the module on before setting it up' using errcode = '22023';
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

  -- Claim cut-off day ---------------------------------------------------
  if p_module = 'transport' then
    update public.pay_schedules set claims_cutoff_day = (p_config ->> 'claims_cutoff_day')::smallint
     where business_id = p_business and is_default;
    if not found then
      raise exception 'Set up the payroll pay cycle first' using errcode = '22023';
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

  update public.business_modules set setup_completed_at = now()
   where business_id = p_business and module_key = p_module;
end $$;

revoke all on function public.apply_module_setup(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_module_setup(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Employee import (one or many), all-or-nothing. Runs as the caller.
--   p_rows: [{ employee_code?, first_name, last_name?, work_email?, phone?, department?, position?,
--              branch?, join_date?, gender?, nationality?, is_expatriate?, contract_type?, manager_code? }]
-- Missing departments/positions are created; branches must already exist.
-- ---------------------------------------------------------------------
create or replace function private.next_employee_code(p_business uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select 'E' || lpad((coalesce(max((regexp_match(employee_code, '^E(\d+)$'))[1]::int), 0) + 1)::text, 4, '0')
    from public.employees where business_id = p_business
$$;

create or replace function public.import_employees(p_business uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb;
  v_dept uuid;
  v_pos uuid;
  v_branch uuid;
  v_code text;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_line int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_line := v_line + 1;
    v_dept := null; v_pos := null; v_branch := null;

    if coalesce(trim(r ->> 'department'), '') <> '' then
      select id into v_dept from public.departments where business_id = p_business and lower(name) = lower(trim(r ->> 'department'));
      if v_dept is null then
        insert into public.departments (business_id, name) values (p_business, trim(r ->> 'department')) returning id into v_dept;
      end if;
    end if;
    if coalesce(trim(r ->> 'position'), '') <> '' then
      select id into v_pos from public.positions
       where business_id = p_business and lower(title) = lower(trim(r ->> 'position'))
         and department_id is not distinct from v_dept;
      if v_pos is null then
        insert into public.positions (business_id, title, department_id) values (p_business, trim(r ->> 'position'), v_dept)
        returning id into v_pos;
      end if;
    end if;
    if coalesce(trim(r ->> 'branch'), '') <> '' then
      select id into v_branch from public.branches where business_id = p_business and lower(name) = lower(trim(r ->> 'branch'));
      if v_branch is null then
        raise exception 'Row %: branch "%" doesn''t exist', v_line, r ->> 'branch' using errcode = '22023';
      end if;
    end if;

    v_code := coalesce(nullif(trim(r ->> 'employee_code'), ''), private.next_employee_code(p_business));
    begin
      insert into public.employees (business_id, employee_code, first_name, last_name, work_email, phone, department_id,
                                    position_id, branch_id, join_date, probation_end_date, gender, nationality, is_expatriate, contract_type, status)
      values (p_business, v_code, trim(r ->> 'first_name'), coalesce(trim(r ->> 'last_name'), ''),
              nullif(lower(trim(r ->> 'work_email')), ''), nullif(trim(r ->> 'phone'), ''), v_dept, v_pos, v_branch,
              nullif(r ->> 'join_date', '')::date, nullif(r ->> 'probation_end_date', '')::date, nullif(r ->> 'gender', ''), nullif(upper(r ->> 'nationality'), ''),
              coalesce((r ->> 'is_expatriate')::boolean, false), coalesce(nullif(r ->> 'contract_type', ''), 'permanent'),
              case when nullif(r ->> 'probation_end_date', '') is not null then 'probation' else 'active' end)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Row %: employee ID "%" is already used', v_line, v_code using errcode = '23505';
    end;
    v_out := v_out || jsonb_build_object('line', v_line, 'id', v_id, 'employee_code', v_code,
                                         'manager_code', nullif(trim(r ->> 'manager_code'), ''));
  end loop;

  -- Second pass: reporting lines (managers may appear anywhere in the file).
  for r in select * from jsonb_array_elements(v_out) loop
    continue when r ->> 'manager_code' is null;
    update public.employees e set manager_id = m.id
      from public.employees m
     where e.id = (r ->> 'id')::uuid and m.business_id = p_business and m.employee_code = r ->> 'manager_code';
    if not found then
      raise exception 'Row %: manager ID "%" not found', r ->> 'line', r ->> 'manager_code' using errcode = '22023';
    end if;
  end loop;

  return v_out;
end $$;

revoke all on function public.import_employees(uuid, jsonb) from public, anon;
grant execute on function public.import_employees(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------
-- Only owners may invite someone as an owner.
create or replace function private.guard_invitations() returns trigger
language plpgsql as $$
begin
  if private.is_client_context() and private.role_is_owner(new.role_id) and not private.is_owner(new.business_id) then
    raise exception 'Only an owner can invite another owner' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_invitations before insert or update on public.invitations
  for each row execute function private.guard_invitations();

create or replace function private.token_hash(p_token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- What the invitation page shows before signing in. Reveals nothing unless you hold the link.
create or replace function public.get_invitation_preview(p_token text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'business_name', b.name,
    'role_name', r.name,
    'email', i.email,
    'status', case when i.revoked_at is not null then 'revoked'
                   when i.accepted_at is not null then 'accepted'
                   when i.expires_at < now() then 'expired'
                   else 'valid' end)
  from public.invitations i
  join public.businesses b on b.id = i.business_id
  join public.roles r on r.id = i.role_id
  where i.token_hash = private.token_hash(p_token)
$$;
revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invitations;
  v_email text;
  v_linked uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to accept the invitation' using errcode = '28000';
  end if;
  select * into inv from public.invitations where token_hash = private.token_hash(p_token) for update;
  if not found then
    raise exception 'This invitation link isn''t valid' using errcode = '22023';
  end if;
  if inv.revoked_at is not null then
    raise exception 'This invitation was cancelled. Ask for a new one.' using errcode = '22023';
  end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then return inv.business_id; end if;
    raise exception 'This invitation has already been used' using errcode = '22023';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = '22023';
  end if;

  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from lower(inv.email) then
    raise exception 'This invitation was sent to %. Sign in with that email address to accept it.', inv.email using errcode = '42501';
  end if;

  if inv.employee_id is not null then
    select user_id into v_linked from public.business_members
     where business_id = inv.business_id and employee_id = inv.employee_id;
    if v_linked is not null and v_linked <> auth.uid() then
      raise exception 'This employee is already linked to another account' using errcode = '23505';
    end if;
  end if;

  insert into public.business_members (business_id, user_id, role_id, employee_id, status)
  values (inv.business_id, auth.uid(), inv.role_id, inv.employee_id, 'active')
  on conflict (business_id, user_id) do update
    set status = 'active',
        employee_id = coalesce(public.business_members.employee_id, excluded.employee_id);

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  update public.profiles set last_business_id = inv.business_id where id = auth.uid();
  return inv.business_id;
end $$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------
-- Getting-started checklist: which setup items are done (booleans only).
-- ---------------------------------------------------------------------
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
    'attendance.shifts', exists (select 1 from public.shifts where business_id = p_business),
    'attendance.geofence', exists (select 1 from public.branches where business_id = p_business and latitude is not null),
    'leave.types', exists (select 1 from public.leave_types where business_id = p_business),
    'leave.holidays', exists (select 1 from public.public_holidays where business_id = p_business),
    'recruitment.vacancy', exists (select 1 from public.vacancies where business_id = p_business),
    'onboarding.template', exists (select 1 from public.checklist_templates where business_id = p_business and kind = 'onboarding'),
    'compliance.items', exists (select 1 from public.compliance_items where business_id = p_business),
    'payroll.schedule', exists (select 1 from public.pay_schedules where business_id = p_business),
    'payroll.statutory', exists (select 1 from public.pension_schemes where business_id = p_business)
                         and exists (select 1 from public.tax_tables where business_id = p_business),
    'payroll.salaries', exists (select 1 from public.employee_compensation where business_id = p_business),
    'transport.cutoff', exists (select 1 from public.pay_schedules where business_id = p_business and claims_cutoff_day is not null),
    'expenses.categories', exists (select 1 from public.expense_categories where business_id = p_business),
    'learning.course', exists (select 1 from public.courses where business_id = p_business),
    'performance.cycle', exists (select 1 from public.review_cycles where business_id = p_business)
  ) end
$$;
revoke all on function public.get_setup_checklist(uuid) from public, anon;
grant execute on function public.get_setup_checklist(uuid) to authenticated;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
