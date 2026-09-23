-- =====================================================================
-- 0033 PAY ITEMS: allowances and deductions that work themselves out.
--   * Each item has a calculation method (fixed, per day attended,
--     prorated by attendance, % of basic, per occurrence, or a formula),
--     dates it applies between, and who gets it (everyone, or chosen
--     departments, jobs, locations or people, with their own amounts).
--   * Rules, checked top to bottom (first match wins), or a rule formula.
--   * Formulas are stored as a checked tree and calculated here by
--     private.pay_eval: numbers, the pay variables, + - * /, comparisons,
--     IF, AND, OR, MIN, MAX and ROUND. Nothing is ever run as code.
--   * Payroll and the test panel use the same calculation, and every
--     payroll line keeps a plain explanation of how it was worked out.
--   * Basic salary now only takes off unpaid leave. Unapproved absences
--     are taken off by an "Unapproved absence deduction" item each
--     company gets, which can be changed or switched off.
--   * Salaries: change a group at once, or import from a file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pay item settings
-- ---------------------------------------------------------------------
alter table public.pay_components
  add column if not exists description text,
  add column if not exists method text not null default 'fixed'
    check (method in ('fixed', 'per_day', 'prorated', 'percent', 'per_occurrence', 'formula')),
  add column if not exists prorate_basis text not null default 'working' check (prorate_basis in ('calendar', 'working')),
  add column if not exists occurrence_var text,
  add column if not exists occurrence_after integer not null default 0 check (occurrence_after >= 0),
  add column if not exists formula text,
  add column if not exists formula_ast jsonb,
  add column if not exists rules_mode text not null default 'none' check (rules_mode in ('none', 'builder', 'formula')),
  add column if not exists rules jsonb not null default '[]'::jsonb,
  add column if not exists rules_formula text,
  add column if not exists rules_ast jsonb,
  add column if not exists applies_to text not null default 'all' check (applies_to in ('all', 'selected')),
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists template_key text,
  add column if not exists updated_by uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.pay_components drop constraint if exists pay_components_effective_check;
alter table public.pay_components add constraint pay_components_effective_check
  check (effective_to is null or effective_from is null or effective_to >= effective_from);
create index if not exists pay_components_updated_by_fk_idx on public.pay_components (updated_by);

-- Existing items keep what they did. Items given to people one by one stay that way.
update public.pay_components set
  method = case calc_type when 'percent_of_basic' then 'percent' when 'per_day_present' then 'per_day' else 'fixed' end,
  applies_to = 'selected';

-- Who an item is for, when it isn't everyone. People with their own amount always get it.
create table public.pay_component_targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  component_id uuid not null,
  target_type text not null check (target_type in ('department', 'position', 'branch', 'employee')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (component_id, target_type, target_id),
  foreign key (business_id, component_id) references public.pay_components (business_id, id) on delete cascade
);
create index pay_component_targets_component_idx on public.pay_component_targets (business_id, component_id);
call private.std_rls('pay_component_targets', 'payroll');

-- How each payroll line was worked out, in plain words.
alter table public.payroll_run_lines add column if not exists explanation text;

-- Every change to an item and who gets it is kept with who, when, before and after.
create trigger audit_pay_components after insert or update or delete on public.pay_components
  for each row execute function private.audit_row('payroll', '');
create trigger audit_pay_component_targets after insert or update or delete on public.pay_component_targets
  for each row execute function private.audit_row('payroll', '');

-- ---------------------------------------------------------------------
-- 2. The formula calculator
-- ---------------------------------------------------------------------
create or replace function private.pay_variable_names()
returns text[]
language sql immutable as $$
  select array['basic_salary', 'amount', 'days_in_month', 'working_days', 'days_present', 'unapproved_absences',
               'approved_absences', 'half_days', 'late_count', 'early_leaves', 'consecutive_unapproved_absences',
               'overtime_hours', 'unpaid_leave_days', 'years_of_service']
$$;

-- Calculates a formula tree. Comparisons and AND/OR give 1 (true) or 0 (false).
-- Dividing by zero gives 0, so one empty month can't stop a pay run.
create or replace function private.pay_eval(n jsonb, v jsonb, d int default 0)
returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  op text;
  a numeric;
  b numeric;
  r numeric;
  i int;
  len int;
begin
  if d > 60 then
    raise exception 'The formula is nested too deeply' using errcode = '22023';
  end if;
  if n is null or jsonb_typeof(n) is distinct from 'array' or jsonb_array_length(n) < 2 then
    raise exception 'The formula isn''t valid' using errcode = '22023';
  end if;
  op := n ->> 0;
  len := jsonb_array_length(n);
  case op
    when 'num' then
      if jsonb_typeof(n -> 1) <> 'number' then raise exception 'The formula isn''t valid' using errcode = '22023'; end if;
      return (n ->> 1)::numeric;
    when 'var' then
      if not ((n ->> 1) = any(private.pay_variable_names())) or not (v ? (n ->> 1)) then
        raise exception '"%" isn''t a variable', n ->> 1 using errcode = '22023';
      end if;
      return coalesce((v ->> (n ->> 1))::numeric, 0);
    when 'neg' then
      return -private.pay_eval(n -> 1, v, d + 1);
    when '+', '-', '*', '/', '>', '>=', '<', '<=', '=', '!=' then
      if len <> 3 then raise exception 'The formula isn''t valid' using errcode = '22023'; end if;
      a := private.pay_eval(n -> 1, v, d + 1);
      b := private.pay_eval(n -> 2, v, d + 1);
      return case op
        when '+' then a + b
        when '-' then a - b
        when '*' then a * b
        when '/' then case when b = 0 then 0 else a / b end
        when '>' then (a > b)::int
        when '>=' then (a >= b)::int
        when '<' then (a < b)::int
        when '<=' then (a <= b)::int
        when '=' then (a = b)::int
        else (a <> b)::int end;
    when 'IF' then
      if len <> 4 then raise exception 'IF needs 3 values' using errcode = '22023'; end if;
      if private.pay_eval(n -> 1, v, d + 1) <> 0 then
        return private.pay_eval(n -> 2, v, d + 1);
      end if;
      return private.pay_eval(n -> 3, v, d + 1);
    when 'AND', 'OR' then
      if len < 3 then raise exception '% needs at least 2 values', op using errcode = '22023'; end if;
      for i in 1 .. len - 1 loop
        a := private.pay_eval(n -> i, v, d + 1);
        if op = 'AND' and a = 0 then return 0; end if;
        if op = 'OR' and a <> 0 then return 1; end if;
      end loop;
      return case when op = 'AND' then 1 else 0 end;
    when 'MIN', 'MAX' then
      if len < 3 then raise exception '% needs at least 2 values', op using errcode = '22023'; end if;
      for i in 1 .. len - 1 loop
        a := private.pay_eval(n -> i, v, d + 1);
        r := case when r is null then a when op = 'MIN' then least(r, a) else greatest(r, a) end;
      end loop;
      return r;
    when 'ROUND' then
      if len not in (2, 3) then raise exception 'ROUND needs 1 or 2 values' using errcode = '22023'; end if;
      a := private.pay_eval(n -> 1, v, d + 1);
      b := case when len = 3 then private.pay_eval(n -> 2, v, d + 1) else 0 end;
      return round(a, least(greatest(round(b), 0), 6)::int);
    else
      raise exception 'The formula uses something that isn''t allowed' using errcode = '22023';
  end case;
