-- =====================================================================
-- 0014 HIRING, JOINERS & LEAVERS, PERMITS & RENEWALS
--   * Public careers page applications (no sign-in needed)
--   * Hiring a candidate straight into the people directory
--   * Joiner and leaver checklists that start by themselves
--   * Daily reminders before permits, passports and visas run out
-- =====================================================================

-- ---------------------------------------------------------------------
-- Careers page
-- ---------------------------------------------------------------------
-- Anyone can apply for an open, public role. Returns the application id.
-- The CV is uploaded by the server (it checks size and type) before this is called.
create or replace function public.submit_application(
  p_slug text, p_vacancy uuid, p_full_name text, p_email text, p_phone text default null,
  p_cover_letter text default null, p_cv_path text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.vacancies;
  v_bid uuid;
  v_cand uuid;
  v_app uuid;
  u uuid;
begin
  select b.id into v_bid from public.businesses b where b.slug = p_slug and b.careers_page_enabled;
  select * into v from public.vacancies where id = p_vacancy and business_id = v_bid
     and is_public and status = 'open' and (deadline is null or deadline >= private.biz_today(v_bid));
  if v.id is null then
    raise exception 'This role isn''t open for applications' using errcode = '22023';
  end if;
  if coalesce(trim(p_full_name), '') = '' or length(p_full_name) > 120 then
    raise exception 'Enter your full name' using errcode = '22023';
  end if;
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200 then
    raise exception 'Enter a valid email' using errcode = '22023';
  end if;
  if p_cv_path is not null and p_cv_path not like v_bid::text || '/recruitment/%' then
    raise exception 'That file is in the wrong folder' using errcode = '22023';
  end if;
  -- One candidate per email; applying again for the same role is refused.
  select id into v_cand from public.candidates where business_id = v_bid and lower(email) = lower(trim(p_email)) order by created_at limit 1;
  if v_cand is null then
    insert into public.candidates (business_id, full_name, email, phone, cv_path, source)
    values (v_bid, trim(p_full_name), lower(trim(p_email)), nullif(trim(left(p_phone, 40)), ''), p_cv_path, 'careers_page')
    returning id into v_cand;
  else
    update public.candidates set full_name = trim(p_full_name), phone = coalesce(nullif(trim(left(p_phone, 40)), ''), phone),
      cv_path = coalesce(p_cv_path, cv_path) where id = v_cand;
  end if;
  if exists (select 1 from public.applications where vacancy_id = v.id and candidate_id = v_cand) then
    raise exception 'You''ve already applied for this role. We''ll be in touch.' using errcode = '22023';
  end if;
  insert into public.applications (business_id, vacancy_id, candidate_id, cover_letter)
  values (v_bid, v.id, v_cand, nullif(trim(left(p_cover_letter, 5000)), ''))
  returning id into v_app;
  -- Tell the hiring manager, or everyone who runs hiring.
  if v.hiring_manager_user_id is not null then
    perform private.notify(v_bid, v.hiring_manager_user_id, 'recruitment.application', 'New applicant: ' || trim(p_full_name), v.title, '/app/hiring/' || v.id, 'recruitment');
  else
    for u in select * from private.members_with(v_bid, 'recruitment', 'view') loop
      perform private.notify(v_bid, u, 'recruitment.application', 'New applicant: ' || trim(p_full_name), v.title, '/app/hiring/' || v.id, 'recruitment');
    end loop;
  end if;
  return v_app;
end $$;

-- ---------------------------------------------------------------------
-- Hiring
-- ---------------------------------------------------------------------
create or replace function public.hire_candidate(
  p_application uuid, p_join_date date, p_employee_code text, p_position uuid default null,
  p_department uuid default null, p_branch uuid default null, p_manager uuid default null,
  p_salary numeric default null, p_contract_type text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.applications;
  c public.candidates;
  v public.vacancies;
  v_emp uuid;
  v_first text;
  v_last text;
  v_hired int;
begin
  select * into a from public.applications where id = p_application;
  if a.id is null or a.business_id not in (select private.biz_all('recruitment', 'edit'))
     or a.business_id not in (select private.biz_all('employees', 'create')) then
    raise exception 'You need rights to hiring and to add people to hire someone' using errcode = '42501';
  end if;
  if a.stage = 'hired' then
    raise exception 'This candidate is already hired' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_code), '') = '' then
    raise exception 'Enter an employee number' using errcode = '22023';
  end if;
  if p_salary is not null and p_salary > 0 and a.business_id not in (select private.biz_all('compensation', 'create')) then
    raise exception 'Only people allowed to set salaries can add one' using errcode = '42501';
  end if;
  select * into c from public.candidates where id = a.candidate_id;
  select * into v from public.vacancies where id = a.vacancy_id;
  v_first := split_part(trim(c.full_name), ' ', 1);
  v_last := trim(substr(trim(c.full_name), length(v_first) + 1));
  insert into public.employees (business_id, employee_code, first_name, last_name, personal_email, phone, nationality,
                                status, join_date, contract_type, position_id, department_id, branch_id, manager_id)
  values (a.business_id, trim(p_employee_code), v_first, v_last, c.email, c.phone, c.nationality,
          'probation', p_join_date, coalesce(p_contract_type, v.employment_type, 'permanent'),
          coalesce(p_position, v.position_id), coalesce(p_department, v.department_id), coalesce(p_branch, v.branch_id), p_manager)
  returning id into v_emp;
  if p_salary is not null and p_salary > 0 then
    insert into public.employee_compensation (business_id, employee_id, effective_date, basic_salary, currency, reason)
    values (a.business_id, v_emp, p_join_date, p_salary, (select currency from public.businesses where id = a.business_id), 'Starting salary');
  end if;
  -- The CV goes into their files.
  if c.cv_path is not null then
    insert into public.employee_documents (business_id, employee_id, title, file_path, file_name, visible_to_employee)
    values (a.business_id, v_emp, 'CV', c.cv_path, 'CV', false);
  end if;
  update public.applications set stage = 'hired', hired_employee_id = v_emp, stage_changed_at = now() where id = a.id;
  update public.offers set status = 'accepted', responded_at = coalesce(responded_at, now()) where application_id = a.id and status in ('draft','sent');
  select count(*) into v_hired from public.applications where vacancy_id = v.id and stage = 'hired';
  if v_hired >= v.openings then
    update public.vacancies set status = 'filled' where id = v.id and status in ('open','draft');
  end if;
  perform public.start_checklist(v_emp, 'onboarding', null, 'hired');
  return v_emp;
