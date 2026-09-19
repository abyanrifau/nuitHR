-- =====================================================================
-- 0017 SECURITY HARDENING (pre-launch review)
--   1. Only an owner can hand out roles that see other people's pay, and
--      nobody but an owner can re-link their own login to another profile.
--   2. Joiner/leaver checklists can only be started by people allowed to.
--   3. Clock-in records and timesheets can't be written by staff directly
--      (they go through clock_in / clock_out / time fix requests).
--   4. Course progress can't be written by learners directly
--      (it goes through complete_lesson / submit_quiz).
--   5. Staff don't see their manager's rating or notes before sharing.
--   6. Anonymous survey answers can't be matched to who replied.
--   7. Files HR hid from someone can't be downloaded by them.
--   8. Logos, signatures and stamps must sit in the company's own folder.
--   9. The careers form can't overwrite an existing applicant's details.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Roles and logins
-- ---------------------------------------------------------------------
-- A role that can see other people's pay, or change roles, is the owner's to give.
create or replace function private.role_is_sensitive(p_role uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_permissions rp
     where rp.role_id = p_role
       and ((rp.resource in ('compensation', 'payroll', 'payslips') and rp.scope in ('team', 'all'))
            or (rp.resource = 'roles' and rp.action in ('create', 'edit', 'delete')))
  )
$$;

create or replace function private.guard_business_members() returns trigger
language plpgsql as $$
declare
  v_bid uuid := coalesce(new.business_id, old.business_id);
  v_new_owner boolean := tg_op <> 'DELETE' and private.role_is_owner(new.role_id);
  v_old_owner boolean := tg_op <> 'INSERT' and private.role_is_owner(old.role_id);
  v_is_owner boolean;
begin
  -- The last-owner rule applies everywhere, including trusted server code.
  if v_old_owner
     and (tg_op = 'DELETE' or not v_new_owner or new.status <> 'active')
     and not private.other_active_owner_exists(v_bid, old.id)
     and exists (select 1 from public.businesses b where b.id = v_bid) then
    raise exception 'A business must always have at least one active owner' using errcode = '42501';
  end if;

  if not private.is_client_context() then return coalesce(new, old); end if;
  v_is_owner := private.is_owner(v_bid);

  if (v_new_owner or v_old_owner) and not v_is_owner then
    raise exception 'Only an owner can add, change or remove an owner' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.user_id = auth.uid() and new.role_id <> old.role_id and not v_is_owner then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'A membership cannot be moved to another user' using errcode = '42501';
  end if;
  -- Your own login stays linked to your own profile; only an owner can change that.
  if tg_op = 'UPDATE' and old.user_id = auth.uid() and new.employee_id is distinct from old.employee_id and not v_is_owner then
    raise exception 'Ask an owner to change which profile your login is linked to' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and not v_is_owner and private.role_is_sensitive(new.role_id)
     and (tg_op = 'INSERT' or new.role_id <> old.role_id) then
    raise exception 'Only an owner can give someone a role that sees pay or changes roles' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create or replace function private.guard_invitations() returns trigger
language plpgsql as $$
begin
  if private.is_client_context() and not private.is_owner(new.business_id) then
    if private.role_is_owner(new.role_id) then
      raise exception 'Only an owner can invite another owner' using errcode = '42501';
    end if;
    if private.role_is_sensitive(new.role_id) then
      raise exception 'Only an owner can invite someone with a role that sees pay or changes roles' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Checklists
