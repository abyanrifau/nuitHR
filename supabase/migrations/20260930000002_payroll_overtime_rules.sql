-- =====================================================================
-- 0029 PAYROLL OVERTIME follows the attendance rules: only overtime that
--   is approved (when approval is required) is paid, at the rate for the
--   kind of day it was worked on (normal day, rest day, public holiday),
--   and no more than the monthly cap. Everything else is unchanged.
-- =====================================================================
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
             coalesce(sum(worked_minutes), 0) / 60.0,
             -- Overtime that can be paid: approved when the rules need approval, and within the monthly cap.
             least(coalesce(sum(overtime_minutes) filter (where ot_decision = 'approved' or not coalesce((private.policy_for(r.business_id, e.id)).overtime_requires_approval, false)), 0),
                   coalesce(((private.policy_for(r.business_id, e.id)).overtime_monthly_cap_hours * 60)::int, 2147483647)) / 60.0
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
      v_ot_cap := coalesce((p.overtime_monthly_cap_hours * 60)::int, 2147483647);
      v_ot_used := 0;
      for ar in select work_date, overtime_minutes, overtime_type from public.attendance_records
                 where employee_id = e.id and work_date between v_from and v_to and overtime_minutes > 0
                   and (ot_decision = 'approved' or not coalesce(p.overtime_requires_approval, false))
                 order by work_date loop
        -- Up to the monthly cap, in date order.
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

call private.finalize_tenant_tables();
