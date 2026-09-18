-- =====================================================================
-- 0012 PAYROLL & CLAIMS
--   The payroll engine: salary (prorated for joiners, leavers, unpaid
--   leave and absence), allowances and deductions, overtime from time
--   records, approved claims, loan instalments, pension and income tax.
--   Runs go draft → calculated → finalized (locked, payslips published)
--   → paid, and can be reversed with a reason.
--   Staff claims with cut-off days, approval, and payout.
--   Rates come from each company's own settings, never from code.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Income tax on an amount using a table's brackets (progressive).
create or replace function private.tax_for(p_table uuid, p_amount numeric)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(round(sum(
           (greatest(0, least(p_amount, coalesce(b.upper_bound, p_amount)) - b.lower_bound)) * b.rate / 100
           + case when p_amount > b.lower_bound then b.fixed_amount else 0 end), 2), 0)
    from public.tax_brackets b
   where b.tax_table_id = p_table and p_amount > b.lower_bound
$$;

-- Is this person a local for pension/tax purposes?
create or replace function private.is_local(e public.employees, p_country text)
returns boolean
language sql immutable as $$
  select not coalesce(e.is_expatriate, false) and coalesce(e.nationality, p_country) = p_country
$$;

-- ---------------------------------------------------------------------
-- Creating a run
-- ---------------------------------------------------------------------
create or replace function public.create_payroll_run(p_business uuid, p_start date, p_end date, p_pay_date date, p_name text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_sched uuid;
begin
  if p_business not in (select private.biz_all('payroll', 'create')) then
    raise exception 'You don''t have permission to run payroll' using errcode = '42501';
  end if;
  if p_end < p_start or p_end - p_start > 62 then
    raise exception 'Choose a pay period of up to two months' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_runs where business_id = p_business and status <> 'reversed'
              and period_start <= p_end and period_end >= p_start) then
    raise exception 'There''s already a pay run for some of those dates' using errcode = '22023';
  end if;
  select id into v_sched from public.pay_schedules where business_id = p_business and is_default;
  insert into public.payroll_runs (business_id, pay_schedule_id, name, period_start, period_end, pay_date)
  values (p_business, v_sched, coalesce(nullif(trim(p_name), ''), to_char(p_start, 'FMMonth YYYY') || ' payroll'), p_start, p_end, p_pay_date)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Calculating a run (can be repeated until it's finalized)
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
  pc record;
  cl record;
  ln record;
  ar record;
  v_re uuid;
  v_days int;                -- calendar days in the period
  v_workdays int;            -- working days in the period
  v_from date;
  v_to date;
  v_employed int;            -- calendar days employed in the period
  v_unpaid numeric;
  v_absent numeric;
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
  v_sort int;
  v_has_att boolean;
  v_has_leave boolean;
  v_has_claims boolean;
  v_bank record;
  v_holiday boolean;
  v_n int := 0;
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
  v_has_leave := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'leave' and enabled);
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
    v_sort := 0;
    v_from := greatest(r.period_start, coalesce(e.join_date, r.period_start));
    v_to := least(r.period_end, coalesce(e.exit_date, r.period_end));
    v_employed := v_to - v_from + 1;

    select * into comp from public.employee_compensation
     where employee_id = e.id and effective_date <= r.period_end order by effective_date desc limit 1;
    select ba.bank_name, ba.account_name, ba.account_number into v_bank
      from public.employee_bank_accounts ba where ba.employee_id = e.id order by ba.is_primary desc limit 1;

    -- Days not paid: unpaid leave and absences (working days only).
    v_unpaid := 0;
    if v_has_leave then
      select coalesce(sum(private.leave_days(r.business_id, lr.leave_type_id, greatest(lr.start_date, v_from), least(lr.end_date, v_to),
                 case when lr.start_date >= v_from then lr.start_half else 'full' end,
                 case when lr.end_date <= v_to then lr.end_half else 'full' end, e.branch_id)), 0)
        into v_unpaid
        from public.leave_requests lr join public.leave_types lt on lt.id = lr.leave_type_id
       where lr.employee_id = e.id and lr.status = 'approved' and not lt.is_paid
         and lr.start_date <= v_to and lr.end_date >= v_from;
    end if;
    v_absent := 0; v_present := 0; v_worked_h := 0; v_ot_h := 0;
    if v_has_att then
      select count(*) filter (where status = 'absent'),
             count(*) filter (where status in ('present','late')) + 0.5 * count(*) filter (where status = 'half_day'),
             coalesce(sum(worked_minutes), 0) / 60.0, coalesce(sum(overtime_minutes), 0) / 60.0
        into v_absent, v_present, v_worked_h, v_ot_h
        from public.attendance_records where employee_id = e.id and work_date between v_from and v_to;
    end if;

    v_basic := coalesce(comp.basic_salary, 0);
    if comp.basic_salary is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_salary', 'message', 'No salary on their profile', 'severity', 'error');
    end if;
    if v_bank.account_number is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_bank', 'message', 'No bank account on their profile', 'severity', 'warning');
    end if;

    -- Salary for the part of the period they were employed, less unpaid days.
    if coalesce(comp.pay_basis, 'monthly') = 'monthly' then
      v_paid_days := greatest(0, v_employed - (v_unpaid + v_absent) * v_days::numeric / greatest(v_workdays, 1));
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
      v_basic, v_days, round(v_paid_days, 2), v_unpaid, v_absent, round(v_worked_h, 2), round(v_ot_h, 2),
      case when e.id in (select employee_id from _held) then 'on_hold' else 'included' end)
    returning id into v_re;
    v_n := v_n + 1;

    -- Earnings --------------------------------------------------------
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort)
    values (r.business_id, r.id, v_re, e.id, 'BASIC', 'Basic salary', 'earning', round(v_paid_days, 2), v_basic, v_salary, true, true, 'salary', 0);

    for pc in select epc.amount, epc.percent, c.id, c.code, c.name, c.kind, c.calc_type, c.default_amount, c.default_percent,
                     c.is_taxable, c.is_pensionable, c.prorate, c.category, c.sort
                from public.employee_pay_components epc join public.pay_components c on c.id = epc.component_id
               where epc.employee_id = e.id and c.is_active and epc.start_date <= v_to and (epc.end_date is null or epc.end_date >= v_from) loop
      v_amount := case pc.calc_type
        when 'fixed' then coalesce(pc.amount, pc.default_amount) * case when pc.prorate and coalesce(comp.pay_basis, 'monthly') = 'monthly' then v_paid_days / v_days else 1 end
        when 'percent_of_basic' then v_basic * coalesce(pc.percent, pc.default_percent, 0) / 100 * case when pc.prorate then v_paid_days / v_days else 1 end
        when 'per_day_present' then coalesce(pc.amount, pc.default_amount) * v_present
        when 'per_hour_worked' then coalesce(pc.amount, pc.default_amount) * v_worked_h
        else coalesce(pc.amount, pc.default_amount) end;
      v_amount := round(coalesce(v_amount, 0), 2);
      continue when v_amount = 0;
      v_sort := v_sort + 1;
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, component_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
      values (r.business_id, r.id, v_re, e.id, pc.id, pc.code, pc.name, pc.kind, v_amount,
              pc.kind = 'earning' and pc.is_taxable, pc.kind = 'earning' and pc.is_pensionable, 'component', 10 + pc.sort);
    end loop;

    -- Overtime from time records, at the rate for the kind of day.
    if v_has_att then
      p := private.policy_for(r.business_id, e.id);
      for ar in select work_date, overtime_minutes from public.attendance_records
                 where employee_id = e.id and work_date between v_from and v_to and overtime_minutes > 0 loop
        v_holiday := exists (select 1 from public.public_holidays h where h.business_id = r.business_id and h.holiday_date = ar.work_date and not h.is_optional);
        v_rate := case when v_holiday then coalesce(p.overtime_rate_holiday, 1.5)
                       when not (extract(dow from ar.work_date)::smallint = any(b.working_days)) then coalesce(p.overtime_rate_rest_day, 1.5)
                       else coalesce(p.overtime_rate_weekday, 1.25) end;
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'OT', 'Overtime ' || to_char(ar.work_date, 'DD Mon') || ' (x' || trim(to_char(v_rate, 'FM0.00')) || ')', 'earning',
                round(ar.overtime_minutes / 60.0, 2), round(v_hourly * v_rate, 4), round(ar.overtime_minutes / 60.0 * v_hourly * v_rate, 2), true, false, 'overtime', 50);
      end loop;
    end if;

    -- Approved claims paid through payroll, up to this period.
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
  -- Claims for people on hold wait for the next run.
  update public.claims c set payroll_run_id = null
   where c.payroll_run_id = r.id and c.employee_id in (select employee_id from _held);
  return jsonb_build_object('people', v_n);