end $$;

-- Rules from the builder: [{label, join, clauses: [{var, op, value}], outcome: {type, value}}]
create or replace function private.pay_rules_check(p_rules jsonb)
returns void
language plpgsql immutable set search_path = '' as $$
declare
  r jsonb;
  c jsonb;
begin
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'Rules aren''t valid' using errcode = '22023'; end if;
  if jsonb_array_length(p_rules) > 20 then raise exception 'Use up to 20 rules' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rules) loop
    if coalesce(r ->> 'join', '') not in ('and', 'or') or jsonb_typeof(r -> 'clauses') <> 'array' or jsonb_array_length(r -> 'clauses') = 0 then
      raise exception 'Each rule needs at least one condition' using errcode = '22023';
    end if;
    if coalesce(r #>> '{outcome,type}', '') not in ('full', 'percent', 'nothing', 'subtract', 'fixed') then
      raise exception 'Choose what each rule does' using errcode = '22023';
    end if;
    if r #>> '{outcome,type}' in ('percent', 'subtract', 'fixed') and jsonb_typeof(r #> '{outcome,value}') <> 'number' then
      raise exception 'Enter the amount or percentage for rule "%"', r ->> 'label' using errcode = '22023';
    end if;
    for c in select * from jsonb_array_elements(r -> 'clauses') loop
      if not ((c ->> 'var') = any(private.pay_variable_names())) or coalesce(c ->> 'op', '') not in ('>=', '>', '<=', '<', '=', '!=')
         or jsonb_typeof(c -> 'value') <> 'number' then
        raise exception 'A condition in rule "%" isn''t complete', r ->> 'label' using errcode = '22023';
      end if;
    end loop;
  end loop;
end $$;

create or replace function private.pay_rule_matches(p_rule jsonb, v jsonb)
returns boolean
language sql immutable set search_path = '' as $$
  select case when p_rule ->> 'join' = 'or' then bool_or(ok) else bool_and(ok) end
    from (
      select case c ->> 'op'
               when '>=' then x >= val when '>' then x > val when '<=' then x <= val
               when '<' then x < val when '=' then x = val else x <> val end as ok
        from jsonb_array_elements(p_rule -> 'clauses') c,
             lateral (select coalesce((v ->> (c ->> 'var'))::numeric, 0) as x, (c ->> 'value')::numeric as val) y) t
$$;

-- Checks an item before it's saved.
create or replace function private.pay_item_check(c public.pay_components)
returns void
language plpgsql stable set search_path = '' as $$
declare
  v_sample jsonb := (select jsonb_object_agg(k, 1) from unnest(private.pay_variable_names()) k);
begin
  if c.method = 'formula' then
    if c.formula_ast is null then raise exception 'Type the formula' using errcode = '22023'; end if;
    perform private.pay_eval(c.formula_ast, v_sample);
  end if;
  if c.method = 'per_occurrence' and not (coalesce(c.occurrence_var, '') = any(private.pay_variable_names())) then
    raise exception 'Choose what is counted' using errcode = '22023';
  end if;
  if c.method = 'percent' and c.default_percent is null then
    raise exception 'Enter the percentage of basic salary' using errcode = '22023';
  end if;
  if c.rules_mode = 'builder' then
    perform private.pay_rules_check(c.rules);
  elsif c.rules_mode = 'formula' then
    if c.rules_ast is null then raise exception 'Type the rule formula' using errcode = '22023'; end if;
    perform private.pay_eval(c.rules_ast, v_sample);
  end if;
end $$;

create or replace function private.pay_component_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.pay_item_check(new);
  -- The older field some screens still read.
  new.calc_type := case new.method when 'percent' then 'percent_of_basic' when 'per_day' then 'per_day_present' when 'fixed' then 'fixed' else 'manual' end;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger pay_component_guard before insert or update on public.pay_components
  for each row execute function private.pay_component_guard();

-- ---------------------------------------------------------------------
-- 3. Each person's numbers for a pay period
-- ---------------------------------------------------------------------
create or replace function private.pay_vars(p_business uuid, p_employee uuid, p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
  v_from date;
  v_to date;
  v_basic numeric := 0;
  v_basis text := 'monthly';
  v_working int := 0;
  v_working_employed int := 0;
  v_has_att boolean;
  v_has_leave boolean;
  v_unpaid numeric := 0;
  -- Plain typed variables (not a record), so the numbers have the same types whichever way they're worked out.
  v_present numeric := 0;
  v_half int := 0;
  v_absent int := 0;
  v_on_leave int := 0;
  v_late int := 0;
  v_early int := 0;
  v_ot numeric := 0;
  v_run int := 0;
  v_cap int;
  d date;
begin
  select * into e from public.employees where id = p_employee and business_id = p_business;
  v_from := greatest(p_start, coalesce(e.join_date, p_start));
  v_to := least(p_end, coalesce(e.exit_date, p_end));
  select c.basic_salary, c.pay_basis into v_basic, v_basis from public.employee_compensation c
   where c.employee_id = p_employee and c.effective_date <= p_end order by c.effective_date desc limit 1;
  v_has_att := exists (select 1 from public.business_modules where business_id = p_business and module_key = 'attendance' and enabled);
  v_has_leave := exists (select 1 from public.business_modules where business_id = p_business and module_key = 'leave' and enabled);

  -- Working days in the whole period (so a month's allowance is measured against the full month).
  d := p_start;
  while d <= p_end loop
    if (select dp.kind from private.day_plan(p_business, p_employee, d) dp) = 'working' then
      v_working := v_working + 1;
      if d between v_from and v_to then v_working_employed := v_working_employed + 1; end if;
    end if;
    d := d + 1;
  end loop;

  if v_has_leave and v_from <= v_to then
    select coalesce(sum(private.leave_days(p_business, lr.leave_type_id, greatest(lr.start_date, v_from), least(lr.end_date, v_to),
               case when lr.start_date >= v_from then lr.start_half else 'full' end,
               case when lr.end_date <= v_to then lr.end_half else 'full' end, e.branch_id)), 0)
      into v_unpaid
      from public.leave_requests lr join public.leave_types lt on lt.id = lr.leave_type_id
     where lr.employee_id = p_employee and lr.status = 'approved' and not lt.is_paid
       and lr.start_date <= v_to and lr.end_date >= v_from;
  end if;

  if v_has_att and v_from <= v_to then
    v_cap := coalesce(((private.policy_for(p_business, p_employee)).overtime_monthly_cap_hours * 60)::int, 2147483647);
    select count(*) filter (where x.status in ('present', 'late', 'early_leave') and x.kind = 'working') as present,
           count(*) filter (where x.status = 'half_day') as half,
           count(*) filter (where x.status = 'absent') as absent,
           count(*) filter (where x.status = 'on_leave') as on_leave,
           count(*) filter (where x.late_minutes > 0) as late_n,
           count(*) filter (where x.status = 'early_leave') as early_n,
           least(coalesce(sum(x.overtime_minutes) filter (where x.overtime_state = 'approved'), 0), v_cap) as ot
      into v_present, v_half, v_absent, v_on_leave, v_late, v_early, v_ot
      from private.attendance_days(p_business, v_from, v_to, p_employee) x;
    select coalesce(max(n), 0) into v_run from (
      select count(*) as n from (
        select status, row_number() over (order by day) - row_number() over (partition by status = 'absent' order by day) as grp
          from private.attendance_days(p_business, v_from, v_to, p_employee)
         where status is not null and status not in ('rest_day', 'holiday')) y
       where status = 'absent' group by grp) z;
  else
    -- Without Time & shifts, everyone counts as present on their working days (less unpaid leave).
    v_present := greatest(v_working_employed - v_unpaid, 0);
  end if;

  return jsonb_build_object(
    'basic_salary', coalesce(v_basic, 0),
    'days_in_month', p_end - p_start + 1,
    'working_days', v_working,
    'days_present', coalesce(v_present, 0) + 0.5 * coalesce(v_half, 0),
    'unapproved_absences', coalesce(v_absent, 0),
    'approved_absences', coalesce(v_on_leave, 0),
    'half_days', coalesce(v_half, 0),
    'late_count', coalesce(v_late, 0),
    'early_leaves', coalesce(v_early, 0),
    'consecutive_unapproved_absences', coalesce(v_run, 0),
    'overtime_hours', round(coalesce(v_ot, 0) / 60.0, 2),
    'unpaid_leave_days', v_unpaid,
    'years_of_service', case when e.join_date is null or e.join_date > p_end then 0 else extract(year from age(p_end, e.join_date))::int end,
    'amount', 0,
    -- Not formula variables; used to explain results.
    '_days_employed', greatest(v_to - v_from + 1, 0),
    '_pay_basis', coalesce(v_basis, 'monthly'),
    '_has_salary', v_basic is not null);
end $$;

create or replace function private.pay_money(p_amount numeric, p_currency text)
returns text
language sql immutable as $$
  select coalesce(p_currency, 'MVR') || ' ' || to_char(round(coalesce(p_amount, 0), 2), 'FM999,999,999,990.00')
$$;

create or replace function private.pay_num(p numeric)
returns text
language sql immutable as $$
  select rtrim(rtrim(to_char(round(coalesce(p, 0), 2), 'FM999,999,999,990.00'), '0'), '.')
$$;

-- ---------------------------------------------------------------------
-- 4. One item for one person: who gets it, how much, and why
-- ---------------------------------------------------------------------
create or replace function private.pay_item_applies(c public.pay_components, p_employee uuid, p_start date, p_end date, p_targets jsonb default null)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
begin
  if not c.is_active or (c.effective_from is not null and c.effective_from > p_end) or (c.effective_to is not null and c.effective_to < p_start) then
    return false;
  end if;
  if c.applies_to = 'all' then return true; end if;
  if c.id is not null and exists (select 1 from public.employee_pay_components o where o.component_id = c.id and o.employee_id = p_employee
                                    and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)) then
    return true;
  end if;
  select * into e from public.employees where id = p_employee;
  if p_targets is not null then
    return exists (select 1 from jsonb_array_elements(p_targets) t
                    where (t ->> 'target_type' = 'employee' and (t ->> 'target_id')::uuid = e.id)
                       or (t ->> 'target_type' = 'department' and (t ->> 'target_id')::uuid = e.department_id)
                       or (t ->> 'target_type' = 'position' and (t ->> 'target_id')::uuid = e.position_id)
                       or (t ->> 'target_type' = 'branch' and (t ->> 'target_id')::uuid = e.branch_id));
  end if;
  return exists (select 1 from public.pay_component_targets t where t.component_id = c.id and (
                   (t.target_type = 'employee' and t.target_id = e.id) or (t.target_type = 'department' and t.target_id = e.department_id)
                   or (t.target_type = 'position' and t.target_id = e.position_id) or (t.target_type = 'branch' and t.target_id = e.branch_id)));
end $$;

create or replace function private.pay_item_result(c public.pay_components, p_employee uuid, p_start date, p_end date, p_vars jsonb, p_currency text)
returns table (amount numeric, explanation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  ov record;
  v_amount numeric;
  v_pct numeric;
  v_basis numeric;
  v_count numeric;
  v_n numeric;
  r numeric;
  v_out numeric;
  v_expl text;
  v_rule jsonb;
  v_vars jsonb;
  v_unit text;
  m text;
begin
  select o.amount, o.percent into ov from public.employee_pay_components o
   where o.component_id = c.id and o.employee_id = p_employee and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)
   order by o.start_date desc limit 1;
  v_amount := coalesce(ov.amount, c.default_amount, 0);
  v_pct := coalesce(ov.percent, c.default_percent, 0);
  v_vars := p_vars || jsonb_build_object('amount', v_amount);

  case c.method
    when 'fixed' then
      r := v_amount;
      v_expl := private.pay_money(v_amount, p_currency) || ' a month';
    when 'per_day' then
      r := v_amount * (p_vars ->> 'days_present')::numeric;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num((p_vars ->> 'days_present')::numeric) || ' days present = ' || private.pay_money(r, p_currency);
    when 'prorated' then
      if c.prorate_basis = 'working' then
        v_basis := (p_vars ->> 'working_days')::numeric;
        v_count := (p_vars ->> 'days_present')::numeric;
        v_unit := ' working days';
      else
        -- Calendar days: every day they were employed counts, less the days they should have been at work and weren't.
        v_basis := (p_vars ->> 'days_in_month')::numeric;
        v_count := greatest(0, (p_vars ->> '_days_employed')::numeric - (p_vars ->> 'unapproved_absences')::numeric
                               - (p_vars ->> 'unpaid_leave_days')::numeric - 0.5 * (p_vars ->> 'half_days')::numeric);
        v_unit := ' days in the month';
      end if;
      r := case when v_basis > 0 then v_amount * v_count / v_basis else 0 end;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_count) || ' of ' || private.pay_num(v_basis) || v_unit
                || ' = ' || private.pay_money(r, p_currency);
    when 'percent' then
      r := (p_vars ->> 'basic_salary')::numeric * v_pct / 100;
      v_expl := private.pay_num(v_pct) || '% of basic salary ' || private.pay_money((p_vars ->> 'basic_salary')::numeric, p_currency)
                || ' = ' || private.pay_money(r, p_currency);
    when 'per_occurrence' then
      v_count := coalesce((p_vars ->> c.occurrence_var)::numeric, 0);
      v_n := greatest(0, v_count - c.occurrence_after);
      r := v_amount * v_n;
      v_unit := case c.occurrence_var
                  when 'late_count' then case when v_count = 1 then 'late' else 'lates' end
                  when 'early_leaves' then case when v_count = 1 then 'early leave' else 'early leaves' end
                  when 'unapproved_absences' then case when v_count = 1 then 'unapproved absence' else 'unapproved absences' end
                  when 'half_days' then case when v_count = 1 then 'half day' else 'half days' end
                  else replace(c.occurrence_var, '_', ' ') end;
      v_expl := private.pay_num(v_count) || ' ' || v_unit
                || case when c.occurrence_after > 0 then ', the first ' || c.occurrence_after || ' free, so ' || private.pay_num(v_n) || ' counted' else '' end
                || ': ' || private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_n) || ' = ' || private.pay_money(r, p_currency);
    else
      r := private.pay_eval(c.formula_ast, v_vars);
      v_expl := c.formula || ' = ' || private.pay_money(r, p_currency);
  end case;
  r := round(greatest(coalesce(r, 0), 0), 2);
  v_out := r;

  if c.rules_mode = 'builder' and jsonb_array_length(c.rules) > 0 then
    v_vars := p_vars || jsonb_build_object('amount', r);
    select x into v_rule from jsonb_array_elements(c.rules) with ordinality t(x, i)
     where private.pay_rule_matches(x, v_vars) order by i limit 1;
    if v_rule is null then
      v_expl := v_expl || '. No rule matched, so it''s paid in full';
    else
      m := v_rule #>> '{outcome,type}';
      v_out := case m
        when 'percent' then r * (v_rule #>> '{outcome,value}')::numeric / 100
        when 'nothing' then 0
        when 'subtract' then greatest(r - (v_rule #>> '{outcome,value}')::numeric, 0)
        when 'fixed' then (v_rule #>> '{outcome,value}')::numeric
        else r end;
      v_expl := v_expl || '. Rule ''' || coalesce(nullif(v_rule ->> 'label', ''), 'rule') || ''' applied: ' || case m
        when 'percent' then private.pay_num((v_rule #>> '{outcome,value}')::numeric) || '% = ' || private.pay_money(v_out, p_currency)
        when 'nothing' then 'nothing paid'
        when 'subtract' then private.pay_money(r, p_currency) || ' − ' || private.pay_money((v_rule #>> '{outcome,value}')::numeric, p_currency) || ' = ' || private.pay_money(v_out, p_currency)
        when 'fixed' then 'set to ' || private.pay_money(v_out, p_currency)
        else 'paid in full' end;
    end if;
  elsif c.rules_mode = 'formula' and c.rules_ast is not null then
    v_out := private.pay_eval(c.rules_ast, p_vars || jsonb_build_object('amount', r));
    v_expl := v_expl || '. Rule formula ' || c.rules_formula || ' gives ' || private.pay_money(greatest(v_out, 0), p_currency);
  end if;

  amount := round(greatest(coalesce(v_out, 0), 0), 2);
  explanation := v_expl;
  return next;
end $$;

-- ---------------------------------------------------------------------
-- 5. Test panel: every item for one person and month (optionally with an unsaved draft)
-- ---------------------------------------------------------------------
create or replace function public.pay_items_preview(p_business uuid, p_employee uuid, p_month date, p_draft jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_vars jsonb;
  v_currency text;
  c public.pay_components;
  v_draft public.pay_components;
  v_items jsonb := '[]'::jsonb;
  v_amt numeric;
  v_ex text;
  v_applies boolean;
  v_targets jsonb;
begin
  if p_business not in (select private.biz_all('payroll', 'view')) or not private.can_emp('compensation', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s pay' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee and business_id = p_business) then
    raise exception 'Choose a person' using errcode = '22023';
  end if;
  select currency into v_currency from public.businesses where id = p_business;
  v_vars := private.pay_vars(p_business, p_employee, v_start, v_end);

  if p_draft is not null then
    select * into v_draft from public.pay_components where id = (p_draft ->> 'id')::uuid and business_id = p_business;
    v_draft := jsonb_populate_record(coalesce(v_draft, null::public.pay_components), (p_draft - 'targets') || jsonb_build_object('business_id', p_business));
    v_draft.is_active := true;
    perform private.pay_item_check(v_draft);
  end if;

  for c in select * from public.pay_components pc where pc.business_id = p_business and pc.is_active
            and (v_draft.id is null or pc.id <> v_draft.id)
           union all select v_draft.* where p_draft is not null
           order by kind desc, sort, name loop
    v_targets := case when p_draft is not null and c.id is not distinct from v_draft.id then p_draft -> 'targets' end;
    v_applies := private.pay_item_applies(c, p_employee, v_start, v_end, v_targets);
    v_amt := null;
    v_ex := null;
    if v_applies then
      select x.amount, x.explanation into v_amt, v_ex from private.pay_item_result(c, p_employee, v_start, v_end, v_vars, v_currency) x;
    end if;
    v_items := v_items || jsonb_build_object(
      'id', c.id, 'name', c.name, 'kind', c.kind, 'draft', p_draft is not null and c.id is not distinct from v_draft.id,
      'applies', v_applies,
      'why_not', case when v_applies then null
                      when (c.effective_from is not null and c.effective_from > v_end) or (c.effective_to is not null and c.effective_to < v_start) then 'Not in effect that month'
                      else 'Not for this person' end,
      'amount', v_amt, 'explanation', v_ex);
  end loop;
  return jsonb_build_object('vars', v_vars, 'currency', v_currency, 'start', v_start, 'end', v_end, 'items', v_items);
end $$;
revoke all on function public.pay_items_preview(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.pay_items_preview(uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Unapproved absences come off pay through an item each company has
-- ---------------------------------------------------------------------
create or replace function private.ensure_absence_item(p_business uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pay_components (business_id, code, name, kind, category, method, default_amount, formula, formula_ast,
                                     is_taxable, is_pensionable, applies_to, template_key, description, sort)
  values (p_business, 'ABSENCE', 'Unapproved absence deduction', 'deduction', 'absence', 'formula', 0,
          'ROUND(basic_salary / working_days * unapproved_absences, 2)',
          '["ROUND", ["*", ["/", ["var", "basic_salary"], ["var", "working_days"]], ["var", "unapproved_absences"]], ["num", 2]]'::jsonb,
          false, false, 'all', 'absence_deduction', 'A day''s basic salary for each unapproved absence.', 900)
  on conflict (business_id, code) do nothing;
end $$;

create or replace function private.on_payroll_enabled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.module_key = 'payroll' and new.enabled then
    perform private.ensure_absence_item(new.business_id);
  end if;
  return new;
end $$;
create trigger payroll_enabled_absence_item after insert or update of enabled on public.business_modules
  for each row execute function private.on_payroll_enabled();

select private.ensure_absence_item(business_id) from public.business_modules where module_key = 'payroll' and enabled;

-- ---------------------------------------------------------------------
-- 7. Payroll uses the items (and explains each line)
-- ---------------------------------------------------------------------
create or replace function public.calculate_payroll_run(p_run uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  b public.businesses;
  e public.employees;
  p public.attendance_policies;
  pen public.pension_schemes;
  tax public.tax_tables;
  comp record;
  pc public.pay_components;
  cl record;
  ln record;
  ar record;
  res record;
  v_vars jsonb;
  v_re uuid;
  v_days int;
  v_workdays int;
  v_from date;
  v_to date;
  v_employed int;
  v_unpaid numeric;
  v_paid_days numeric;
  v_present numeric;
  v_worked_h numeric;
  v_ot_h numeric;
  v_basic numeric;
  v_salary numeric;
  v_hourly numeric;
  v_amount numeric;
  v_rate numeric;
  v_gross numeric;
  v_taxable numeric;
  v_pensionable numeric;
  v_ded numeric;
  v_employer numeric;
  v_pen_emp numeric;
  v_tax numeric;
  v_exc jsonb;
  v_has_att boolean;
  v_has_claims boolean;
  v_bank record;
  v_holiday boolean;
  v_n int := 0;
  v_ot_cap int;
  v_ot_used int;
  v_ot_take int;
  d date;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to calculate this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is finalized and locked' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = r.business_id;
  v_has_att := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'attendance' and enabled);
  v_has_claims := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'claims' and enabled);
  select * into pen from public.pension_schemes where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;
  select * into tax from public.tax_tables where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;

  -- Start again: forget the previous calculation (people kept on hold stay on hold).
  create temp table if not exists _held (employee_id uuid) on commit drop;
  delete from _held where true;
  insert into _held select employee_id from public.payroll_run_employees where run_id = r.id and status in ('excluded', 'on_hold');
  create temp table if not exists _manual (employee_id uuid, code text, name text, kind text, amount numeric, is_taxable boolean, is_pensionable boolean) on commit drop;
  delete from _manual where true;
  insert into _manual select employee_id, code, name, kind, amount, is_taxable, is_pensionable
    from public.payroll_run_lines where run_id = r.id and source = 'manual';
  update public.claims set payroll_run_id = null where payroll_run_id = r.id and status = 'approved';
  delete from public.payroll_run_employees where run_id = r.id;

  v_days := r.period_end - r.period_start + 1;
  v_workdays := 0;
  d := r.period_start;
  while d <= r.period_end loop
    if extract(dow from d)::smallint = any(b.working_days) then v_workdays := v_workdays + 1; end if;
    d := d + 1;
  end loop;

  for e in select * from public.employees
            where business_id = r.business_id
              and (join_date is null or join_date <= r.period_end)
              and (exit_date is null or exit_date >= r.period_start)
              and not (status in ('resigned', 'terminated') and exit_date is null)
            order by first_name, last_name loop
    v_exc := '[]'::jsonb;
    v_from := greatest(r.period_start, coalesce(e.join_date, r.period_start));
    v_to := least(r.period_end, coalesce(e.exit_date, r.period_end));
    v_employed := v_to - v_from + 1;

    select * into comp from public.employee_compensation
     where employee_id = e.id and effective_date <= r.period_end order by effective_date desc limit 1;
    select ba.bank_name, ba.account_name, ba.account_number into v_bank
      from public.employee_bank_accounts ba where ba.employee_id = e.id order by ba.is_primary desc limit 1;

    -- The month's numbers, shared with the allowances and deductions.
    v_vars := private.pay_vars(r.business_id, e.id, r.period_start, r.period_end);
    v_unpaid := (v_vars ->> 'unpaid_leave_days')::numeric;
    v_present := (v_vars ->> 'days_present')::numeric;
    v_worked_h := 0; v_ot_h := (v_vars ->> 'overtime_hours')::numeric;
    if v_has_att then
      select coalesce(sum(worked_minutes), 0) / 60.0 into v_worked_h
        from public.attendance_records where employee_id = e.id and work_date between v_from and v_to;
    end if;

    v_basic := coalesce(comp.basic_salary, 0);
    if comp.basic_salary is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_salary', 'message', 'No salary on their profile', 'severity', 'error');
    end if;
    if v_bank.account_number is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_bank', 'message', 'No bank account on their profile', 'severity', 'warning');
    end if;

    -- Salary for the part of the period they were employed, less unpaid leave.
    -- (Unapproved absences come off through the absence deduction item.)
    if coalesce(comp.pay_basis, 'monthly') = 'monthly' then
      v_paid_days := greatest(0, v_employed - v_unpaid * v_days::numeric / greatest(v_workdays, 1));
      v_salary := round(v_basic * v_paid_days / v_days, 2);
      v_hourly := v_basic / greatest(v_workdays * coalesce(nullif((select full_day_hours from public.attendance_policies where business_id = r.business_id and is_default), 0), 8), 1);
    elsif comp.pay_basis = 'daily' then
      v_paid_days := v_present;
      v_salary := round(v_basic * v_present, 2);
      v_hourly := v_basic / 8;
      if not v_has_att then
        v_exc := v_exc || jsonb_build_object('code', 'daily_no_time', 'message', 'Paid by the day, but Time & shifts is off', 'severity', 'warning');
      end if;
    else
      v_paid_days := v_present;
      v_salary := round(v_basic * v_worked_h, 2);
      v_hourly := v_basic;
    end if;

    insert into public.payroll_run_employees (business_id, run_id, employee_id, employee_code, employee_name, department_name, position_title,
      branch_name, bank_name, bank_account_name, bank_account_number, basic_salary, period_days, paid_days, unpaid_leave_days, absent_days,
      worked_hours, overtime_hours, status)
    values (r.business_id, r.id, e.id, e.employee_code, trim(e.first_name || ' ' || e.last_name),
      (select name from public.departments where id = e.department_id), (select title from public.positions where id = e.position_id),
      (select name from public.branches where id = e.branch_id), v_bank.bank_name, v_bank.account_name, v_bank.account_number,
      v_basic, v_days, round(v_paid_days, 2), v_unpaid, (v_vars ->> 'unapproved_absences')::numeric, round(v_worked_h, 2), round(v_ot_h, 2),
      case when e.id in (select employee_id from _held) then 'on_hold' else 'included' end)
    returning id into v_re;
    v_n := v_n + 1;

    -- Earnings --------------------------------------------------------
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort, explanation)
    values (r.business_id, r.id, v_re, e.id, 'BASIC', 'Basic salary', 'earning', round(v_paid_days, 2), v_basic, v_salary, true, true, 'salary', 0,
            case when coalesce(comp.pay_basis, 'monthly') = 'monthly' and v_salary <> v_basic
                 then private.pay_money(v_basic, b.currency) || ' × ' || private.pay_num(v_paid_days) || ' of ' || v_days || ' days paid' end);

    -- Allowances and deductions: every item that applies to them this period.
    for pc in select * from public.pay_components where business_id = r.business_id and is_active order by kind desc, sort, name loop
      continue when not private.pay_item_applies(pc, e.id, r.period_start, r.period_end);
      select * into res from private.pay_item_result(pc, e.id, r.period_start, r.period_end, v_vars, b.currency);
      continue when coalesce(res.amount, 0) = 0;
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, component_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort, explanation)
      values (r.business_id, r.id, v_re, e.id, pc.id, pc.code, pc.name, pc.kind, res.amount,
              pc.kind = 'earning' and pc.is_taxable, pc.kind = 'earning' and pc.is_pensionable, 'component',
              case when pc.kind = 'earning' then 10 else 75 end + least(pc.sort, 900) / 100, res.explanation);
    end loop;

    -- Overtime from time records, at the rate for the kind of day.
    if v_has_att then
      p := private.policy_for(r.business_id, e.id);
      v_ot_cap := coalesce((p.overtime_monthly_cap_hours * 60)::int, 2147483647);
      v_ot_used := 0;
      for ar in select work_date, overtime_minutes, overtime_type from public.attendance_records
                 where employee_id = e.id and work_date between v_from and v_to and overtime_minutes > 0
                   and (ot_decision = 'approved' or not coalesce(p.overtime_requires_approval, false))
                 order by work_date loop
        v_ot_take := least(ar.overtime_minutes, greatest(0, v_ot_cap - v_ot_used));
        v_ot_used := v_ot_used + v_ot_take;
        continue when v_ot_take = 0;
        v_holiday := exists (select 1 from public.public_holidays h where h.business_id = r.business_id and h.holiday_date = ar.work_date and not h.is_optional);
        v_rate := case ar.overtime_type
                    when 'holiday' then coalesce(p.overtime_rate_holiday, 1.5)
                    when 'rest_day' then coalesce(p.overtime_rate_rest_day, 1.5)
                    when 'normal' then coalesce(p.overtime_rate_weekday, 1.25)
                    else case when v_holiday then coalesce(p.overtime_rate_holiday, 1.5)
                       when not (extract(dow from ar.work_date)::smallint = any(b.working_days)) then coalesce(p.overtime_rate_rest_day, 1.5)
                       else coalesce(p.overtime_rate_weekday, 1.25) end end;
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'OT', 'Overtime ' || to_char(ar.work_date, 'DD Mon') || ' (x' || trim(to_char(v_rate, 'FM0.00')) || ')', 'earning',
                round(v_ot_take / 60.0, 2), round(v_hourly * v_rate, 4), round(v_ot_take / 60.0 * v_hourly * v_rate, 2), true, false, 'overtime', 50);
      end loop;
    end if;

    -- Approved claims paid through payroll, up to this period (claims stay separate from allowances).
    if v_has_claims then
      for cl in select c.id, c.amount, t.name, c.claim_date from public.claims c join public.claim_types t on t.id = c.claim_type_id
                 where c.employee_id = e.id and c.status = 'approved' and c.payout_method = 'payroll' and c.payroll_run_id is null
                   and coalesce(c.target_period_start, c.claim_date) <= r.period_end loop
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, source_id, sort)
        values (r.business_id, r.id, v_re, e.id, 'CLAIM', cl.name || ' claim ' || to_char(cl.claim_date, 'DD Mon'), 'earning', cl.amount, false, false, 'expense_claim', cl.id, 60);
        update public.claims set payroll_run_id = r.id where id = cl.id;
      end loop;
    end if;

    -- Changes typed in by hand on this run are kept when recalculating.
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
    select r.business_id, r.id, v_re, e.id, m.code, m.name, m.kind, m.amount, m.is_taxable, m.is_pensionable, 'manual', 70
      from _manual m where m.employee_id = e.id;

    select coalesce(sum(amount) filter (where kind = 'earning'), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_taxable), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_pensionable), 0)
      into v_gross, v_taxable, v_pensionable
      from public.payroll_run_lines where run_employee_id = v_re;

    -- Deductions ------------------------------------------------------
    for ln in select id, installment_amount, outstanding, kind from public.loans
               where employee_id = e.id and status = 'active' and start_date <= r.period_end and outstanding > 0 loop
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, source_id, sort)
      values (r.business_id, r.id, v_re, e.id, upper(ln.kind), case when ln.kind = 'advance' then 'Salary advance' else 'Loan repayment' end, 'deduction',
              least(ln.installment_amount, ln.outstanding), 'loan', ln.id, 80);
    end loop;

    v_pen_emp := 0; v_employer := 0;
    if pen.id is not null and (pen.applies_to = 'all' or (pen.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := case pen.wage_base when 'basic' then v_salary when 'gross' then v_gross else v_pensionable end;
      if pen.wage_ceiling is not null then v_amount := least(v_amount, pen.wage_ceiling); end if;
      v_pen_emp := round(v_amount * pen.employee_rate / 100, 2);
      v_employer := round(v_amount * pen.employer_rate / 100, 2);
      if v_pen_emp > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'PENSION', 'Pension (' || trim(to_char(pen.employee_rate, 'FM990.###')) || '%)', 'deduction', pen.employee_rate, v_pen_emp, 'statutory', 90);
      end if;
      if v_employer > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'PENSION_ER', 'Employer pension (' || trim(to_char(pen.employer_rate, 'FM990.###')) || '%)', 'employer_contribution', pen.employer_rate, v_employer, 'statutory', 95);
      end if;
    end if;

    v_tax := 0;
    if tax.id is not null and (tax.applies_to = 'all' or (tax.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := greatest(v_taxable - v_pen_emp, 0);
      v_tax := case when tax.basis = 'annual' then round(private.tax_for(tax.id, v_amount * 12) / 12, 2) else private.tax_for(tax.id, v_amount) end;
      if v_tax > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'TAX', 'Income tax', 'deduction', v_tax, 'statutory', 91);
      end if;
    end if;

    select coalesce(sum(amount), 0) into v_ded from public.payroll_run_lines where run_employee_id = v_re and kind = 'deduction';
    if v_gross - v_ded < 0 then
      v_exc := v_exc || jsonb_build_object('code', 'negative', 'message', 'Deductions are more than pay', 'severity', 'error');
    end if;
    update public.payroll_run_employees set
      gross_pay = v_gross, taxable_pay = greatest(v_taxable - v_pen_emp, 0), pensionable_pay = v_pensionable,
      total_deductions = v_ded, net_pay = v_gross - v_ded, employer_contributions = v_employer, exceptions = v_exc
    where id = v_re;
  end loop;

  update public.payroll_runs set
    status = 'calculated', calculated_at = now(), calculated_by = auth.uid(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_gross = (select coalesce(sum(gross_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_deductions = (select coalesce(sum(total_deductions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_net = (select coalesce(sum(net_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_employer_contributions = (select coalesce(sum(employer_contributions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included')
  where id = r.id;
  update public.claims c set payroll_run_id = null
   where c.payroll_run_id = r.id and c.employee_id in (select employee_id from _held);
  return jsonb_build_object('people', v_n);
end $$;

-- ---------------------------------------------------------------------
-- 8. Salaries: change a group at once, or import from a file
-- ---------------------------------------------------------------------
-- p_mode: 'percent' (raise by a percentage), 'add' (add an amount), 'set' (set to an amount).
create or replace function public.bulk_change_salaries(
  p_business uuid, p_employees uuid[], p_mode text, p_value numeric, p_effective date, p_reason text, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_new numeric;
  v_rows jsonb := '[]'::jsonb;
  v_n int := 0;
begin
  if p_business not in (select private.biz_all('compensation', 'edit')) or p_business not in (select private.biz_all('compensation', 'create')) then
    raise exception 'You don''t have permission to change salaries' using errcode = '42501';
  end if;
  if p_mode not in ('percent', 'add', 'set') or p_value is null then
    raise exception 'Choose how to change the salaries' using errcode = '22023';
  end if;
  if p_mode = 'percent' and (p_value <= -100 or p_value > 1000) then
    raise exception 'Use a percentage between -99 and 1000' using errcode = '22023';
  end if;
  if p_effective is null then
    raise exception 'Choose the date the new salaries start' using errcode = '22023';
  end if;
  if coalesce(array_length(p_employees, 1), 0) = 0 then
    raise exception 'Choose at least one person' using errcode = '22023';
  end if;
  for e in select em.id, trim(em.first_name || ' ' || em.last_name) as name, em.employee_code,
                  (select c from public.employee_compensation c where c.employee_id = em.id and c.effective_date <= p_effective
                    order by c.effective_date desc limit 1) as cur
             from public.employees em where em.business_id = p_business and em.id = any(p_employees) order by em.first_name loop
    if (e.cur).basic_salary is null and p_mode <> 'set' then
      v_rows := v_rows || jsonb_build_object('employee_id', e.id, 'name', e.name, 'code', e.employee_code, 'old', null, 'new', null,
                                             'skipped', 'No salary yet, so there''s nothing to raise');
      continue;
    end if;
    v_new := round(case p_mode when 'percent' then (e.cur).basic_salary * (1 + p_value / 100)
                               when 'add' then (e.cur).basic_salary + p_value else p_value end, 2);
    if v_new < 0 then
      v_rows := v_rows || jsonb_build_object('employee_id', e.id, 'name', e.name, 'code', e.employee_code, 'old', (e.cur).basic_salary, 'new', v_new,
                                             'skipped', 'The new salary would be below zero');
      continue;
    end if;
    v_rows := v_rows || jsonb_build_object('employee_id', e.id, 'name', e.name, 'code', e.employee_code, 'old', (e.cur).basic_salary, 'new', v_new);
    if not p_dry_run then
      insert into public.employee_compensation (business_id, employee_id, effective_date, basic_salary, currency, pay_basis, reason)
      values (p_business, e.id, p_effective, v_new, coalesce((e.cur).currency, (select currency from public.businesses where id = p_business)),
              coalesce((e.cur).pay_basis, 'monthly'), nullif(trim(p_reason), ''))
      on conflict (employee_id, effective_date) do update set basic_salary = excluded.basic_salary, reason = excluded.reason;
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('changed', v_n, 'rows', v_rows);
end $$;
revoke all on function public.bulk_change_salaries(uuid, uuid[], text, numeric, date, text, boolean) from public, anon;
grant execute on function public.bulk_change_salaries(uuid, uuid[], text, numeric, date, text, boolean) to authenticated;

-- Rows: [{row, code, salary, date, basis?, reason?}]. Checks everything first; saves only when asked and nothing is wrong.
create or replace function public.import_salaries(p_business uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  v_emp uuid;
  v_errors jsonb := '[]'::jsonb;
  v_ok jsonb := '[]'::jsonb;
  v_salary numeric;
  v_date date;
  v_basis text;
  v_row int;
  v_currency text;
begin
  if p_business not in (select private.biz_all('compensation', 'create')) or p_business not in (select private.biz_all('compensation', 'edit')) then
    raise exception 'You don''t have permission to change salaries' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import up to 5,000 rows at a time' using errcode = '22023';
  end if;
  select currency into v_currency from public.businesses where id = p_business;
  for x in select * from jsonb_array_elements(p_rows) loop
    v_row := coalesce((x ->> 'row')::int, 0);
    select id into v_emp from public.employees where business_id = p_business and lower(employee_code) = lower(trim(x ->> 'code'));
    if v_emp is null then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('No one has the staff number "%s"', coalesce(x ->> 'code', '')));
      continue;
    end if;
    begin
      v_salary := replace(trim(x ->> 'salary'), ',', '')::numeric;
    exception when others then
      v_salary := null;
    end;
    if v_salary is null or v_salary < 0 then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('"%s" isn''t a salary amount', coalesce(x ->> 'salary', '')));
      continue;
    end if;
    begin
      v_date := (x ->> 'date')::date;
    exception when others then
      v_date := null;
    end;
    if v_date is null then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('"%s" isn''t a date (use YYYY-MM-DD)', coalesce(x ->> 'date', '')));
      continue;
    end if;
    v_basis := lower(coalesce(nullif(trim(x ->> 'basis'), ''), 'monthly'));
    if v_basis not in ('monthly', 'daily', 'hourly') then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('"%s" should be monthly, daily or hourly', x ->> 'basis'));
      continue;
    end if;
    v_ok := v_ok || jsonb_build_object('employee_id', v_emp, 'salary', v_salary, 'date', v_date, 'basis', v_basis, 'reason', nullif(trim(x ->> 'reason'), ''));
  end loop;
  if not p_dry_run and jsonb_array_length(v_errors) = 0 then
    insert into public.employee_compensation (business_id, employee_id, effective_date, basic_salary, currency, pay_basis, reason)
    select p_business, (o ->> 'employee_id')::uuid, (o ->> 'date')::date, (o ->> 'salary')::numeric, v_currency, o ->> 'basis', coalesce(o ->> 'reason', 'Imported')
      from jsonb_array_elements(v_ok) o
    on conflict (employee_id, effective_date) do update set basic_salary = excluded.basic_salary, pay_basis = excluded.pay_basis, reason = excluded.reason;
  end if;
  return jsonb_build_object('valid', jsonb_array_length(v_ok), 'errors', v_errors,
                            'imported', case when not p_dry_run and jsonb_array_length(v_errors) = 0 then jsonb_array_length(v_ok) else 0 end);
end $$;
revoke all on function public.import_salaries(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_salaries(uuid, jsonb, boolean) to authenticated;

call private.finalize_tenant_tables();
