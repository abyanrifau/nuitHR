-- =====================================================================
-- 0026 Profile pictures are added by people who can edit staff profiles
--   (owners, admins, HR), not by staff themselves. Setting your own
--   picture on your staff profile now needs that permission too.
-- =====================================================================
create or replace function public.set_my_photo(p_business uuid, p_path text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid;
begin
  if p_business not in (select private.biz_with('employees', 'edit')) then
    raise exception 'Pictures are added by your HR team' using errcode = '42501';
  end if;
  if p_path is not null and p_path !~ ('^users/' || auth.uid()::text || '/[0-9a-f-]{36}\.(webp|jpg|png)$') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select m.employee_id into v_emp from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active';
  if v_emp is null then return; end if;
  update public.employees set photo_path = p_path where id = v_emp and business_id = p_business;
end $$;
revoke all on function public.set_my_photo(uuid, text) from public, anon;
grant execute on function public.set_my_photo(uuid, text) to authenticated;

call private.finalize_tenant_tables();
