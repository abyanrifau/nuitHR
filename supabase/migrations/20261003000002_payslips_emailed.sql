-- =====================================================================
-- 0038 A finalized run can record when its payslips were emailed
--   (nothing else about it can change).
-- =====================================================================
create or replace function private.guard_payroll_run_status() returns trigger
language plpgsql as $$
begin
  if old.status in ('finalized','paid') then
    if new.status = old.status then
      if (to_jsonb(new) - array['updated_at','notes','payslips_emailed_at']) <> (to_jsonb(old) - array['updated_at','notes','payslips_emailed_at']) then
        raise exception 'This payroll run is finalized and locked' using errcode = '42501';
      end if;
    elsif not (new.status = 'paid' and old.status = 'finalized') and new.status <> 'reversed' then
      raise exception 'A finalized payroll run can only be marked paid or reversed' using errcode = '42501';
    end if;
  end if;
  if old.status = 'reversed' and new is distinct from old then
    raise exception 'A reversed payroll run cannot be changed' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status = 'reversed' and old.status <> 'reversed'
     and private.is_client_context()
     and new.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to reverse a run' using errcode = '42501';
  end if;
  return new;
end $$;

call private.finalize_tenant_tables();