-- ---------------------------------------------------------------------
-- The existing function becomes the internal one used by the system
-- (new people, leavers, hiring). The public one checks permission.
alter function public.start_checklist(uuid, text, uuid, text) rename to start_checklist_core;
alter function public.start_checklist_core(uuid, text, uuid, text) set schema private;
revoke all on function private.start_checklist_core(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public.start_checklist(p_employee uuid, p_kind text, p_template uuid default null, p_source text default 'manual')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_bid uuid;
begin
  select business_id into v_bid from public.employees where id = p_employee;
  if v_bid is null or not private.can_emp('onboarding', 'create', v_bid, p_employee) then
    raise exception 'You don''t have permission to start checklists' using errcode = '42501';
  end if;
  return private.start_checklist_core(p_employee, p_kind, p_template, 'manual');
end $$;
revoke all on function public.start_checklist(uuid, text, uuid, text) from public, anon;
grant execute on function public.start_checklist(uuid, text, uuid, text) to authenticated;

create or replace function private.checklists_for_people() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.join_date is null or new.join_date >= private.biz_today(new.business_id) - 30 then
      perform private.start_checklist_core(new.id, 'onboarding', null, 'employee_created');
    end if;
  elsif new.status in ('resigned', 'terminated') and old.status not in ('resigned', 'terminated') then
    perform private.start_checklist_core(new.id, 'offboarding', null, 'status_change');
  end if;
  return new;
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.hire_candidate(uuid, date, text, uuid, uuid, uuid, uuid, numeric, text)'::regprocedure);
  d := replace(d, 'public.start_checklist(', 'private.start_checklist_core(');
  execute d;
end $$;

-- ---------------------------------------------------------------------
-- 3. Clock-ins and timesheets: HR and managers only (staff use the functions)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['attendance_records', 'attendance_breaks', 'timesheets'] loop
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format($p$create policy tenant_insert on public.%I for insert to authenticated
      with check (business_id in (select private.biz_all('attendance', 'create'))
                  or employee_id in (select private.team_scope('attendance', 'create')))$p$, t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format($p$create policy tenant_update on public.%I for update to authenticated
      using (business_id in (select private.biz_all('attendance', 'edit')) or employee_id in (select private.team_scope('attendance', 'edit')))
      with check (business_id in (select private.biz_all('attendance', 'edit')) or employee_id in (select private.team_scope('attendance', 'edit')))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Course progress: HR and managers only (learners use the functions)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['course_enrollments', 'lesson_progress'] loop
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format($p$create policy tenant_insert on public.%I for insert to authenticated
      with check (business_id in (select private.biz_all('training', 'create'))
                  or employee_id in (select private.team_scope('training', 'create')))$p$, t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format($p$create policy tenant_update on public.%I for update to authenticated
      using (business_id in (select private.biz_all('training', 'edit')) or employee_id in (select private.team_scope('training', 'edit')))
      with check (business_id in (select private.biz_all('training', 'edit')) or employee_id in (select private.team_scope('training', 'edit')))$p$, t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format($p$create policy tenant_delete on public.%I for delete to authenticated
      using (business_id in (select private.biz_all('training', 'delete')) or employee_id in (select private.team_scope('training', 'delete')))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Reviews: your own review row is readable once shared; before that the
--    staff app reads it through my_reviews(), which leaves out the manager's part.
-- ---------------------------------------------------------------------
drop policy if exists tenant_select on public.reviews;
create policy tenant_select on public.reviews for select to authenticated
  using (business_id in (select private.biz_all('reviews', 'view'))
         or employee_id in (select private.team_scope('reviews', 'view'))
         or (employee_id in (select private.self_scope('reviews', 'view')) and status in ('shared', 'acknowledged')));

create or replace function public.my_reviews(p_business uuid)
returns table (
  id uuid, business_id uuid, status text, employee_id uuid, reviewer_employee_id uuid,
  self_submitted_at timestamptz, shared_at timestamptz, acknowledged_at timestamptz, employee_comment text,
  overall_rating numeric, manager_summary text, meeting_notes text,
  cycle_id uuid, cycle_name text, cycle_status text, period_start date, period_end date,
  self_review_due date, template_id uuid, rating_scale jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.business_id, r.status, r.employee_id, r.reviewer_employee_id,
         r.self_submitted_at, r.shared_at, r.acknowledged_at, r.employee_comment,
         case when r.status in ('shared', 'acknowledged') then r.overall_rating end,
         case when r.status in ('shared', 'acknowledged') then r.manager_summary end,
         case when r.status in ('shared', 'acknowledged') then r.meeting_notes end,
         c.id, c.name, c.status, c.period_start, c.period_end, c.self_review_due, c.template_id, t.rating_scale, r.created_at
    from public.reviews r
    join public.review_cycles c on c.id = r.cycle_id
    join public.review_templates t on t.id = c.template_id
   where r.business_id = p_business
     and r.employee_id = private.my_employee_in(p_business)
   order by r.created_at desc
$$;
revoke all on function public.my_reviews(uuid) from public, anon;
grant execute on function public.my_reviews(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Surveys: answers are only read through survey_results() for anonymous
--    surveys, and the response time no longer matches who replied when.
-- ---------------------------------------------------------------------
drop policy if exists tenant_select on public.survey_responses;
create policy tenant_select on public.survey_responses for select to authenticated
  using (business_id in (select private.biz_all('surveys', 'view'))
         and survey_id in (select s.id from public.surveys s where not s.is_anonymous));
drop policy if exists tenant_select on public.survey_answers;
create policy tenant_select on public.survey_answers for select to authenticated
  using (business_id in (select private.biz_all('surveys', 'view'))
         and response_id in (select r.id from public.survey_responses r
                              join public.surveys s on s.id = r.survey_id where not s.is_anonymous));

-- Answers keep only the day they came in.
create or replace function private.blur_survey_response_time() returns trigger
language plpgsql as $$
begin
  new.submitted_at := date_trunc('day', new.submitted_at);
  return new;
end $$;
drop trigger if exists blur_survey_response_time on public.survey_responses;
create trigger blur_survey_response_time before insert or update of submitted_at on public.survey_responses
  for each row execute function private.blur_survey_response_time();
update public.survey_responses set submitted_at = date_trunc('day', submitted_at) where submitted_at <> date_trunc('day', submitted_at);

-- ---------------------------------------------------------------------
-- 7. Storage: staff only download their own documents that HR made visible to them
-- ---------------------------------------------------------------------
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
    when 'transport', 'expenses', 'claims' then v_resource := 'claims';
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

  if v_bid in (select private.biz_all(v_resource, p_action)) or v_emp in (select private.team_scope(v_resource, p_action)) then
    return true;
  end if;
  if v_emp not in (select private.self_scope(v_resource, p_action)) then
    return false;
  end if;
  -- Your own documents: only the ones HR marked as visible to you.
  if v_area = 'documents' and p_action = 'view' then
    return exists (select 1 from public.employee_documents d
                    where d.business_id = v_bid and d.employee_id = v_emp and d.file_path = p_name and d.visible_to_employee);
  end if;
  -- Staff upload their own attachments for requests they're allowed to make.
  return true;
end $$;

-- ---------------------------------------------------------------------
-- 8. Company images must be in the company's own branding folder
-- ---------------------------------------------------------------------
create or replace function private.guard_business_images() returns trigger
language plpgsql as $$
begin
  if (new.logo_path is not null and new.logo_path not like new.id::text || '/branding/%')
     or (new.signature_path is not null and new.signature_path not like new.id::text || '/branding/%')
     or (new.stamp_path is not null and new.stamp_path not like new.id::text || '/branding/%') then
    raise exception 'Company images must be uploaded to the company''s own folder' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists guard_business_images on public.businesses;
create trigger guard_business_images before insert or update of logo_path, signature_path, stamp_path on public.businesses
  for each row execute function private.guard_business_images();

-- ---------------------------------------------------------------------
-- 9. Careers form: an existing applicant's details are only filled in, never replaced
-- ---------------------------------------------------------------------
do $$
declare d text;
begin
  d := pg_get_functiondef('public.submit_application(text, uuid, text, text, text, text, text)'::regprocedure);
  d := replace(d,
    'update public.candidates set full_name = trim(p_full_name), phone = coalesce(nullif(trim(left(p_phone, 40)), ''''), phone),
      cv_path = coalesce(p_cv_path, cv_path) where id = v_cand;',
    'update public.candidates set phone = coalesce(phone, nullif(trim(left(p_phone, 40)), '''')),
      cv_path = coalesce(cv_path, p_cv_path) where id = v_cand;');
  if d not like '%coalesce(cv_path, p_cv_path)%' then
    raise exception 'submit_application did not match the expected text';
  end if;
  -- At most 5 applications a day from one email address to one company.
  d := replace(d,
    '  if exists (select 1 from public.applications where vacancy_id = v.id and candidate_id = v_cand) then',
    '  if (select count(*) from public.applications a where a.candidate_id = v_cand and a.applied_at > now() - interval ''1 day'') >= 5 then
    raise exception ''You''''ve sent a lot of applications today. Please try again tomorrow.'' using errcode = ''22023'';
  end if;
  if exists (select 1 from public.applications where vacancy_id = v.id and candidate_id = v_cand) then');
  if d not like '%sent a lot of applications%' then
    raise exception 'submit_application did not match the expected text (daily limit)';
  end if;
  execute d;
end $$;

grant execute on all functions in schema private to authenticated, service_role;
revoke all on function private.start_checklist_core(uuid, text, uuid, text) from public, anon, authenticated;

call private.finalize_tenant_tables();