end $$;

-- ---------------------------------------------------------------------
-- Joiner and leaver checklists
-- ---------------------------------------------------------------------
-- Start a checklist for someone from a template (or the default one). Returns the checklist id, or null if there's no template.
create or replace function public.start_checklist(p_employee uuid, p_kind text, p_template uuid default null, p_source text default 'manual')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  t public.checklist_templates;
  x record;
  v_id uuid;
  v_base date;
  v_mgr_user uuid;
  v_emp_user uuid;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null then return null; end if;
  -- Called by the system (triggers, hiring) or by people who manage checklists.
  if private.is_client_context() and not private.can_emp('onboarding', 'create', e.business_id, e.id) and p_source = 'manual' then
    raise exception 'You don''t have permission to start checklists' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = e.business_id and module_key = 'onboarding' and enabled) then
    return null;
  end if;
  if p_kind not in ('onboarding', 'offboarding') then
    raise exception 'Choose joiner or leaver' using errcode = '22023';
  end if;
  if exists (select 1 from public.employee_checklists where employee_id = e.id and kind = p_kind and status = 'in_progress') then
    return (select id from public.employee_checklists where employee_id = e.id and kind = p_kind and status = 'in_progress' limit 1);
  end if;
  -- Most specific template first: position, then department, then the default.
  select * into t from public.checklist_templates
   where business_id = e.business_id and kind = p_kind and is_active
     and (p_template is null or id = p_template)
   order by (id = p_template) desc nulls last, (position_id = e.position_id) desc nulls last,
            (department_id = e.department_id) desc nulls last, is_default desc, created_at
   limit 1;
  if t.id is null then return null; end if;
  v_base := case when p_kind = 'onboarding' then coalesce(e.join_date, private.biz_today(e.business_id))
                 else coalesce(e.exit_date, private.biz_today(e.business_id)) end;
  v_mgr_user := private.user_for_employee(e.business_id, e.manager_id);
  v_emp_user := private.user_for_employee(e.business_id, e.id);
  insert into public.employee_checklists (business_id, employee_id, template_id, kind, trigger_source)
  values (e.business_id, e.id, t.id, p_kind, p_source) returning id into v_id;
  for x in select * from public.checklist_template_tasks where template_id = t.id order by sort loop
    insert into public.employee_checklist_tasks (business_id, checklist_id, employee_id, title, description, assignee_type, assignee_user_id,
                                                 due_date, requires_attachment, sort)
    values (e.business_id, v_id, e.id, x.title, x.description, x.assignee_type,
            case x.assignee_type when 'manager' then v_mgr_user when 'employee' then v_emp_user when 'user' then x.assignee_user_id end,
            v_base + x.due_offset_days, x.requires_attachment, x.sort);
    if x.assignee_type in ('manager', 'employee', 'user') then
      perform private.notify(e.business_id,
        case x.assignee_type when 'manager' then v_mgr_user when 'employee' then v_emp_user else x.assignee_user_id end,
        'onboarding.task_assigned', x.title,
        trim(e.first_name || ' ' || e.last_name) || case when p_kind = 'onboarding' then ' is joining' else ' is leaving' end,
        case when x.assignee_type = 'employee' then '/staff/tasks' else '/app/joiners-leavers/' || v_id end, 'onboarding');
    end if;
  end loop;
  return v_id;
