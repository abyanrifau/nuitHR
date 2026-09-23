-- =====================================================================
-- 0037 PAYROLL RUNS, completed
--   * A run is for a pay schedule (monthly, semi-monthly, bi-weekly or
--     weekly) and only includes the people on that schedule. Ad-hoc runs
--     pay one-off amounts such as bonuses and nothing else.
--   * Monthly amounts (salary, fixed and percentage allowances) are
--     shared out over shorter pay periods, and tax on a monthly table is
--     worked out on the monthly equivalent.
--   * Steps: calculate (as often as needed) → approve → finalize (locks,
--     publishes payslips) → paid. Approving can be undone before
--     finalizing. Only the owner can reverse a finalized run, with a reason.
--   * Adjustments by hand need a reason and are kept in the history.
--   * More things to check on each person: no time records, missing
--     clock-outs, requests still waiting, and big changes from last month.
-- =====================================================================

alter table public.payroll_runs
  add column if not exists run_type text not null default 'regular' check (run_type in ('regular', 'adhoc')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null,
  add column if not exists payslips_emailed_at timestamptz;
create index if not exists payroll_runs_approved_by_fk_idx on public.payroll_runs (approved_by);
alter table public.payroll_runs drop constraint if exists payroll_runs_status_check;
alter table public.payroll_runs add constraint payroll_runs_status_check
  check (status in ('draft', 'calculated', 'approved', 'finalized', 'paid', 'reversed'));

-- How much of a monthly amount one pay period gets.
create or replace function private.pay_period_factor(p_frequency text)
returns numeric
language sql immutable as $$
  select case p_frequency when 'semi_monthly' then 0.5 when 'biweekly' then 12.0 / 26 when 'weekly' then 12.0 / 52 else 1 end
$$;

-- ---------------------------------------------------------------------
-- Creating runs
-- ---------------------------------------------------------------------
drop function if exists public.create_payroll_run(uuid, date, date, date, text);
create function public.create_payroll_run(
  p_business uuid, p_start date, p_end date, p_pay_date date, p_name text default null,
  p_schedule uuid default null, p_type text default 'regular')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_sched public.pay_schedules;
begin
  if p_business not in (select private.biz_all('payroll', 'create')) then
    raise exception 'You don''t have permission to run payroll' using errcode = '42501';
  end if;
  if p_type not in ('regular', 'adhoc') then
    raise exception 'Choose a regular or an ad-hoc run' using errcode = '22023';
  end if;
  if p_end < p_start or p_end - p_start > 62 then
    raise exception 'Choose a pay period of up to two months' using errcode = '22023';
  end if;
  if p_schedule is not null then
    select * into v_sched from public.pay_schedules where id = p_schedule and business_id = p_business and is_active;
    if v_sched.id is null then raise exception 'Choose a pay schedule' using errcode = '22023'; end if;
  else
    select * into v_sched from public.pay_schedules where business_id = p_business and is_default;
  end if;
  if p_type = 'regular' and exists (
      select 1 from public.payroll_runs where business_id = p_business and status <> 'reversed' and run_type = 'regular'
         and pay_schedule_id is not distinct from v_sched.id and period_start <= p_end and period_end >= p_start) then
    raise exception 'There''s already a pay run for some of those dates on this pay schedule' using errcode = '22023';
  end if;
  insert into public.payroll_runs (business_id, pay_schedule_id, name, period_start, period_end, pay_date, run_type)
  values (p_business, v_sched.id,
          coalesce(nullif(trim(p_name), ''),
                   case when p_type = 'adhoc' then 'Bonus ' || to_char(p_pay_date, 'FMMonth YYYY')
                        when coalesce(v_sched.frequency, 'monthly') = 'monthly' then to_char(p_start, 'FMMonth YYYY') || ' payroll'
                        else to_char(p_start, 'DD Mon') || ' to ' || to_char(p_end, 'DD Mon YYYY') || ' payroll' end),
          p_start, p_end, p_pay_date, p_type)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_payroll_run(uuid, date, date, date, text, uuid, text) from public, anon;
grant execute on function public.create_payroll_run(uuid, date, date, date, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Calculating
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
  v_sched public.pay_schedules;
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
  v_factor numeric;
  v_adhoc boolean;
  v_expl text;
  v_count int;
  v_prev numeric;
  d date;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to calculate this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is locked (approved or finalized). Undo the approval to change it.' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = r.business_id;
  select * into v_sched from public.pay_schedules where id = r.pay_schedule_id;
  v_adhoc := r.run_type = 'adhoc';
  v_factor := case when v_adhoc then 1 else private.pay_period_factor(coalesce(v_sched.frequency, 'monthly')) end;
  v_has_att := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'attendance' and enabled);
  v_has_claims := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'claims' and enabled);
  select * into pen from public.pension_schemes where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;
  select * into tax from public.tax_tables where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;

  -- Start again: forget the previous calculation (people kept on hold stay on hold, amounts added by hand stay).
  create temp table if not exists _held (employee_id uuid) on commit drop;
  delete from _held where true;
  insert into _held select employee_id from public.payroll_run_employees where run_id = r.id and status in ('excluded', 'on_hold');
  create temp table if not exists _manual (employee_id uuid, code text, name text, kind text, amount numeric, is_taxable boolean, is_pensionable boolean, explanation text) on commit drop;
  delete from _manual where true;
  insert into _manual select employee_id, code, name, kind, amount, is_taxable, is_pensionable, explanation
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

  for e in select * from public.employees em
            where em.business_id = r.business_id
              and (em.join_date is null or em.join_date <= r.period_end)
              and (em.exit_date is null or em.exit_date >= r.period_start)
              and not (em.status in ('resigned', 'terminated') and em.exit_date is null)
              -- Only the people paid on this run's schedule (people without one are on the default schedule).
              and (v_adhoc or r.pay_schedule_id is null or em.pay_schedule_id = r.pay_schedule_id
                   or (em.pay_schedule_id is null and coalesce(v_sched.is_default, false)))
            order by em.first_name, em.last_name loop
    v_exc := '[]'::jsonb;
    v_from := greatest(r.period_start, coalesce(e.join_date, r.period_start));
    v_to := least(r.period_end, coalesce(e.exit_date, r.period_end));
    v_employed := v_to - v_from + 1;

    select * into comp from public.employee_compensation
     where employee_id = e.id and effective_date <= r.period_end order by effective_date desc limit 1;
    select ba.bank_name, ba.account_name, ba.account_number into v_bank
      from public.employee_bank_accounts ba where ba.employee_id = e.id order by ba.is_primary desc limit 1;

    v_vars := private.pay_vars(r.business_id, e.id, r.period_start, r.period_end);
    v_unpaid := (v_vars ->> 'unpaid_leave_days')::numeric;
    v_present := (v_vars ->> 'days_present')::numeric;
    v_worked_h := 0;
    v_ot_h := (v_vars ->> 'overtime_hours')::numeric;
    if v_has_att then
      select coalesce(sum(worked_minutes), 0) / 60.0 into v_worked_h
        from public.attendance_records where employee_id = e.id and work_date between v_from and v_to;
    end if;

    v_basic := coalesce(comp.basic_salary, 0);
    if v_bank.account_number is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_bank', 'message', 'No bank account on their profile', 'severity', 'warning');
    end if;
    if not v_adhoc then
      if comp.basic_salary is null then
        v_exc := v_exc || jsonb_build_object('code', 'no_salary', 'message', 'No salary on their profile', 'severity', 'error');
      end if;
      if v_has_att then
        -- No time records at all in the period: every working day would be an unapproved absence.
        if (v_vars ->> 'unapproved_absences')::numeric > 0
           and not exists (select 1 from public.attendance_records a where a.employee_id = e.id and a.work_date between v_from and v_to and a.clock_in_at is not null) then
          v_exc := v_exc || jsonb_build_object('code', 'no_attendance', 'severity', 'warning',
            'message', 'No time records this period, so ' || (v_vars ->> 'unapproved_absences') || ' working days count as unapproved absences');
        end if;
        select count(*) into v_count from public.attendance_records a
         where a.employee_id = e.id and a.work_date between v_from and v_to and a.clock_in_at is not null and a.clock_out_at is null;
        if v_count > 0 then
          v_exc := v_exc || jsonb_build_object('code', 'no_clock_out', 'severity', 'warning',
            'message', v_count || case when v_count = 1 then ' day has' else ' days have' end || ' no clock-out');
        end if;
        select count(*) into v_count from public.attendance_records a
         where a.employee_id = e.id and a.work_date between v_from and v_to and a.overtime_minutes > 0 and a.ot_decision is null
           and coalesce((private.policy_for(r.business_id, e.id)).overtime_requires_approval, false);
        if v_count > 0 then
          v_exc := v_exc || jsonb_build_object('code', 'overtime_waiting', 'severity', 'warning',
            'message', v_count || case when v_count = 1 then ' day' else ' days' end || ' of overtime still waiting for approval (not paid until approved)');
        end if;
      end if;
      -- Requests still waiting that could change this pay: time off in the period, claims, time fixes.
      select count(*) into v_count from public.approval_requests apr
       where apr.employee_id = e.id and apr.status = 'pending'
         and (apr.source_table <> 'leave_requests'
              or exists (select 1 from public.leave_requests lr where lr.id = apr.source_id and lr.start_date <= v_to and lr.end_date >= v_from));
      if v_count > 0 then
        v_exc := v_exc || jsonb_build_object('code', 'pending_requests', 'severity', 'warning',
          'message', v_count || case when v_count = 1 then ' request is' else ' requests are' end || ' still waiting for a decision');
      end if;
    end if;

    -- Salary for the part of the period they were employed, less unpaid leave.
    -- Monthly salaries are shared out over shorter pay periods.
    if v_adhoc then
      v_paid_days := 0;
      v_salary := 0;
      v_hourly := 0;
    elsif coalesce(comp.pay_basis, 'monthly') = 'monthly' then
      v_paid_days := greatest(0, v_employed - v_unpaid * v_days::numeric / greatest(v_workdays, 1));
      v_salary := round(v_basic * v_factor * v_paid_days / v_days, 2);
      v_hourly := v_basic / greatest(round(v_workdays / v_factor) * coalesce(nullif((select full_day_hours from public.attendance_policies where business_id = r.business_id and is_default), 0), 8), 1);
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
      v_basic, v_days, round(v_paid_days, 2), case when v_adhoc then 0 else v_unpaid end,
      case when v_adhoc then 0 else (v_vars ->> 'unapproved_absences')::numeric end, round(v_worked_h, 2), round(v_ot_h, 2),
      case when e.id in (select employee_id from _held) then 'on_hold' else 'included' end)
    returning id into v_re;
    v_n := v_n + 1;

    if not v_adhoc then
      -- Earnings ------------------------------------------------------
      v_expl := null;
      if coalesce(comp.pay_basis, 'monthly') = 'monthly' then
        if v_factor <> 1 then
          v_expl := private.pay_money(v_basic, b.currency) || ' a month × ' || private.pay_num(v_factor) || ' for this pay period'
                    || case when round(v_paid_days, 2) < v_days then ' × ' || private.pay_num(v_paid_days) || ' of ' || v_days || ' days paid' else '' end;
        elsif v_salary <> v_basic then
          v_expl := private.pay_money(v_basic, b.currency) || ' × ' || private.pay_num(v_paid_days) || ' of ' || v_days || ' days paid'
                    || case when v_employed < v_days then ' (employed ' || v_employed || ' days)' else '' end
                    || case when v_unpaid > 0 then ', less ' || private.pay_num(v_unpaid) || ' working days of unpaid leave' else '' end;
        end if;
      elsif comp.pay_basis = 'daily' then
        v_expl := private.pay_money(v_basic, b.currency) || ' a day × ' || private.pay_num(v_present) || ' days present';
      else
        v_expl := private.pay_money(v_basic, b.currency) || ' an hour × ' || private.pay_num(v_worked_h) || ' hours worked';
      end if;
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort, explanation)
      values (r.business_id, r.id, v_re, e.id, 'BASIC', 'Basic salary', 'earning', round(v_paid_days, 2), v_basic, v_salary, true, true, 'salary', 0, v_expl);

      -- Allowances and deductions: every item that applies to them this period.
      for pc in select * from public.pay_components where business_id = r.business_id and is_active order by kind desc, sort, name loop
        continue when not private.pay_item_applies(pc, e.id, r.period_start, r.period_end);
        select * into res from private.pay_item_result(pc, e.id, r.period_start, r.period_end, v_vars, b.currency);
        v_amount := res.amount;
        v_expl := res.explanation;
        -- Monthly amounts are shared out over shorter pay periods.
        if v_factor <> 1 and pc.method in ('fixed', 'percent', 'prorated') then
          v_amount := round(v_amount * v_factor, 2);
          v_expl := v_expl || '. × ' || private.pay_num(v_factor) || ' for this pay period = ' || private.pay_money(v_amount, b.currency);
        end if;
        continue when coalesce(v_amount, 0) = 0;
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, component_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, pc.id, pc.code, pc.name, pc.kind, v_amount,
                pc.kind = 'earning' and pc.is_taxable, pc.kind = 'earning' and pc.is_pensionable, 'component',
                case when pc.kind = 'earning' then 10 else 75 end + least(pc.sort, 900) / 100, v_expl);
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
          insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort, explanation)
          values (r.business_id, r.id, v_re, e.id, 'OT', 'Overtime ' || to_char(ar.work_date, 'DD Mon') || ' (x' || trim(to_char(v_rate, 'FM0.00')) || ')', 'earning',
                  round(v_ot_take / 60.0, 2), round(v_hourly * v_rate, 4), round(v_ot_take / 60.0 * v_hourly * v_rate, 2), true, false, 'overtime', 50,
                  private.pay_num(round(v_ot_take / 60.0, 2)) || ' hours × ' || private.pay_money(v_hourly, b.currency) || ' an hour × ' || trim(to_char(v_rate, 'FM0.00'))
                  || case ar.overtime_type when 'holiday' then ' (public holiday)' when 'rest_day' then ' (rest day)' else ' (normal day)' end);
        end loop;
      end if;

      -- Approved claims paid through payroll, up to this period (claims stay separate from allowances).
      if v_has_claims then
        for cl in select c.id, c.amount, t.name, c.claim_date from public.claims c join public.claim_types t on t.id = c.claim_type_id
                   where c.employee_id = e.id and c.status = 'approved' and c.payout_method = 'payroll' and c.payroll_run_id is null
                     and coalesce(c.target_period_start, c.claim_date) <= r.period_end loop
          insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, source_id, sort, explanation)
          values (r.business_id, r.id, v_re, e.id, 'CLAIM', cl.name || ' claim ' || to_char(cl.claim_date, 'DD Mon'), 'earning', cl.amount, false, false, 'expense_claim', cl.id, 60,
                  'Approved claim, paid back with pay (not taxed)');
          update public.claims set payroll_run_id = r.id where id = cl.id;
        end loop;
      end if;
    end if;

    -- Amounts added by hand on this run (with their reasons) are kept when recalculating.
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort, explanation)
    select r.business_id, r.id, v_re, e.id, m.code, m.name, m.kind, m.amount, m.is_taxable, m.is_pensionable, 'manual', 70, m.explanation
      from _manual m where m.employee_id = e.id;

    select coalesce(sum(amount) filter (where kind = 'earning'), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_taxable), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_pensionable), 0)
      into v_gross, v_taxable, v_pensionable
      from public.payroll_run_lines where run_employee_id = v_re;

    -- Deductions ------------------------------------------------------
    if not v_adhoc then
      for ln in select id, installment_amount, outstanding, kind from public.loans
                 where employee_id = e.id and status = 'active' and start_date <= r.period_end and outstanding > 0 loop
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, source_id, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, upper(ln.kind), case when ln.kind = 'advance' then 'Salary advance' else 'Loan repayment' end, 'deduction',
                least(ln.installment_amount, ln.outstanding), 'loan', ln.id, 80,
                'Instalment ' || private.pay_money(ln.installment_amount, b.currency) || ', ' || private.pay_money(ln.outstanding, b.currency) || ' still owed before this');
      end loop;
    end if;

    v_pen_emp := 0; v_employer := 0;
    if pen.id is not null and (pen.applies_to = 'all' or (pen.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := case pen.wage_base when 'basic' then v_salary when 'gross' then v_gross else v_pensionable end;
      if pen.wage_ceiling is not null then v_amount := least(v_amount, round(pen.wage_ceiling * v_factor, 2)); end if;
      v_pen_emp := round(v_amount * pen.employee_rate / 100, 2);
      v_employer := round(v_amount * pen.employer_rate / 100, 2);
      if v_pen_emp > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, 'PENSION', 'Pension (' || trim(to_char(pen.employee_rate, 'FM990.###')) || '%)', 'deduction', pen.employee_rate, v_pen_emp, 'statutory', 90,
                trim(to_char(pen.employee_rate, 'FM990.###')) || '% of ' || private.pay_money(v_amount, b.currency) || ' '
                || case pen.wage_base when 'basic' then 'basic salary' when 'gross' then 'total earnings' else 'pensionable pay' end);
      end if;
      if v_employer > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, 'PENSION_ER', 'Employer pension (' || trim(to_char(pen.employer_rate, 'FM990.###')) || '%)', 'employer_contribution', pen.employer_rate, v_employer, 'statutory', 95,
                trim(to_char(pen.employer_rate, 'FM990.###')) || '% of ' || private.pay_money(v_amount, b.currency) || ', paid by the company on top');
      end if;
    end if;

    v_tax := 0;
    if tax.id is not null and (tax.applies_to = 'all' or (tax.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := greatest(v_taxable - v_pen_emp, 0);
      -- Worked out on the monthly (or yearly) equivalent, then shared back to this pay period.
      v_tax := case when tax.basis = 'annual' then round(private.tax_for(tax.id, v_amount / v_factor * 12) / 12 * v_factor, 2)
                    else round(private.tax_for(tax.id, v_amount / v_factor) * v_factor, 2) end;
      if v_tax > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, 'TAX', 'Income tax', 'deduction', v_tax, 'statutory', 91,
                'On taxable pay of ' || private.pay_money(v_amount, b.currency) || ' after pension, using ' || tax.name
                || case when v_factor <> 1 then ' (worked out on the monthly equivalent)' else '' end);
      end if;
    end if;

    select coalesce(sum(amount), 0) into v_ded from public.payroll_run_lines where run_employee_id = v_re and kind = 'deduction';
    if v_gross - v_ded < 0 then
      v_exc := v_exc || jsonb_build_object('code', 'negative', 'message', 'Deductions are more than pay', 'severity', 'error');
    end if;
    -- A big change from their last regular pay.
    if not v_adhoc then
      select pe.net_pay into v_prev from public.payroll_run_employees pe join public.payroll_runs pr on pr.id = pe.run_id
       where pe.employee_id = e.id and pr.business_id = r.business_id and pr.run_type = 'regular' and pr.status in ('finalized', 'paid')
         and pr.period_end < r.period_start and pr.pay_schedule_id is not distinct from r.pay_schedule_id
       order by pr.period_end desc limit 1;
      if v_prev is not null and v_prev > 0 and abs((v_gross - v_ded) - v_prev) / v_prev > 0.2 then
        v_exc := v_exc || jsonb_build_object('code', 'big_change', 'severity', 'warning',
          'message', 'Net pay is ' || round(abs((v_gross - v_ded) - v_prev) / v_prev * 100) || '% ' || case when v_gross - v_ded > v_prev then 'higher' else 'lower' end
                     || ' than last time (' || private.pay_money(v_prev, b.currency) || ' → ' || private.pay_money(v_gross - v_ded, b.currency) || ')');
      end if;
      v_prev := null;
    end if;
    update public.payroll_run_employees set
      gross_pay = v_gross, taxable_pay = greatest(v_taxable - v_pen_emp, 0), pensionable_pay = v_pensionable,
      total_deductions = v_ded, net_pay = v_gross - v_ded, employer_contributions = v_employer, exceptions = v_exc
    where id = v_re;
  end loop;

  update public.payroll_runs set
    status = 'calculated', calculated_at = now(), calculated_by = auth.uid(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = r.id and status = 'included' and (not v_adhoc or gross_pay <> 0)),
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
-- Adjustments by hand: need a reason, kept in the history
-- ---------------------------------------------------------------------
drop function if exists public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean);
create function public.add_payroll_adjustment(
  p_run uuid, p_employee uuid, p_name text, p_kind text, p_amount numeric, p_taxable boolean default true, p_pensionable boolean default false,
  p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  v_re uuid;
  v_id uuid;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is locked (approved or finalized). Undo the approval to change it.' using errcode = '42501';
  end if;
  if p_kind not in ('earning', 'deduction') or coalesce(p_amount, 0) <= 0 or coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name and an amount above zero' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add the reason. It''s kept in the history.' using errcode = '22023';
  end if;
  select id into v_re from public.payroll_run_employees where run_id = p_run and employee_id = p_employee;
  if v_re is null then
    raise exception 'That person isn''t on this pay run' using errcode = '22023';
  end if;
  insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort, explanation)
  values (r.business_id, p_run, v_re, p_employee, 'ADJ', trim(left(p_name, 80)), p_kind, round(p_amount, 2),
          p_kind = 'earning' and coalesce(p_taxable, true), p_kind = 'earning' and coalesce(p_pensionable, false), 'manual', 70,
          'Added by hand: ' || trim(left(p_reason, 300)))
  returning id into v_id;
  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, resource, subject_employee_id, changes)
  values (r.business_id, auth.uid(), 'adjust', 'payroll_run_lines', v_id, 'payroll', p_employee,
          jsonb_build_object('run', jsonb_build_object('to', r.name), 'name', jsonb_build_object('to', trim(p_name)), 'kind', jsonb_build_object('to', p_kind),
                             'amount', jsonb_build_object('to', round(p_amount, 2)), 'reason', jsonb_build_object('to', trim(p_reason))));
  perform public.calculate_payroll_run(p_run);
