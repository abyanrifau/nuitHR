-- =====================================================================
-- 0031 After the attendance rules or schedules change, work days out
--   again from a date on (days in finalized payroll periods stay as
--   they were).
-- =====================================================================
create or replace function public.recalc_attendance_since(p_business uuid, p_from date)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n int := 0;
begin
  if p_business not in (select private.biz_all('attendance', 'edit')) then
    raise exception 'You don''t have permission to change attendance rules' using errcode = '42501';
  end if;
  for r in select a.id from public.attendance_records a
            where a.business_id = p_business and a.work_date >= p_from and a.clock_in_at is not null
              and not private.attendance_locked(a.business_id, a.work_date) loop
    perform private.recalc_attendance(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.recalc_attendance_since(uuid, date) from public, anon;
grant execute on function public.recalc_attendance_since(uuid, date) to authenticated;

call private.finalize_tenant_tables();