end $$;

-- Hold someone back from a run (or include them again), then recalculate.
create or replace function public.set_payroll_person_status(p_run uuid, p_employee uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  if p_status not in ('included', 'on_hold') then
    raise exception 'Choose include or hold' using errcode = '22023';
  end if;
  update public.payroll_run_employees set status = p_status where run_id = p_run and employee_id = p_employee;
  perform public.calculate_payroll_run(p_run);
end $$;

-- Add a one-off amount for someone on this run (bonus, correction...). Kept when recalculating.
create or replace function public.add_payroll_adjustment(
  p_run uuid, p_employee uuid, p_name text, p_kind text, p_amount numeric, p_taxable boolean default true, p_pensionable boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  v_re uuid;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is finalized and locked' using errcode = '42501';
  end if;
  if p_kind not in ('earning', 'deduction') or coalesce(p_amount, 0) <= 0 or coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name and an amount above zero' using errcode = '22023';
  end if;
  select id into v_re from public.payroll_run_employees where run_id = p_run and employee_id = p_employee;
  if v_re is null then
    raise exception 'That person isn''t on this pay run' using errcode = '22023';
  end if;
  insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
  values (r.business_id, p_run, v_re, p_employee, 'ADJ', trim(left(p_name, 80)), p_kind, round(p_amount, 2),
          p_kind = 'earning' and coalesce(p_taxable, true), p_kind = 'earning' and coalesce(p_pensionable, false), 'manual', 70);
  perform public.calculate_payroll_run(p_run);
end $$;

create or replace function public.remove_payroll_adjustment(p_line uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.payroll_run_lines; r public.payroll_runs;
begin
  select * into l from public.payroll_run_lines where id = p_line and source = 'manual';
  select * into r from public.payroll_runs where id = l.run_id;
  if l.id is null or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  delete from public.payroll_run_lines where id = l.id;
  perform public.calculate_payroll_run(r.id);
end $$;

-- ---------------------------------------------------------------------
-- Finalizing, paying and reversing
-- ---------------------------------------------------------------------
create or replace function public.finalize_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  l record;
  pe record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to finalize a pay run' using errcode = '42501';
  end if;
  if r.status <> 'calculated' then
    raise exception 'Calculate the pay run before finalizing it' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_run_employees where run_id = r.id and status = 'included'
              and exceptions @> '[{"severity":"error"}]'::jsonb) then
    raise exception 'Some people have problems to fix first (shown in red), or put them on hold' using errcode = '22023';
  end if;
  -- Held people come off the run entirely.
  delete from public.payroll_run_employees where run_id = r.id and status <> 'included';

  -- Loans: record the repayments and bring the balances down.
  for l in select source_id, amount from public.payroll_run_lines where run_id = r.id and source = 'loan' loop
    insert into public.loan_repayments (business_id, loan_id, run_id, amount, paid_on, method)
    values (r.business_id, l.source_id, r.id, l.amount, r.pay_date, 'payroll');
    update public.loans set outstanding = greatest(outstanding - l.amount, 0),
                            status = case when outstanding - l.amount <= 0 then 'completed' else status end
     where id = l.source_id;
  end loop;
  update public.claims set status = 'paid', paid_at = now(), paid_reference = r.name
   where payroll_run_id = r.id and status = 'approved';
  update public.timesheets set payroll_run_id = r.id
   where business_id = r.business_id and status = 'approved' and period_start >= r.period_start and period_end <= r.period_end;
  update public.leave_requests set payroll_run_id = r.id
   where business_id = r.business_id and status = 'approved' and start_date <= r.period_end and end_date >= r.period_start
     and leave_type_id in (select id from public.leave_types where business_id = r.business_id and not is_paid);

  update public.payroll_runs set status = 'finalized', finalized_at = now(), finalized_by = auth.uid() where id = r.id;
  update public.payroll_run_employees set payslip_published_at = now() where run_id = r.id;
  for pe in select employee_id from public.payroll_run_employees where run_id = r.id loop
    perform private.notify(r.business_id, private.user_for_employee(r.business_id, pe.employee_id), 'payroll.payslip_ready',
      'Your payslip for ' || to_char(r.period_start, 'FMMonth YYYY') || ' is here', null, '/staff/pay', 'payroll');
  end loop;
end $$;

create or replace function public.mark_payroll_paid(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to mark a pay run as paid' using errcode = '42501';
  end if;
  if r.status <> 'finalized' then
    raise exception 'Only a finalized pay run can be marked as paid' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'paid', paid_at = now() where id = r.id;
end $$;

-- Undo a finalized run: payslips are withdrawn, loans and claims go back.
create or replace function public.reverse_payroll_run(p_run uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  l record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to reverse a pay run' using errcode = '42501';
  end if;
  if r.status not in ('finalized', 'paid') then
    raise exception 'Only a finalized or paid run can be reversed. Delete a draft instead.' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add the reason for reversing' using errcode = '22023';
  end if;
  for l in select loan_id, amount from public.loan_repayments where run_id = r.id loop
    update public.loans set outstanding = least(outstanding + l.amount, principal), status = 'active' where id = l.loan_id;
  end loop;
  delete from public.loan_repayments where run_id = r.id;
  update public.claims set status = 'approved', paid_at = null, paid_reference = null, payroll_run_id = null where payroll_run_id = r.id;
  update public.timesheets set payroll_run_id = null where payroll_run_id = r.id;
  update public.leave_requests set payroll_run_id = null where payroll_run_id = r.id;
  update public.payroll_runs set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason) where id = r.id;
end $$;

-- A draft or calculated run can be thrown away.
create or replace function public.delete_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'delete')) then
    raise exception 'You don''t have permission to delete pay runs' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'Finalized pay runs can''t be deleted; reverse them instead' using errcode = '22023';
  end if;
  update public.claims set payroll_run_id = null where payroll_run_id = r.id;
  delete from public.payroll_runs where id = r.id;
end $$;

-- ---------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------
create or replace function public.submit_claim(
  p_business uuid, p_type uuid, p_date date, p_amount numeric, p_description text default null,
  p_route text default null, p_receipt text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  t public.claim_types;
  v_today date := private.biz_today(p_business);
  v_target date;
  v_late boolean := false;
  v_method text;
  v_id uuid;
  v_name text;
  v_cur text;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business and module_key = 'claims' and enabled) then
    raise exception 'Claims aren''t switched on for your company' using errcode = '42501';
  end if;
  select * into t from public.claim_types where id = p_type and business_id = p_business and is_active;
  if not found then
    raise exception 'Choose a type of claim' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Enter the amount' using errcode = '22023';
  end if;
  if t.max_amount is not null and p_amount > t.max_amount then
    raise exception '% claims can be up to %', t.name, t.max_amount using errcode = '22023';
  end if;
  if p_date > v_today then
    raise exception 'The date can''t be in the future' using errcode = '22023';
  end if;
  if p_date < v_today - 90 then
    raise exception 'Claims must be sent within 90 days' using errcode = '22023';
  end if;
  if t.requires_receipt and p_receipt is null then
    raise exception 'Add a photo of the receipt' using errcode = '22023';
  end if;
  if p_receipt is not null and p_receipt not like p_business::text || '/claims/' || v_emp::text || '/%' then
    raise exception 'That receipt is in the wrong folder' using errcode = '22023';
  end if;
  -- After the cut-off day, the claim is paid with next month's payroll.
  v_target := date_trunc('month', v_today)::date;
  if t.cutoff_day is not null and extract(day from v_today) > t.cutoff_day then
    v_target := (v_target + interval '1 month')::date;
    v_late := true;
  end if;
  v_method := case when exists (select 1 from public.business_modules where business_id = p_business and module_key = 'payroll' and enabled)
                   then t.payout_method else 'separate' end;
  select currency into v_cur from public.businesses where id = p_business;
  insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, currency, description, route, receipt_path,
                             payout_method, target_period_start, is_late)
  values (p_business, v_emp, t.id, p_date, round(p_amount, 2), v_cur, nullif(trim(left(p_description, 500)), ''), nullif(trim(left(p_route, 200)), ''),
          p_receipt, v_method, v_target, v_late)
  returning id into v_id;
  select trim(first_name || ' ' || last_name) into v_name from public.employees where id = v_emp;
  perform private.create_request(p_business, 'claim', 'claims', 'claims', v_id, v_emp,
    t.name || ' claim from ' || v_name,
    concat_ws(' · ', to_char(p_date, 'DD Mon'), nullif(trim(p_route), ''), nullif(trim(p_description), '')),
    round(p_amount, 2), jsonb_build_object('claim_type', t.name));
  return v_id;
