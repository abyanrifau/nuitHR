-- Only start a joiner checklist for people who are actually new: joining in the
-- last 30 days or later. Adding long-standing staff (for example an import) doesn't
-- flood HR with checklists for people who joined years ago.
create or replace function private.checklists_for_people() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.join_date is null or new.join_date >= private.biz_today(new.business_id) - 30 then
      perform public.start_checklist(new.id, 'onboarding', null, 'employee_created');
    end if;
  elsif new.status in ('resigned', 'terminated') and old.status not in ('resigned', 'terminated') then
    perform public.start_checklist(new.id, 'offboarding', null, 'status_change');
  end if;
  return new;
end $$;

call private.finalize_tenant_tables();