end $$;

-- Joiners get their checklist when they're added; leavers when their status changes to leaving.
create or replace function private.checklists_for_people() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.start_checklist(new.id, 'onboarding', null, 'employee_created');
  elsif new.status in ('resigned', 'terminated') and old.status not in ('resigned', 'terminated') then
    perform public.start_checklist(new.id, 'offboarding', null, 'status_change');
  end if;
  return new;
end $$;
drop trigger if exists checklists_for_people on public.employees;
create trigger checklists_for_people after insert or update of status on public.employees
  for each row execute function private.checklists_for_people();

-- A checklist completes itself when every task is done or skipped.
create or replace function private.after_checklist_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('done', 'skipped') and old.status = 'todo' then
    update public.employee_checklist_tasks set completed_by = auth.uid(), completed_at = now() where id = new.id and completed_at is null;
  end if;
  update public.employee_checklists c set
    status = case when not exists (select 1 from public.employee_checklist_tasks t where t.checklist_id = c.id and t.status = 'todo') then 'completed' else 'in_progress' end,
    completed_at = case when not exists (select 1 from public.employee_checklist_tasks t where t.checklist_id = c.id and t.status = 'todo') then now() end
  where c.id = new.checklist_id and c.status <> 'cancelled';
  return new;
end $$;
drop trigger if exists after_checklist_task on public.employee_checklist_tasks;
create trigger after_checklist_task after update of status on public.employee_checklist_tasks
  for each row execute function private.after_checklist_task();

-- When someone's login is linked to their profile later, their own joiner tasks follow.
create or replace function private.assign_own_tasks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_id is not null and new.status = 'active' then
    update public.employee_checklist_tasks set assignee_user_id = new.user_id
     where employee_id = new.employee_id and assignee_type = 'employee' and assignee_user_id is null and status = 'todo';
  end if;
  return new;
