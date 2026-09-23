-- =====================================================================
-- 0027 The staff app's colleague directory also returns each person's
--   picture. Still no personal details.
-- =====================================================================
drop function if exists public.staff_directory(uuid);
create function public.staff_directory(p_business uuid)
returns table (id uuid, first_name text, last_name text, preferred_name text, job_title text, department text, location text, work_email text, photo_path text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.first_name, e.last_name, e.preferred_name, p.title, d.name, b.name, e.work_email, e.photo_path
    from public.employees e
    left join public.positions p on p.id = e.position_id
    left join public.departments d on d.id = e.department_id
    left join public.branches b on b.id = e.branch_id
   where e.business_id = p_business
     and p_business in (select private.my_business_ids())
     and e.status in ('active', 'probation', 'on_leave')
   order by e.first_name, e.last_name
$$;
revoke all on function public.staff_directory(uuid) from public, anon;
grant execute on function public.staff_directory(uuid) to authenticated;

call private.finalize_tenant_tables();
