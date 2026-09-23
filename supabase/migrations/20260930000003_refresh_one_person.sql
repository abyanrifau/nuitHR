-- =====================================================================
-- 0030 Bring one person's month up to date (their profile), without
--   working out everyone else's.
-- =====================================================================
drop function if exists public.refresh_attendance_month(uuid, date);
create function public.refresh_attendance_month(p_business uuid, p_month date, p_employee uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
begin
  if p_employee is null then
    if p_business not in (select private.biz_with('attendance', 'view')) then
      raise exception 'You don''t have permission to see attendance' using errcode = '42501';
    end if;
  elsif not private.can_emp('attendance', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s attendance' using errcode = '42501';
  end if;
  return private.compute_attendance_month(p_business, p_month, p_employee);
end $$;
revoke all on function public.refresh_attendance_month(uuid, date, uuid) from public, anon;
grant execute on function public.refresh_attendance_month(uuid, date, uuid) to authenticated;

call private.finalize_tenant_tables();
