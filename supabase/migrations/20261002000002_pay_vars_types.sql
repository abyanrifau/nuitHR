-- =====================================================================
-- 0034 Fix: a person with no days employed in a pay period (for example
--   someone who joins after it) made the monthly numbers fail for the
--   next person worked out, which could stop a pay run. The numbers now
--   use plain typed variables, so both ways of working them out match.
-- =====================================================================
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

call private.finalize_tenant_tables();