end $$;

-- Claims paid outside payroll (cash or bank transfer): mark them as paid.
create or replace function public.mark_claims_paid(p_business uuid, p_ids uuid[], p_reference text)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if p_business not in (select private.biz_all('claims', 'edit')) then
    raise exception 'You don''t have permission to pay claims' using errcode = '42501';
  end if;
  update public.claims set status = 'paid', paid_at = now(), paid_reference = nullif(trim(p_reference), '')
   where business_id = p_business and id = any(p_ids) and status = 'approved' and payroll_run_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Tell staff when a claim is answered.
create or replace function private.after_claim_decided() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Claims decided in the Requests list already send "your request was decided", so only notify for direct decisions.
  if new.status in ('approved', 'rejected') and old.status = 'pending'
     and not exists (select 1 from public.approval_requests ar where ar.source_table = 'claims' and ar.source_id = new.id) then
    perform private.notify(new.business_id, private.user_for_employee(new.business_id, new.employee_id), 'claims.decided',
      case when new.status = 'approved' then 'Claim approved' else 'Claim declined' end,
      concat_ws(' · ', (select currency from public.businesses where id = new.business_id) || ' ' || to_char(new.amount, 'FM999,999,990.00'), new.decision_comment),
      '/staff/claims', 'claims');
  end if;
  return new;
