-- =====================================================================
-- 0006 STORAGE: one private bucket for all tenant files.
--
-- Path convention: {business_id}/{area}/{employee_id or item}/{file}
--   branding/...                 logo, signature, stamp      (all members read; settings editors write)
--   learning/...                 course files                (all members read; learning editors write)
--   recruitment/...              CVs & candidate files       (recruitment)
--   exports/...                  data export ZIPs            (data_export)
--   documents/{employee_id}/...  employee documents          (documents)
--   photos/{employee_id}/...     profile photos              (employees)
--   attendance/{employee_id}/... clock-in selfies            (attendance)
--   leave/{employee_id}/...      leave attachments           (leave)
--   transport/{employee_id}/...  transport claim receipts    (transport_claims)
--   expenses/{employee_id}/...   expense receipts            (expenses)
--   payslips/{employee_id}/...   payslip PDFs                (payslips)
--   letters/{employee_id}/...    generated letters           (letters)
--   compliance/{employee_id}/... compliance documents        (compliance)
--   certificates/{employee_id}/  course certificates         (training)
--   onboarding/{employee_id}/... checklist attachments       (onboarding)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('tenant-files', 'tenant-files', false, 26214400)   -- 25 MB per file
on conflict (id) do nothing;

create or replace function private.storage_can(p_name text, p_action text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := string_to_array(p_name, '/');
  v_bid uuid;
  v_emp uuid;
  v_area text;
  v_resource text;
  v_emp_scoped boolean := true;
begin
  if coalesce(array_length(parts, 1), 0) < 3 then
    return false;
  end if;
  begin
    v_bid := parts[1]::uuid;
  exception when others then
    return false;
  end;
  if v_bid not in (select private.my_business_ids()) then
    return false;
  end if;

  v_area := parts[2];
  case v_area
    when 'branding' then
      if p_action = 'view' then return true; end if;
      v_resource := 'settings'; v_emp_scoped := false;
    when 'learning' then
      if p_action = 'view' then return true; end if;
      v_resource := 'learning'; v_emp_scoped := false;
    when 'recruitment' then v_resource := 'recruitment'; v_emp_scoped := false;
    when 'exports' then v_resource := 'data_export'; v_emp_scoped := false;
    when 'documents' then v_resource := 'documents';
    when 'photos' then v_resource := 'employees';
    when 'attendance' then v_resource := 'attendance';
    when 'leave' then v_resource := 'leave';
    when 'transport' then v_resource := 'transport_claims';
    when 'expenses' then v_resource := 'expenses';
    when 'payslips' then v_resource := 'payslips';
    when 'letters' then v_resource := 'letters';
    when 'compliance' then v_resource := 'compliance';
    when 'certificates' then v_resource := 'training';
    when 'onboarding' then v_resource := 'onboarding';
    else return false;
  end case;

  if not v_emp_scoped then
    -- Settings and course content have no separate create/delete permission: changing files needs 'edit'.
    if v_resource in ('settings', 'learning') and p_action in ('create', 'delete') then
      return v_bid in (select private.biz_all(v_resource, 'edit'));
    end if;
    return v_bid in (select private.biz_all(v_resource, p_action));
  end if;

  begin
    v_emp := parts[3]::uuid;
  exception when others then
    return false;
  end;
  if not exists (select 1 from public.employees e where e.id = v_emp and e.business_id = v_bid) then
    return false;
  end if;

  -- Staff can always upload their own attachments for requests they are allowed to make
  -- (leave/claims/expenses/attendance selfies are also covered by 'create' own scope).
  return v_bid in (select private.biz_all(v_resource, p_action))
      or v_emp in (select private.emp_scope(v_resource, p_action));
end $$;

grant execute on function private.storage_can(text, text) to authenticated;

create policy tenant_files_select on storage.objects for select to authenticated
  using (bucket_id = 'tenant-files' and private.storage_can(name, 'view'));
create policy tenant_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-files' and private.storage_can(name, 'create'));
create policy tenant_files_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-files' and private.storage_can(name, 'edit'))
  with check (bucket_id = 'tenant-files' and private.storage_can(name, 'edit'));
create policy tenant_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-files' and private.storage_can(name, 'delete'));

-- Make sure every helper added in earlier files is callable by signed-in users.
grant execute on all functions in schema private to authenticated, service_role;
