-- =====================================================================
-- 0025 One person's time off balances, for their profile in the office
--   view. Same permission as seeing their time off (all, team or own),
--   and brings the balances up to date first, like the Balances tab.
-- =====================================================================
create or replace function public.employee_leave_balances(p_business uuid, p_employee uuid, p_year int default null)
returns table (leave_type_id uuid, name text, color text, accrual_method text, balance numeric, taken numeric, pending numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_year int := coalesce(p_year, extract(year from private.biz_today(p_business))::int);
  lt record;
begin
  if not private.can_emp('leave', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s time off' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.business_id = p_business) then
    return;
  end if;
  for lt in select id from public.leave_types where business_id = p_business and is_active loop
    perform private.ensure_balance(p_business, p_employee, lt.id, v_year);
  end loop;
  return query
    select t.id, t.name, t.color, t.accrual_method, b.balance, b.taken, b.pending
      from public.leave_types t
      join public.leave_balances b on b.leave_type_id = t.id and b.employee_id = p_employee and b.period_year = v_year
     where t.business_id = p_business and t.is_active
     order by t.sort, t.name;
end $$;
revoke all on function public.employee_leave_balances(uuid, uuid, int) from public, anon;
grant execute on function public.employee_leave_balances(uuid, uuid, int) to authenticated;

call private.finalize_tenant_tables();