end $$;
drop trigger if exists claim_decided_notify on public.claims;
create trigger claim_decided_notify after update of status on public.claims
  for each row execute function private.after_claim_decided();

revoke all on function public.create_payroll_run(uuid, date, date, date, text) from public, anon;
revoke all on function public.calculate_payroll_run(uuid) from public, anon;
revoke all on function public.set_payroll_person_status(uuid, uuid, text) from public, anon;
revoke all on function public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean) from public, anon;
revoke all on function public.remove_payroll_adjustment(uuid) from public, anon;
revoke all on function public.finalize_payroll_run(uuid) from public, anon;
revoke all on function public.mark_payroll_paid(uuid) from public, anon;
revoke all on function public.reverse_payroll_run(uuid, text) from public, anon;
revoke all on function public.delete_payroll_run(uuid) from public, anon;
revoke all on function public.submit_claim(uuid, uuid, date, numeric, text, text, text) from public, anon;
revoke all on function public.mark_claims_paid(uuid, uuid[], text) from public, anon;
grant execute on function public.create_payroll_run(uuid, date, date, date, text) to authenticated;
grant execute on function public.calculate_payroll_run(uuid) to authenticated;
grant execute on function public.set_payroll_person_status(uuid, uuid, text) to authenticated;
grant execute on function public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean) to authenticated;
grant execute on function public.remove_payroll_adjustment(uuid) to authenticated;
grant execute on function public.finalize_payroll_run(uuid) to authenticated;
grant execute on function public.mark_payroll_paid(uuid) to authenticated;
grant execute on function public.reverse_payroll_run(uuid, text) to authenticated;
grant execute on function public.delete_payroll_run(uuid) to authenticated;
grant execute on function public.submit_claim(uuid, uuid, date, numeric, text, text, text) to authenticated;
grant execute on function public.mark_claims_paid(uuid, uuid[], text) to authenticated;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