end $$;
revoke all on function public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean, text) from public, anon;
grant execute on function public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean, text) to authenticated;

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
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is locked (approved or finalized). Undo the approval to change it.' using errcode = '42501';
  end if;
  delete from public.payroll_run_lines where id = l.id;
  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, resource, subject_employee_id, changes)
  values (r.business_id, auth.uid(), 'remove_adjustment', 'payroll_run_lines', l.id, 'payroll', l.employee_id,
          jsonb_build_object('run', jsonb_build_object('from', r.name), 'name', jsonb_build_object('from', l.name),
                             'amount', jsonb_build_object('from', l.amount), 'reason', jsonb_build_object('from', l.explanation)));
  perform public.calculate_payroll_run(r.id);
end $$;

-- ---------------------------------------------------------------------
-- Approve, undo approval, finalize, reverse
-- ---------------------------------------------------------------------
create or replace function public.approve_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to approve a pay run' using errcode = '42501';
  end if;
  if r.status <> 'calculated' then
    raise exception 'Calculate the pay run before approving it' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_run_employees where run_id = r.id and status = 'included'
              and exceptions @> '[{"severity":"error"}]'::jsonb) then
    raise exception 'Some people have problems to fix first (shown in red), or put them on hold' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = r.id;
end $$;

create or replace function public.unapprove_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to change a pay run''s approval' using errcode = '42501';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only an approved run that isn''t finalized can go back' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'calculated', approved_at = null, approved_by = null where id = r.id;
end $$;

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
  if r.status <> 'approved' then
    raise exception 'Approve the pay run before finalizing it' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_run_employees where run_id = r.id and status = 'included'
              and exceptions @> '[{"severity":"error"}]'::jsonb) then
    raise exception 'Some people have problems to fix first (shown in red), or put them on hold' using errcode = '22023';
  end if;
  -- Held people (and, on ad-hoc runs, people with nothing to pay) come off the run.
  delete from public.payroll_run_employees where run_id = r.id and (status <> 'included' or (r.run_type = 'adhoc' and gross_pay = 0 and total_deductions = 0));

  for l in select source_id, amount from public.payroll_run_lines where run_id = r.id and source = 'loan' loop
    insert into public.loan_repayments (business_id, loan_id, run_id, amount, paid_on, method)
    values (r.business_id, l.source_id, r.id, l.amount, r.pay_date, 'payroll');
    update public.loans set outstanding = greatest(outstanding - l.amount, 0),
                            status = case when outstanding - l.amount <= 0 then 'completed' else status end
     where id = l.source_id;
  end loop;
  update public.claims set status = 'paid', paid_at = now(), paid_reference = r.name
   where payroll_run_id = r.id and status = 'approved';
  if r.run_type = 'regular' then
    update public.timesheets set payroll_run_id = r.id
     where business_id = r.business_id and status = 'approved' and period_start >= r.period_start and period_end <= r.period_end;
    update public.leave_requests set payroll_run_id = r.id
     where business_id = r.business_id and status = 'approved' and start_date <= r.period_end and end_date >= r.period_start
       and leave_type_id in (select id from public.leave_types where business_id = r.business_id and not is_paid);
  end if;

  update public.payroll_runs set status = 'finalized', finalized_at = now(), finalized_by = auth.uid(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = r.id)
   where id = r.id;
  update public.payroll_run_employees set payslip_published_at = now() where run_id = r.id;
  for pe in select employee_id from public.payroll_run_employees where run_id = r.id loop
    perform private.notify(r.business_id, private.user_for_employee(r.business_id, pe.employee_id), 'payroll.payslip_ready',
      'Your payslip for ' || r.name || ' is here', null, '/staff/pay', 'payroll');
  end loop;