end $$;
drop trigger if exists assign_own_tasks on public.business_members;
create trigger assign_own_tasks after insert or update of employee_id, status on public.business_members
  for each row execute function private.assign_own_tasks();

-- Tasks assigned to the current user, for the staff app.
create or replace function public.my_checklist_tasks(p_business uuid)
returns table (id uuid, title text, description text, due_date date, status text, person text, kind text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select t.id, t.title, t.description, t.due_date, t.status, trim(e.first_name || ' ' || e.last_name), c.kind,
         t.employee_id = private.my_employee_in(p_business)
    from public.employee_checklist_tasks t
    join public.employee_checklists c on c.id = t.checklist_id and c.status = 'in_progress'
    join public.employees e on e.id = t.employee_id
   where t.business_id = p_business and t.assignee_user_id = auth.uid()
   order by t.status <> 'todo', t.due_date nulls last, t.sort
$$;

-- ---------------------------------------------------------------------
-- Permits & renewals: daily reminders
-- ---------------------------------------------------------------------
-- Run once a day by the server. For each item, sends one reminder per
-- threshold (e.g. 90, 60, 30, 7 days before) to the people who look after
-- permits, and to the person if the type says so. Returns how many were sent.
create or replace function public.send_compliance_reminders()
returns int
language plpgsql security definer set search_path = '' as $$
declare
  i record;
  d int;
  u uuid;
  v_n int := 0;
  v_days int;
begin
  for i in select ci.*, ct.name as type_name, ct.remind_days_before, ct.notify_employee, trim(e.first_name || ' ' || e.last_name) as person
             from public.compliance_items ci
             join public.compliance_types ct on ct.id = ci.type_id and ct.is_active
             join public.employees e on e.id = ci.employee_id and e.status not in ('resigned', 'terminated')
            where not ci.is_archived and ci.expires_on is not null and ci.renewal_status not in ('renewed', 'not_renewing')
              and exists (select 1 from public.business_modules bm where bm.business_id = ci.business_id and bm.module_key = 'compliance' and bm.enabled) loop
    v_days := i.expires_on - private.biz_today(i.business_id);
    -- The smallest threshold we've reached that hasn't been sent yet.
    select min(x) into d from unnest(i.remind_days_before) x
     where v_days <= x and not exists (select 1 from public.compliance_reminders r where r.item_id = i.id and r.days_before = x);
    continue when d is null;
    insert into public.compliance_reminders (business_id, item_id, days_before) select i.business_id, i.id, x
      from unnest(i.remind_days_before) x where x >= d on conflict do nothing;
    for u in select * from private.members_with(i.business_id, 'compliance', 'view') loop
      perform private.notify(i.business_id, u, 'compliance.expiring',
        i.type_name || ' for ' || i.person || case when v_days < 0 then ' has expired' when v_days = 0 then ' expires today' else ' expires in ' || v_days || ' days' end,
        'Expires ' || to_char(i.expires_on, 'DD Mon YYYY'), '/app/permits', 'compliance');
    end loop;
    if i.notify_employee then
      perform private.notify(i.business_id, private.user_for_employee(i.business_id, i.employee_id), 'compliance.expiring',
        'Your ' || lower(i.type_name) || case when v_days < 0 then ' has expired' else ' expires in ' || v_days || ' days' end,
        'Speak to HR about renewing it.', '/staff/me', 'compliance');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.submit_application(text, uuid, text, text, text, text, text) from public;
revoke all on function public.hire_candidate(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text) from public, anon;
revoke all on function public.start_checklist(uuid, text, uuid, text) from public, anon;
revoke all on function public.my_checklist_tasks(uuid) from public, anon;
revoke all on function public.send_compliance_reminders() from public, anon, authenticated;
grant execute on function public.submit_application(text, uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.hire_candidate(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.start_checklist(uuid, text, uuid, text) to authenticated;
grant execute on function public.my_checklist_tasks(uuid) to authenticated;
grant execute on function public.send_compliance_reminders() to service_role;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
