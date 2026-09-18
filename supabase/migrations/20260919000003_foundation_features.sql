-- =====================================================================
-- 0009 FOUNDATION FEATURES
--   * Requests engine: who approves what, step by step, with delegation
--   * Notifications written by the database (respecting preferences)
--   * Letter requests from staff
--   * Starter letter templates
-- =====================================================================

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
-- Adds an in-app notification unless the person switched that event off.
create or replace function private.notify(
  p_business uuid, p_user uuid, p_event text, p_title text, p_body text default null,
  p_link text default null, p_module text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_user is null then return null; end if;
  if not exists (select 1 from public.business_members m where m.business_id = p_business and m.user_id = p_user and m.status = 'active') then
    return null;
  end if;
  if exists (select 1 from public.notification_preferences np
              where np.business_id = p_business and np.user_id = p_user and np.event_type = p_event
                and np.channel = 'in_app' and not np.enabled) then
    return null;
  end if;
  insert into public.notifications (business_id, user_id, event_type, module_key, title, body, link)
  values (p_business, p_user, p_event, p_module, p_title, p_body, p_link)
  returning id into v_id;
  return v_id;
end $$;

-- Everyone who should hear about a step: the named approver, or every active member of the role.
create or replace function private.step_recipients(p_step public.approval_request_steps)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p_step.approver_user_id where p_step.approver_user_id is not null
  union
  select m.user_id from public.business_members m
   where p_step.approver_role_id is not null and m.role_id = p_step.approver_role_id and m.status = 'active'
$$;

-- ---------------------------------------------------------------------
-- Approver resolution
-- ---------------------------------------------------------------------
create or replace function private.user_for_employee(p_business uuid, p_employee uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.business_members m
   where m.business_id = p_business and m.employee_id = p_employee and m.status = 'active'
$$;

create or replace function private.resolve_step_approver(p_business uuid, p_employee uuid, s public.approval_workflow_steps)
returns table (user_id uuid, role_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mgr uuid;
begin
  if s.approver_type = 'direct_manager' then
    select e.manager_id into v_mgr from public.employees e where e.id = p_employee;
    return query select private.user_for_employee(p_business, v_mgr), null::uuid;
  elsif s.approver_type = 'manager_of_manager' then
    select m.manager_id into v_mgr from public.employees e join public.employees m on m.id = e.manager_id where e.id = p_employee;
    return query select private.user_for_employee(p_business, v_mgr), null::uuid;
  elsif s.approver_type = 'department_head' then
    select d.head_employee_id into v_mgr from public.employees e join public.departments d on d.id = e.department_id where e.id = p_employee;
    return query select private.user_for_employee(p_business, v_mgr), null::uuid;
  elsif s.approver_type = 'role' then
    return query select null::uuid, s.approver_role_id;
  else
    return query select m.user_id, null::uuid from public.business_members m
      where m.business_id = p_business and m.user_id = s.approver_user_id and m.status = 'active';
  end if;
end $$;

-- Creates a request and its approval steps. Called by the functions that
-- create the underlying item (letter request, time off, claim...).
create or replace function private.create_request(
  p_business uuid, p_type text, p_module text, p_source_table text, p_source_id uuid,
  p_employee uuid, p_title text, p_summary text, p_amount numeric default null, p_meta jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  wf public.approval_workflows;
  s public.approval_workflow_steps;
  v_req uuid;
  v_user uuid;
  v_role uuid;
  v_n int := 0;
  v_requester uuid := auth.uid();
  v_fallback uuid;
  st public.approval_request_steps;
  r uuid;
begin
  select * into wf from public.approval_workflows w
   where w.business_id = p_business and w.request_type = p_type and w.is_active
     and (w.min_amount is null or coalesce(p_amount, 0) >= w.min_amount)
   order by coalesce(w.min_amount, 0) desc, w.created_at
   limit 1;

  insert into public.approval_requests (business_id, request_type, module_key, source_table, source_id, employee_id,
                                        requested_by, workflow_id, title, summary, amount, meta)
  values (p_business, p_type, p_module, p_source_table, p_source_id, p_employee, v_requester, wf.id, p_title, p_summary, p_amount, coalesce(p_meta, '{}'::jsonb))
  returning id into v_req;

  if wf.id is not null then
    for s in select * from public.approval_workflow_steps x where x.workflow_id = wf.id order by x.step_order loop
      continue when s.min_amount is not null and coalesce(p_amount, 0) < s.min_amount;
      select a.user_id, a.role_id into v_user, v_role from private.resolve_step_approver(p_business, p_employee, s) a;
      continue when v_user is null and v_role is null;
      continue when v_user is not null and v_user = v_requester;  -- nobody approves their own request
      v_n := v_n + 1;
      insert into public.approval_request_steps (business_id, request_id, step_order, approver_user_id, approver_role_id, status)
      values (p_business, v_req, v_n, v_user, v_role, case when v_n = 1 then 'pending' else 'waiting' end);
    end loop;
  else
    -- Default chain: the person's manager.
    select e.manager_id into v_fallback from public.employees e where e.id = p_employee;
    v_user := private.user_for_employee(p_business, v_fallback);
    if v_user is not null and v_user is distinct from v_requester then
      v_n := 1;
      insert into public.approval_request_steps (business_id, request_id, step_order, approver_user_id, status)
      values (p_business, v_req, 1, v_user, 'pending');
    end if;
  end if;

  -- Nobody found: HR managers decide, or the owner if there's no HR role.
  if v_n = 0 then
    select r2.id into v_role from public.roles r2 where r2.business_id = p_business and r2.key = 'hr_manager'
      and exists (select 1 from public.business_members m where m.role_id = r2.id and m.status = 'active' and m.user_id is distinct from v_requester);
    if v_role is null then
      select r2.id into v_role from public.roles r2 where r2.business_id = p_business and r2.is_owner;
    end if;
    insert into public.approval_request_steps (business_id, request_id, step_order, approver_role_id, status)
    values (p_business, v_req, 1, v_role, 'pending');
  end if;

  select * into st from public.approval_request_steps where request_id = v_req and step_order = 1;
  for r in select * from private.step_recipients(st) loop
    continue when r = v_requester;
    perform private.notify(p_business, r, 'approval.requested', p_title, p_summary, '/app/requests', p_module);
  end loop;
  return v_req;
end $$;

-- Writes the decision back onto the item that was requested.
create or replace function private.apply_request_outcome(p_req public.approval_requests, p_status text, p_by uuid, p_comment text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_req.source_table in ('letter_requests', 'leave_requests', 'claims', 'attendance_corrections') then
    execute format(
      'update public.%I set status = $1, decided_by = $2, decided_at = now(), decision_comment = $3 where id = $4 and business_id = $5',
      p_req.source_table)
    using p_status, p_by, p_comment, p_req.source_id, p_req.business_id;
  elsif p_req.source_table = 'timesheets' then
    update public.timesheets set status = p_status, approved_by = p_by, approved_at = now(), comment = p_comment
     where id = p_req.source_id and business_id = p_req.business_id;
  elsif p_req.source_table = 'training_sponsorships' then
    update public.training_sponsorships set status = p_status, approved_by = p_by, approved_at = now()
     where id = p_req.source_id and business_id = p_req.business_id;
  end if;
end $$;

-- Is this step assigned to the current user (named approver, role member, or stand-in)?
create or replace function private.is_assigned(p_req public.approval_requests, p_step public.approval_request_steps)
returns boolean
language sql stable security definer set search_path = '' as $$
  -- Every part is coalesced: a null (e.g. no role on the step) must mean "no", never "unknown".
  select coalesce(p_step.approver_user_id = auth.uid(), false)
    or coalesce(p_step.approver_role_id in (select m.role_id from public.business_members m
                                            where m.business_id = p_req.business_id and m.user_id = auth.uid() and m.status = 'active'), false)
    or exists (select 1 from public.approval_delegations d
                where d.business_id = p_req.business_id and d.delegate_user_id = auth.uid()
                  and d.delegator_user_id = p_step.approver_user_id and d.revoked_at is null
                  and now() between d.starts_at and d.ends_at
                  and (d.request_types is null or p_req.request_type = any(d.request_types)))
$$;

-- May the current user decide this step? Assigned people, plus anyone with "approve all" rights (they can step in).
create or replace function private.can_decide(p_req public.approval_requests, p_step public.approval_request_steps)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_assigned(p_req, p_step), false)
      or coalesce(p_req.business_id in (select private.biz_all('approvals', 'approve')), false)
$$;

-- ---------------------------------------------------------------------
-- Deciding and cancelling requests (called from the Requests screen)
-- ---------------------------------------------------------------------
create or replace function public.decide_request(p_request uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  req public.approval_requests;
  st public.approval_request_steps;
  nxt public.approval_request_steps;
  r uuid;
  v_uid uuid := auth.uid();
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or decline' using errcode = '22023';
  end if;
  select * into req from public.approval_requests where id = p_request for update;
  if not found or req.business_id not in (select private.my_business_ids()) then
    raise exception 'Request not found' using errcode = '22023';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been %', req.status using errcode = '22023';
  end if;
  if req.requested_by = v_uid and not private.is_owner(req.business_id) then
    raise exception 'You can''t decide your own request' using errcode = '42501';
  end if;
  select * into st from public.approval_request_steps where request_id = req.id and status = 'pending' order by step_order limit 1;
  if not found or not coalesce(private.can_decide(req, st), false) then
    raise exception 'This request isn''t waiting for you' using errcode = '42501';
  end if;
  if p_decision = 'reject' and coalesce(trim(p_comment), '') = '' then
    raise exception 'Add a short note so they know why' using errcode = '22023';
  end if;

  update public.approval_request_steps
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         acted_by = v_uid, acted_at = now(), comment = nullif(trim(p_comment), ''),
         delegated_from = case when approver_user_id is not null and approver_user_id <> v_uid then approver_user_id end
   where id = st.id;

  if p_decision = 'reject' then
    update public.approval_request_steps set status = 'skipped' where request_id = req.id and status = 'waiting';
    update public.approval_requests set status = 'rejected', decided_at = now() where id = req.id;
    perform private.apply_request_outcome(req, 'rejected', v_uid, nullif(trim(p_comment), ''));
    perform private.notify(req.business_id, req.requested_by, 'approval.decided', 'Declined: ' || req.title, p_comment, '/staff/requests', req.module_key);
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into nxt from public.approval_request_steps where request_id = req.id and status = 'waiting' order by step_order limit 1;
  if found then
    update public.approval_request_steps set status = 'pending' where id = nxt.id;
    update public.approval_requests set current_step = nxt.step_order where id = req.id;
    for r in select * from private.step_recipients(nxt) loop
      perform private.notify(req.business_id, r, 'approval.requested', req.title, req.summary, '/app/requests', req.module_key);
    end loop;
    return jsonb_build_object('status', 'pending', 'next_step', nxt.step_order);
  end if;

  update public.approval_requests set status = 'approved', decided_at = now() where id = req.id;
  perform private.apply_request_outcome(req, 'approved', v_uid, nullif(trim(p_comment), ''));
  perform private.notify(req.business_id, req.requested_by, 'approval.decided', 'Approved: ' || req.title, p_comment, '/staff/requests', req.module_key);
  return jsonb_build_object('status', 'approved');
end $$;

create or replace function public.cancel_request(p_request uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  req public.approval_requests;
begin
  select * into req from public.approval_requests where id = p_request for update;
  if not found or req.requested_by is distinct from auth.uid() then
    raise exception 'Only the person who asked can cancel this request' using errcode = '42501';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been %', req.status using errcode = '22023';
  end if;
  update public.approval_requests set status = 'cancelled', decided_at = now() where id = req.id;
  update public.approval_request_steps set status = 'skipped' where request_id = req.id and status in ('pending', 'waiting');
  perform private.apply_request_outcome(req, 'cancelled', auth.uid(), null);
end $$;

-- Requests waiting for the current user, with the details the inbox shows.
create or replace function public.my_request_inbox(p_business uuid)
returns table (
  id uuid, request_type text, module_key text, title text, summary text, amount numeric, submitted_at timestamptz,
  employee_id uuid, employee_name text, requested_by_name text, step_order smallint, total_steps int, via text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.request_type, r.module_key, r.title, r.summary, r.amount, r.submitted_at,
         r.employee_id, trim(e.first_name || ' ' || e.last_name), p.full_name, s.step_order,
         (select count(*)::int from public.approval_request_steps x where x.request_id = r.id),
         case when s.approver_user_id = auth.uid() then 'you'
              when s.approver_role_id is not null then 'role'
              when s.approver_user_id is not null and s.approver_user_id <> auth.uid()
                   and exists (select 1 from public.approval_delegations d where d.delegate_user_id = auth.uid()
                                and d.delegator_user_id = s.approver_user_id and d.revoked_at is null
                                and now() between d.starts_at and d.ends_at) then 'stand-in'
              else 'admin' end
    from public.approval_requests r
    join public.approval_request_steps s on s.request_id = r.id and s.status = 'pending'
    left join public.employees e on e.id = r.employee_id
    left join public.profiles p on p.id = r.requested_by
   where r.business_id = p_business and r.status = 'pending'
     and p_business in (select private.my_business_ids())
     and (r.requested_by is distinct from auth.uid() or private.is_owner(p_business))
     and private.is_assigned(r, s)
   order by r.submitted_at
$$;

revoke all on function public.decide_request(uuid, text, text) from public, anon;
revoke all on function public.cancel_request(uuid) from public, anon;
revoke all on function public.my_request_inbox(uuid) from public, anon;
grant execute on function public.decide_request(uuid, text, text) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;
grant execute on function public.my_request_inbox(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Letter requests (staff ask for a letter; HR issues it)
-- ---------------------------------------------------------------------
create or replace function public.request_letter(p_business uuid, p_template uuid, p_purpose text, p_addressed_to text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid;
  v_id uuid;
  v_name text;
  v_tpl text;
begin
  select m.employee_id into v_emp from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active';
  if v_emp is null then
    raise exception 'Your login isn''t linked to a profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  select t.name into v_tpl from public.letter_templates t
   where t.id = p_template and t.business_id = p_business and t.is_active and t.requestable_by_staff;
  if v_tpl is null then
    raise exception 'That letter can''t be requested' using errcode = '22023';
  end if;
  if coalesce(trim(p_purpose), '') = '' then
    raise exception 'Say what the letter is for' using errcode = '22023';
  end if;
  insert into public.letter_requests (business_id, employee_id, template_id, purpose, addressed_to)
  values (p_business, v_emp, p_template, trim(p_purpose), nullif(trim(p_addressed_to), ''))
  returning id into v_id;
  select trim(e.first_name || ' ' || e.last_name) into v_name from public.employees e where e.id = v_emp;
  perform private.create_request(p_business, 'letter_request', 'documents', 'letter_requests', v_id, v_emp,
                                 v_tpl || ' for ' || v_name, trim(p_purpose), null, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.request_letter(uuid, uuid, text, text) from public, anon;
grant execute on function public.request_letter(uuid, uuid, text, text) to authenticated;

-- Next free employee ID (E0001, E0002…), for people with rights to add people.
create or replace function public.suggest_employee_code(p_business uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_business not in (select private.biz_all('employees', 'create')) then
    raise exception 'You don''t have permission to add people' using errcode = '42501';
  end if;
  return private.next_employee_code(p_business);
end $$;
revoke all on function public.suggest_employee_code(uuid) from public, anon;
grant execute on function public.suggest_employee_code(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Starter letter templates (added with the other starter data)
-- ---------------------------------------------------------------------
create or replace function private.seed_letter_templates(p_business uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.letter_templates where business_id = p_business) then return; end if;
  insert into public.letter_templates (business_id, name, kind, subject, body, include_signature, include_stamp, requestable_by_staff) values
  (p_business, 'Employment certificate', 'employment_certificate', 'To whom it may concern',
   E'This is to certify that {{employee.full_name}} (ID {{employee.code}}) has been employed by {{company.name}} since {{employee.join_date}}.\n\n{{employee.first_name}} currently works as {{employee.position}} in our {{employee.department}} department.\n\nThis letter is issued at the request of the employee.',
   true, true, true),
  (p_business, 'Salary certificate', 'salary_certificate', 'To whom it may concern',
   E'This is to certify that {{employee.full_name}} (ID {{employee.code}}) works with {{company.name}} as {{employee.position}}, and has done since {{employee.join_date}}.\n\n{{employee.first_name}}''s current basic monthly salary is {{employee.salary}}.\n\nThis letter is issued at the request of the employee for {{letter.purpose}}.',
   true, true, true),
  (p_business, 'Experience letter', 'experience', 'To whom it may concern',
   E'{{employee.full_name}} worked with {{company.name}} from {{employee.join_date}} to {{employee.exit_date}} as {{employee.position}}.\n\nDuring this time {{employee.first_name}} carried out their duties to our satisfaction. We wish them well.',
   true, true, false),
  (p_business, 'No objection letter', 'noc', 'No objection',
   E'{{company.name}} has no objection to {{employee.full_name}} (passport {{employee.passport_no}}), our {{employee.position}}, for the following purpose: {{letter.purpose}}.\n\nThis letter does not change the terms of {{employee.first_name}}''s employment.',
   true, true, true),
  (p_business, 'Warning letter', 'warning', 'Written warning',
   E'Dear {{employee.first_name}},\n\nThis letter is a formal written warning about the following: {{letter.purpose}}.\n\nPlease speak with your manager if you would like to discuss this. A copy of this letter will be kept in your file.',
   true, false, false);
end $$;

-- Hook the letter templates into the starter data for the always-on Letters & files tool.
create or replace function private.seed_foundation(p_business uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_letter_templates(p_business);
end $$;

-- Existing companies get the starter templates now.
do $$
declare b record;
begin
  for b in select id from public.businesses loop
    perform private.seed_letter_templates(b.id);
  end loop;
end $$;

-- New companies get them the first time tools are saved (the documents tool is always on).
create or replace function private.after_modules_saved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.module_key = 'documents' then
    perform private.seed_letter_templates(new.business_id);
  end if;
  return new;
end $$;
create trigger seed_foundation_after_modules after insert on public.business_modules
  for each row execute function private.after_modules_saved();

-- ---------------------------------------------------------------------
-- Stand-ins: anyone may hand their approvals to an active colleague.
-- (The earlier check could only "see" colleagues the person was allowed to list.)
-- ---------------------------------------------------------------------
create or replace function private.is_active_member(p_business uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members m where m.business_id = p_business and m.user_id = p_user and m.status = 'active')
$$;

drop policy if exists tenant_insert on public.approval_delegations;
create policy tenant_insert on public.approval_delegations for insert to authenticated
  with check (business_id in (select private.my_business_ids())
              and (delegator_user_id = auth.uid() or business_id in (select private.biz_all('approvals', 'edit')))
              and private.is_active_member(business_id, delegate_user_id)
              and private.is_active_member(business_id, delegator_user_id));


-- ---------------------------------------------------------------------
-- Event notifications written by the database, so they happen however
-- the change was made.
-- ---------------------------------------------------------------------
-- Members whose role lets them see a resource for the whole company (owners always).
create or replace function private.members_with(p_business uuid, p_resource text, p_action text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.business_members m join public.roles r on r.id = m.role_id
   where m.business_id = p_business and m.status = 'active'
     and (r.is_owner or exists (select 1 from public.role_permissions rp
                                 where rp.role_id = r.id and rp.resource = p_resource and rp.action = p_action and rp.scope = 'all'))
$$;

create or replace function private.after_letter_issued() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    select lower(t.name) into v_name from public.letter_templates t where t.id = new.template_id;
    perform private.notify(new.business_id, private.user_for_employee(new.business_id, new.employee_id), 'letter.ready',
      'Your ' || coalesce(v_name, 'letter') || ' is ready', 'You can download it from your files.', '/staff/files', 'documents');
  end if;
  return new;
end $$;
drop trigger if exists letter_issued_notify on public.letter_requests;
create trigger letter_issued_notify after update on public.letter_requests
  for each row execute function private.after_letter_issued();

create or replace function private.after_announcement_published() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if new.published_at is not null and new.published_at <= now()
     and (tg_op = 'INSERT' or old.published_at is null or old.published_at > now()) then
    for u in select m.user_id from public.business_members m
              left join public.employees e on e.id = m.employee_id
             where m.business_id = new.business_id and m.status = 'active'
               and m.user_id is distinct from new.created_by
               and (new.branch_id is null or e.branch_id = new.branch_id or m.employee_id is null)
               and (new.department_id is null or e.department_id = new.department_id or m.employee_id is null) loop
      perform private.notify(new.business_id, u, 'announcement.published', new.title, left(new.body, 200), '/staff', 'portal');
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists announcement_notify on public.announcements;
create trigger announcement_notify after insert or update of published_at on public.announcements
  for each row execute function private.after_announcement_published();

create or replace function private.after_employee_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  for u in select * from private.members_with(new.business_id, 'employees', 'view') loop
    if u is distinct from auth.uid() then
      perform private.notify(new.business_id, u, 'employee.created',
        trim(new.first_name || ' ' || new.last_name) || ' was added', null, '/app/people/' || new.id, 'employees');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists employee_created_notify on public.employees;
create trigger employee_created_notify after insert on public.employees
  for each row execute function private.after_employee_created();

-- Each notification is emailed (or texted) at most once, even if two senders run at the same time.
create unique index if not exists notification_deliveries_once
  on public.notification_deliveries (notification_id, channel) where notification_id is not null;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