end $$;

-- Only the owner can undo a finalized run, and must say why.
create or replace function public.reverse_payroll_run(p_run uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  l record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or not private.is_owner(r.business_id) then
    raise exception 'Only the owner can reverse a finalized pay run' using errcode = '42501';
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

create or replace function public.delete_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'delete')) then
    raise exception 'You don''t have permission to delete pay runs' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated', 'approved') then
    raise exception 'Finalized pay runs can''t be deleted; reverse them instead' using errcode = '22023';
  end if;
  update public.claims set payroll_run_id = null where payroll_run_id = r.id;
  delete from public.payroll_runs where id = r.id;
end $$;

-- Recorded when payslips are emailed from the pay run.
create or replace function public.mark_payslips_emailed(p_run uuid, p_employees uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to send payslips' using errcode = '42501';
  end if;
  update public.payroll_run_employees set payslip_emailed_at = now() where run_id = p_run and employee_id = any(p_employees);
  update public.payroll_runs set payslips_emailed_at = now() where id = p_run;
end $$;

revoke all on function public.approve_payroll_run(uuid) from public, anon;
revoke all on function public.unapprove_payroll_run(uuid) from public, anon;
revoke all on function public.mark_payslips_emailed(uuid, uuid[]) from public, anon;
grant execute on function public.approve_payroll_run(uuid) to authenticated;
grant execute on function public.unapprove_payroll_run(uuid) to authenticated;
grant execute on function public.mark_payslips_emailed(uuid, uuid[]) to authenticated;

call private.finalize_tenant_tables();
