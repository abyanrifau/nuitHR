-- =====================================================================
-- 0010 STAFF APP
--   Staff can see their own records but not change them directly. These
--   functions let each person update a small, safe set of their own
--   details, and see a limited colleague directory. Every change still
--   goes through the audit trail triggers on the tables.
-- =====================================================================

-- The current user's own employee record in a company (null if not linked).
create or replace function private.my_employee_in(p_business uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select m.employee_id from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active'
$$;

-- Update my own contact details. Only these fields; nothing about pay, job or status.
create or replace function public.update_my_contact(
  p_business uuid, p_phone text, p_personal_email text, p_current_address text, p_permanent_address text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if coalesce(p_personal_email, '') <> '' and p_personal_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email' using errcode = '22023';
  end if;
  update public.employees set
    phone = nullif(trim(left(p_phone, 40)), ''),
    personal_email = nullif(lower(trim(left(p_personal_email, 200))), ''),
    current_address = nullif(trim(left(p_current_address, 500)), ''),
    permanent_address = nullif(trim(left(p_permanent_address, 500)), '')
  where id = v_emp and business_id = p_business;
end $$;

-- Add or change one of my emergency contacts (p_id null = add).
create or replace function public.save_my_emergency_contact(
  p_business uuid, p_id uuid, p_name text, p_relationship text, p_phone text, p_is_primary boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_id uuid;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name' using errcode = '22023';
  end if;
  if coalesce(p_is_primary, false) then
    update public.employee_emergency_contacts set is_primary = false where employee_id = v_emp and business_id = p_business;
  end if;
  if p_id is null then
    insert into public.employee_emergency_contacts (business_id, employee_id, name, relationship, phone, is_primary)
    values (p_business, v_emp, trim(left(p_name, 120)), nullif(trim(left(p_relationship, 80)), ''), nullif(trim(left(p_phone, 40)), ''), coalesce(p_is_primary, false))
    returning id into v_id;
  else
    update public.employee_emergency_contacts set
      name = trim(left(p_name, 120)), relationship = nullif(trim(left(p_relationship, 80)), ''),
      phone = nullif(trim(left(p_phone, 40)), ''), is_primary = coalesce(p_is_primary, false)
    where id = p_id and employee_id = v_emp and business_id = p_business
    returning id into v_id;
    if v_id is null then
      raise exception 'Contact not found' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.delete_my_emergency_contact(p_business uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
begin
  delete from public.employee_emergency_contacts where id = p_id and employee_id = v_emp and business_id = p_business;
  if not found then
    raise exception 'Contact not found' using errcode = '22023';
  end if;
end $$;

-- Colleague directory: names, job, team, location and work email only. No personal details.
create or replace function public.staff_directory(p_business uuid)
returns table (id uuid, first_name text, last_name text, preferred_name text, job_title text, department text, location text, work_email text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.first_name, e.last_name, e.preferred_name, p.title, d.name, b.name, e.work_email
    from public.employees e
    left join public.positions p on p.id = e.position_id
    left join public.departments d on d.id = e.department_id
    left join public.branches b on b.id = e.branch_id
   where e.business_id = p_business
     and p_business in (select private.my_business_ids())
     and e.status in ('active', 'probation', 'on_leave')
   order by e.first_name, e.last_name
$$;

revoke all on function public.update_my_contact(uuid, text, text, text, text) from public, anon;
revoke all on function public.save_my_emergency_contact(uuid, uuid, text, text, text, boolean) from public, anon;
revoke all on function public.delete_my_emergency_contact(uuid, uuid) from public, anon;
revoke all on function public.staff_directory(uuid) from public, anon;
grant execute on function public.update_my_contact(uuid, text, text, text, text) to authenticated;
grant execute on function public.save_my_emergency_contact(uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.delete_my_emergency_contact(uuid, uuid) to authenticated;
grant execute on function public.staff_directory(uuid) to authenticated;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
