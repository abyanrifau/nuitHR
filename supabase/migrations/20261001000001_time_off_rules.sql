-- =====================================================================
-- 0032 TIME OFF RULES
--   * No more gradual build-up or carry over: each type gives a fixed
--     number of days per leave year, all at the start. The leave year is
--     the calendar year or each person's join anniversary, per type.
--     Balances that already exist are kept exactly as they are.
--   * Rules per type: notice (minutes, hours or days) and requests after
--     the fact; service needed first and probation; who it applies to;
--     minimum, maximum and consecutive days; half days; how many of a team
--     can be off at once; blackout dates; paid or unpaid.
--   * Documents: never, always, or when longer than a number of days, and
--     optionally later with a deadline. Reminders before the deadline; no
--     document by then turns the days into unapproved absences.
--   * Leave granted to particular people (with an expiry), and birthday
--     leave.
--   * A company calendar: events and blackout dates.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rules on each type
-- ---------------------------------------------------------------------
alter table public.leave_types
  add column if not exists entitlement_mode text not null default 'annual'
    check (entitlement_mode in ('annual', 'unlimited', 'granted', 'birthday')),
  add column if not exists year_basis text not null default 'calendar' check (year_basis in ('calendar', 'anniversary')),
  add column if not exists notice_value integer not null default 0 check (notice_value >= 0),
  add column if not exists notice_unit text not null default 'days' check (notice_unit in ('minutes', 'hours', 'days')),
  add column if not exists allow_after_the_fact boolean not null default false,
  add column if not exists eligible_after_value integer not null default 0 check (eligible_after_value >= 0),
  add column if not exists eligible_after_unit text not null default 'months' check (eligible_after_unit in ('days', 'months', 'years')),
  add column if not exists allow_during_probation boolean not null default true,
  add column if not exists applies_to text not null default 'all' check (applies_to in ('all', 'selected')),
  add column if not exists min_days_per_request numeric(6,2) check (min_days_per_request is null or min_days_per_request > 0),
  add column if not exists max_consecutive_days integer check (max_consecutive_days is null or max_consecutive_days > 0),
  add column if not exists max_off_per_department integer check (max_off_per_department is null or max_off_per_department > 0),
  add column if not exists document_rule text not null default 'none' check (document_rule in ('none', 'always', 'over_days')),
  add column if not exists document_over_days numeric(6,2),
  add column if not exists document_later_allowed boolean not null default false,
  add column if not exists document_deadline_days integer not null default 3 check (document_deadline_days between 0 and 60),
  add column if not exists birthday_window text not null default 'month' check (birthday_window in ('month', 'days_after')),
  add column if not exists birthday_window_days integer not null default 30 check (birthday_window_days between 1 and 366);

-- Carry the old settings over.
update public.leave_types set
  entitlement_mode = case when accrual_method = 'none' then 'unlimited' else 'annual' end,
  accrual_method = case when accrual_method = 'none' then 'none' else 'upfront' end,
  carry_forward_max = 0,
  carry_forward_expiry_months = null,
  eligible_after_value = min_service_months,
  eligible_after_unit = 'months',
  document_rule = case when not requires_document then 'none'
                       when coalesce(document_required_after_days, 0) > 0 then 'over_days' else 'always' end,
  document_over_days = case when requires_document and coalesce(document_required_after_days, 0) > 0 then document_required_after_days end;
-- Sick leave is usually reported after the fact, with the certificate a few days later.
update public.leave_types set allow_after_the_fact = true, document_later_allowed = true, document_deadline_days = 3
 where code = 'SL' or name ilike 'sick%';

-- Older setup screens still send the old fields (build-up method, carry
-- over, "needs a document"). Map them onto the new rules and keep both in step.
create or replace function private.leave_type_sync() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.accrual_method = 'none' and new.entitlement_mode = 'annual' then new.entitlement_mode := 'unlimited'; end if;
    if new.requires_document and new.document_rule = 'none' then
      new.document_rule := case when coalesce(new.document_required_after_days, 0) > 0 then 'over_days' else 'always' end;
      new.document_over_days := nullif(new.document_required_after_days, 0);
    end if;
    if new.min_service_months > 0 and new.eligible_after_value = 0 then
      new.eligible_after_value := new.min_service_months;
      new.eligible_after_unit := 'months';
    end if;
    -- Sick leave added by the setup questions: reported after the fact, certificate within 3 days.
    if not private.is_client_context() and new.code = 'SL' then
      new.allow_after_the_fact := true;
      new.document_later_allowed := true;
    end if;
  else
    if new.accrual_method is distinct from old.accrual_method and new.entitlement_mode = old.entitlement_mode then
      new.entitlement_mode := case when new.accrual_method = 'none' then 'unlimited'
                                   when old.entitlement_mode = 'unlimited' then 'annual' else old.entitlement_mode end;
    end if;
    if new.requires_document is distinct from old.requires_document and new.document_rule = old.document_rule then
      new.document_rule := case when new.requires_document then 'always' else 'none' end;
    end if;
  end if;
  new.accrual_method := case when new.entitlement_mode = 'unlimited' then 'none' else 'upfront' end;
  new.carry_forward_max := 0;
  new.carry_forward_expiry_months := null;
  new.requires_document := new.document_rule <> 'none';
  new.document_required_after_days := case when new.document_rule = 'over_days' then new.document_over_days end;
  return new;
end $$;
create trigger leave_type_sync before insert or update on public.leave_types
  for each row execute function private.leave_type_sync();

-- Who a type applies to, when it isn't everyone.
create table public.leave_type_targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  leave_type_id uuid not null,
  target_type text not null check (target_type in ('position', 'department', 'branch', 'employee', 'role')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (leave_type_id, target_type, target_id),
  foreign key (business_id, leave_type_id) references public.leave_types (business_id, id) on delete cascade
);
create index leave_type_targets_type_idx on public.leave_type_targets (business_id, leave_type_id);
call private.std_rls('leave_type_targets', 'leave');

-- Days granted to a person, with a reason and an expiry.
create table public.leave_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  leave_type_id uuid not null,
  days numeric(6,2) not null check (days > 0),
  reason text not null check (length(trim(reason)) > 0),
  starts_on date not null,
  expires_on date,
  granted_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (expires_on is null or expires_on >= starts_on),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, leave_type_id) references public.leave_types (business_id, id) on delete cascade
);
create index leave_allocations_emp_idx on public.leave_allocations (business_id, employee_id, leave_type_id);
create index leave_allocations_type_fk_idx on public.leave_allocations (business_id, leave_type_id);
create index leave_allocations_granted_by_fk_idx on public.leave_allocations (granted_by);
call private.std_rls('leave_allocations', 'leave', 'employee_id');
-- People can see days granted to them, but only HR (time off: edit for everyone) can grant them.
drop policy tenant_insert on public.leave_allocations;
drop policy tenant_update on public.leave_allocations;
drop policy tenant_delete on public.leave_allocations;
create policy tenant_insert on public.leave_allocations for insert to authenticated
  with check (business_id in (select private.biz_all('leave', 'edit')));
create policy tenant_update on public.leave_allocations for update to authenticated
  using (business_id in (select private.biz_all('leave', 'edit'))) with check (business_id in (select private.biz_all('leave', 'edit')));
create policy tenant_delete on public.leave_allocations for delete to authenticated
  using (business_id in (select private.biz_all('leave', 'edit')));
create trigger audit_leave_allocations after insert or update or delete on public.leave_allocations
  for each row execute function private.audit_row('leave', 'employee_id');

-- The company calendar: events, and blackout dates when time off can't be taken.
create table public.company_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'event' check (kind in ('event', 'blackout')),
  start_date date not null,
  end_date date not null,
  branch_id uuid,                      -- null = every location
  leave_type_ids uuid[],               -- blackouts: null = every type
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (end_date >= start_date),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade
);
create index company_events_dates_idx on public.company_events (business_id, start_date, end_date);
create index company_events_branch_fk_idx on public.company_events (business_id, branch_id);
create index company_events_created_by_fk_idx on public.company_events (created_by);
call private.std_rls('company_events', 'leave', null, true);

-- Supporting documents on each request.
alter table public.leave_requests
  add column if not exists document_status text not null default 'not_needed'
    check (document_status in ('not_needed', 'needed', 'uploaded', 'overdue', 'waived')),
  add column if not exists document_due_on date,
  add column if not exists document_reminded_at timestamptz,
  add column if not exists absent_since timestamptz,          -- when missing paperwork turned the days into absences
  add column if not exists document_note text;               -- HR's reason for extending or waiving
update public.leave_requests set document_status = 'uploaded' where attachment_path is not null;
create trigger audit_leave_documents after update of document_status, document_due_on on public.leave_requests
  for each row when (pg_trigger_depth() < 1) execute function private.audit_row('leave', 'employee_id');

-- Balances that exist today stay exactly as they are.
alter table public.leave_balances add column if not exists kept_as_is boolean not null default false;
update public.leave_balances set kept_as_is = true;

-- Days the system marks as absent (missing paperwork).
alter table public.attendance_records drop constraint if exists attendance_records_source_check;
alter table public.attendance_records add constraint attendance_records_source_check
  check (source in ('portal', 'manual', 'import', 'correction', 'system'));

-- ---------------------------------------------------------------------
-- 2. Leave years
-- ---------------------------------------------------------------------
-- The leave year a date falls in for a person and type: its first and
-- last day, and the year it starts in (used to file balances).
create or replace function private.leave_year(p_type uuid, p_employee uuid, p_date date)
returns table (year int, starts date, ends date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_basis text;
  v_join date;
  v_this date;
begin
  select lt.year_basis, lt.entitlement_mode into v_basis from public.leave_types lt where lt.id = p_type;
  select e.join_date into v_join from public.employees e where e.id = p_employee;
  if coalesce(v_basis, 'calendar') = 'calendar' or v_join is null then
    starts := make_date(extract(year from p_date)::int, 1, 1);
  else
    -- 29 February joiners have their anniversary on 28 February in other years.
    v_this := make_date(extract(year from p_date)::int, extract(month from v_join)::int,
                        least(extract(day from v_join)::int, extract(day from (make_date(extract(year from p_date)::int, extract(month from v_join)::int, 1) + interval '1 month - 1 day'))::int));
    starts := case when p_date >= v_this then v_this else (v_this - interval '1 year')::date end;
  end if;
  ends := (starts + interval '1 year - 1 day')::date;
  year := extract(year from starts)::int;
  return next;
end $$;

-- A balance row for a leave year: the type's days, all at the start. Rows
-- that existed before this change keep their numbers.
create or replace function private.ensure_balance(p_business uuid, p_employee uuid, p_type uuid, p_year int)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  lt public.leave_types;
  v_id uuid;
  v_days numeric;
begin
  select * into lt from public.leave_types where id = p_type and business_id = p_business;
  if lt.id is null or not exists (select 1 from public.employees where id = p_employee) then return null; end if;
  v_days := case when lt.entitlement_mode in ('annual', 'birthday') then lt.entitlement_days else 0 end;
  insert into public.leave_balances as b (business_id, employee_id, leave_type_id, period_year, entitled, accrued)
  values (p_business, p_employee, p_type, p_year, v_days, v_days)
  on conflict (employee_id, leave_type_id, period_year) do update set entitled = excluded.entitled, accrued = excluded.accrued
    where not b.kept_as_is
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.leave_balances where employee_id = p_employee and leave_type_id = p_type and period_year = p_year;
  end if;
  return v_id;
end $$;

-- The balance row for a leave year, made first if needed. (Called on its
-- own so it always runs, even before any balance rows exist.)
create or replace function private.balance_row(p_business uuid, p_employee uuid, p_type uuid, p_year int)
returns public.leave_balances
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := private.ensure_balance(p_business, p_employee, p_type, p_year);
  b public.leave_balances;
begin
  select * into b from public.leave_balances where id = v_id;
  return b;
end $$;

-- Requests are filed against the leave year they fall in.
create or replace function private.leave_request_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_year int;
  v_bal uuid;
  v_pending numeric := 0;
  v_taken numeric := 0;
begin
  select ly.year into v_year from private.leave_year(coalesce(new.leave_type_id, old.leave_type_id), coalesce(new.employee_id, old.employee_id),
                                                    coalesce(new.start_date, old.start_date)) ly;
  if tg_op in ('UPDATE', 'DELETE') then
    if old.status = 'pending' then v_pending := v_pending - old.days; end if;
    if old.status = 'approved' then v_taken := v_taken - old.days; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.status = 'pending' then v_pending := v_pending + new.days; end if;
    if new.status = 'approved' then v_taken := v_taken + new.days; end if;
  end if;
  if v_pending <> 0 or v_taken <> 0 then
    v_bal := private.ensure_balance(coalesce(new.business_id, old.business_id), coalesce(new.employee_id, old.employee_id),
                                    coalesce(new.leave_type_id, old.leave_type_id), v_year);
    if v_bal is not null then
      update public.leave_balances set pending = greatest(0, pending + v_pending), taken = taken + v_taken where id = v_bal;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status in ('approved', 'rejected') and old.status = 'pending'
     and not exists (select 1 from public.approval_requests ar where ar.source_table = 'leave_requests' and ar.source_id = new.id) then
    perform private.notify(new.business_id, private.user_for_employee(new.business_id, new.employee_id), 'leave.decided',
      case when new.status = 'approved' then 'Time off approved' else 'Time off declined' end,
      concat_ws(' · ', to_char(new.start_date, 'DD Mon') || case when new.end_date <> new.start_date then ' to ' || to_char(new.end_date, 'DD Mon') else '' end,
                new.decision_comment), '/staff/time-off', 'leave');
  end if;
  return coalesce(new, old);
end $$;

-- Days granted to someone for a type that are usable on a date.
create or replace function private.granted_days(p_employee uuid, p_type uuid, p_on date)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.days), 0) from public.leave_allocations a
   where a.employee_id = p_employee and a.leave_type_id = p_type and a.starts_on <= p_on
     and (a.expires_on is null or a.expires_on >= p_on)
$$;

-- ---------------------------------------------------------------------
-- 3. Who can use a type
-- ---------------------------------------------------------------------
-- Why a person can't use a type on a date, or null if they can. Covers
-- who it's for, gender, contract, service, probation, grants and birthdays.
create or replace function private.leave_type_block(p_business uuid, p_type uuid, p_employee uuid, p_on date)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  lt public.leave_types;
  e public.employees;
  v_role uuid;
  v_from date;
begin
  select * into lt from public.leave_types where id = p_type and business_id = p_business and is_active;
  if lt.id is null then return 'Choose a type of time off'; end if;
  select * into e from public.employees where id = p_employee and business_id = p_business;
  if e.id is null then return 'Choose a person'; end if;
  select m.role_id into v_role from public.business_members m where m.business_id = p_business and m.employee_id = p_employee and m.status = 'active' limit 1;
  if lt.applies_to = 'selected' and not exists (
      select 1 from public.leave_type_targets t where t.leave_type_id = lt.id and (
        (t.target_type = 'employee' and t.target_id = e.id) or (t.target_type = 'position' and t.target_id = e.position_id)
        or (t.target_type = 'department' and t.target_id = e.department_id) or (t.target_type = 'branch' and t.target_id = e.branch_id)
        or (t.target_type = 'role' and t.target_id = v_role))) then
    return format('%s isn''t available to you', lt.name);
  end if;
  if lt.gender_eligibility <> 'any' and e.gender is distinct from lt.gender_eligibility then
    return format('%s isn''t available to you', lt.name);
  end if;
  if lt.eligible_contract_types is not null and not (e.contract_type = any(lt.eligible_contract_types)) then
    return format('%s isn''t available for your type of contract', lt.name);
  end if;
  if not lt.allow_during_probation and (e.status = 'probation' or (e.probation_end_date is not null and e.probation_end_date >= p_on)) then
    return format('%s can''t be taken during probation', lt.name);
  end if;
  if lt.eligible_after_value > 0 then
    v_from := (coalesce(e.join_date, p_on + 1) + case lt.eligible_after_unit
                 when 'days' then make_interval(days => lt.eligible_after_value)
                 when 'years' then make_interval(years => lt.eligible_after_value)
                 else make_interval(months => lt.eligible_after_value) end)::date;
    if e.join_date is null or p_on < v_from then
      return format('%s is available after %s %s of service%s', lt.name, lt.eligible_after_value,
                    case lt.eligible_after_unit when 'days' then 'days' when 'years' then case when lt.eligible_after_value = 1 then 'year' else 'years' end
                         else case when lt.eligible_after_value = 1 then 'month' else 'months' end end,
                    case when e.join_date is not null then ', from ' || to_char(v_from, 'DD Mon YYYY') else '' end);
    end if;
  end if;
  if lt.entitlement_mode = 'granted' and not exists (
      select 1 from public.leave_allocations a where a.employee_id = e.id and a.leave_type_id = lt.id and (a.expires_on is null or a.expires_on >= p_on)) then
    return format('%s is only for people HR has given it to', lt.name);
  end if;
  if lt.entitlement_mode = 'birthday' and e.date_of_birth is null then
    return format('%s needs your date of birth on your profile. Ask HR to add it.', lt.name);
  end if;
  return null;
end $$;

-- Is a document needed for a request of this many days?
create or replace function private.leave_document_needed(p_type uuid, p_days numeric)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select lt.document_rule = 'always' or (lt.document_rule = 'over_days' and p_days > coalesce(lt.document_over_days, 0))
                     from public.leave_types lt where lt.id = p_type), false)
$$;

-- ---------------------------------------------------------------------
-- 4. Checking a request against every rule (asking, HR entering, previews)
-- ---------------------------------------------------------------------
drop function if exists private.check_leave(uuid, uuid, uuid, date, date, text, text, text, uuid);
create function private.check_leave(
  p_business uuid, p_employee uuid, p_type uuid, p_start date, p_end date, p_start_half text, p_end_half text,
  p_attachment text, p_ignore uuid default null, p_office boolean default false)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  lt public.leave_types;
  e public.employees;
  v_block text;
  v_days numeric;
  v_bal public.leave_balances;
  v_available numeric;
  v_year record;
  v_begins timestamptz;
  v_notice interval;
  v_first date;
  v_last date;
  v_moved boolean;
  v_black record;
  d date;
  v_off int;
  v_bday date;
  v_win_start date;
  v_win_end date;
begin
  select * into lt from public.leave_types where id = p_type and business_id = p_business and is_active;
  if not found then
    raise exception 'Choose a type of time off' using errcode = '22023';
  end if;
  select * into e from public.employees where id = p_employee and business_id = p_business;
  if p_end < p_start then
    raise exception 'The last day must be on or after the first day' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'Ask for up to a year at a time' using errcode = '22023';
  end if;
  select * into v_year from private.leave_year(p_type, p_employee, p_start);
  if p_end > v_year.ends then
    raise exception 'Your leave year for % starts again on %. Split this into two requests.', lower(lt.name), to_char(v_year.ends + 1, 'DD Mon YYYY')
      using errcode = '22023';
  end if;

  v_block := private.leave_type_block(p_business, p_type, p_employee, p_start);
  if v_block is not null then
    raise exception '%', v_block using errcode = '22023';
  end if;

  -- Notice. HR entering time off for someone isn't held to it.
  if not p_office then
    v_begins := private.biz_moment(p_business, p_start, case when p_start_half = 'second_half' then '12:00'::time else '00:00'::time end);
    if v_begins < now() then
      if not lt.allow_after_the_fact then
        raise exception '% has to be asked for before it starts', lt.name using errcode = '22023';
      end if;
    elsif lt.notice_value > 0 then
      v_notice := case lt.notice_unit when 'minutes' then make_interval(mins => lt.notice_value)
                                      when 'hours' then make_interval(hours => lt.notice_value)
                                      else make_interval(days => lt.notice_value) end;
      if v_begins - now() < v_notice then
        raise exception '% needs % % notice. For these dates, you needed to ask by %.', lt.name, lt.notice_value,
          case lt.notice_unit when 'minutes' then 'minutes''' when 'hours' then case when lt.notice_value = 1 then 'hour''s' else 'hours''' end
               else case when lt.notice_value = 1 then 'day''s' else 'days''' end end,
          to_char((v_begins - v_notice) at time zone private.biz_tz(p_business), 'DD Mon YYYY HH24:MI')
          using errcode = '22023';
      end if;
    end if;
  end if;

  if (p_start_half <> 'full' or p_end_half <> 'full') and not lt.allow_half_day then
    raise exception '% can''t be taken as half days', lt.name using errcode = '22023';
  end if;
  if exists (select 1 from public.leave_requests r where r.employee_id = p_employee and r.status in ('pending','approved')
              and r.id is distinct from p_ignore and r.start_date <= p_end and r.end_date >= p_start) then
    raise exception 'You already have time off on some of those days' using errcode = '22023';
  end if;
  v_days := private.leave_days(p_business, p_type, p_start, p_end, p_start_half, p_end_half, e.branch_id);
  if v_days <= 0 then
    raise exception 'Those dates are all rest days or public holidays, so no time off is needed' using errcode = '22023';
  end if;
  if lt.min_days_per_request is not null and v_days < lt.min_days_per_request then
    raise exception '% has to be at least % days at a time', lt.name, lt.min_days_per_request using errcode = '22023';
  end if;
  if lt.max_days_per_request is not null and v_days > lt.max_days_per_request then
    raise exception '% can be up to % days at a time', lt.name, lt.max_days_per_request using errcode = '22023';
  end if;

  -- Consecutive days, counting the same type booked right before or after.
  if lt.max_consecutive_days is not null then
    v_first := p_start;
    v_last := p_end;
    loop
      v_moved := false;
      select min(r.start_date) into d from public.leave_requests r
       where r.employee_id = p_employee and r.leave_type_id = p_type and r.status in ('pending','approved') and r.id is distinct from p_ignore
         and r.end_date = v_first - 1;
      if d is not null then v_first := d; v_moved := true; end if;
      select max(r.end_date) into d from public.leave_requests r
       where r.employee_id = p_employee and r.leave_type_id = p_type and r.status in ('pending','approved') and r.id is distinct from p_ignore
         and r.start_date = v_last + 1;
      if d is not null then v_last := d; v_moved := true; end if;
      exit when not v_moved;
    end loop;
    if v_last - v_first + 1 > lt.max_consecutive_days then
      raise exception '% can be taken for up to % days in a row', lt.name, lt.max_consecutive_days using errcode = '22023';
    end if;
  end if;

  -- Blackout dates.
  select ce.title, ce.start_date, ce.end_date into v_black from public.company_events ce
   where ce.business_id = p_business and ce.kind = 'blackout' and ce.start_date <= p_end and ce.end_date >= p_start
     and (ce.leave_type_ids is null or p_type = any(ce.leave_type_ids)) and (ce.branch_id is null or ce.branch_id = e.branch_id)
   order by ce.start_date limit 1;
  if v_black.title is not null then
    raise exception '% can''t be taken from % to % (%)', lt.name, to_char(v_black.start_date, 'DD Mon'), to_char(v_black.end_date, 'DD Mon'), v_black.title
      using errcode = '22023';
  end if;

  -- How many of the team can be off at once.
  if lt.max_off_per_department is not null and e.department_id is not null then
    d := p_start;
    while d <= p_end loop
      select count(distinct r.employee_id) into v_off from public.leave_requests r join public.employees o on o.id = r.employee_id
       where r.business_id = p_business and o.department_id = e.department_id and r.employee_id <> p_employee
         and r.status in ('pending','approved') and r.id is distinct from p_ignore and d between r.start_date and r.end_date;
      if v_off >= lt.max_off_per_department then
        raise exception 'Already % from your team % off on %. The most allowed at once is %.', v_off,
          case when v_off = 1 then 'person is' else 'people are' end, to_char(d, 'DD Mon'), lt.max_off_per_department using errcode = '22023';
      end if;
      d := d + 1;
    end loop;
  end if;

  -- Birthday leave: only around the birthday.
  if lt.entitlement_mode = 'birthday' then
    v_bday := make_date(extract(year from p_start)::int, extract(month from e.date_of_birth)::int,
                        least(extract(day from e.date_of_birth)::int,
                              extract(day from (make_date(extract(year from p_start)::int, extract(month from e.date_of_birth)::int, 1) + interval '1 month - 1 day'))::int));
    if lt.birthday_window = 'month' then
      v_win_start := date_trunc('month', v_bday)::date;
      v_win_end := (date_trunc('month', v_bday) + interval '1 month - 1 day')::date;
    else
      v_win_start := v_bday;
      v_win_end := v_bday + lt.birthday_window_days - 1;
    end if;
    if p_start < v_win_start or p_end > v_win_end then
      raise exception '% can be taken between % and %', lt.name, to_char(v_win_start, 'DD Mon'), to_char(v_win_end, 'DD Mon YYYY') using errcode = '22023';
    end if;
  end if;

  -- Documents: needed now unless the type lets it follow later.
  if not p_office and private.leave_document_needed(p_type, v_days) and p_attachment is null and not lt.document_later_allowed then
    raise exception 'Add a document (for example a medical certificate) for this request' using errcode = '22023';
  end if;

  -- Enough days left in the leave year (plus days granted by HR).
  if lt.entitlement_mode <> 'unlimited' then
    v_bal := private.balance_row(p_business, p_employee, p_type, v_year.year);
    v_available := v_bal.balance - v_bal.pending + private.granted_days(p_employee, p_type, p_start);
    if v_days > v_available + (case when lt.allow_negative_balance then lt.max_negative_days else 0 end) then
      raise exception 'Not enough % left: you have % days and this needs %', lower(lt.name), greatest(v_available, 0), v_days using errcode = '22023';
    end if;
  end if;
  return v_days;
end $$;

-- ---------------------------------------------------------------------
-- 5. Asking, entering and previewing
-- ---------------------------------------------------------------------
drop function if exists public.request_leave(uuid, uuid, date, date, text, text, text, text);
create function public.request_leave(
  p_business uuid, p_type uuid, p_start date, p_end date,
  p_start_half text default 'full', p_end_half text default 'full', p_reason text default null, p_attachment text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_days numeric;
  v_id uuid;
  v_type public.leave_types;
  v_name text;
  v_doc text := 'not_needed';
  v_due date;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business and module_key = 'leave' and enabled) then
    raise exception 'Time off isn''t switched on for your company' using errcode = '42501';
  end if;
  if p_start < private.biz_today(p_business) - 30 then
    raise exception 'For time off more than 30 days ago, ask HR to enter it' using errcode = '22023';
  end if;
  if p_attachment is not null and p_attachment not like p_business::text || '/leave/' || v_emp::text || '/%' then
    raise exception 'That document is in the wrong folder' using errcode = '22023';
  end if;
  v_days := private.check_leave(p_business, v_emp, p_type, p_start, p_end, p_start_half, p_end_half, p_attachment);
  select * into v_type from public.leave_types where id = p_type;
  if private.leave_document_needed(p_type, v_days) then
    if p_attachment is not null then v_doc := 'uploaded';
    else v_doc := 'needed'; v_due := p_end + v_type.document_deadline_days; end if;
  end if;
  insert into public.leave_requests (business_id, employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, reason,
                                     attachment_path, status, document_status, document_due_on)
  values (p_business, v_emp, p_type, p_start, p_end, p_start_half, p_end_half, v_days, nullif(trim(left(p_reason, 500)), ''), p_attachment,
          'pending', v_doc, v_due)
  returning id into v_id;
  select trim(first_name || ' ' || last_name) into v_name from public.employees where id = v_emp;
  perform private.create_request(p_business, 'leave', 'leave', 'leave_requests', v_id, v_emp,
    v_type.name || ' for ' || v_name,
    concat_ws(' · ', to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' to ' || to_char(p_end, 'DD Mon') else '' end,
              trim(to_char(v_days, 'FM999990.0')) || case when v_days = 1 then ' day' else ' days' end,
              case when v_doc = 'needed' then 'document due ' || to_char(v_due, 'DD Mon') end, nullif(trim(p_reason), '')),
    null, jsonb_build_object('start_date', p_start, 'end_date', p_end, 'days', v_days));
  return v_id;
end $$;
revoke all on function public.request_leave(uuid, uuid, date, date, text, text, text, text) from public, anon;
grant execute on function public.request_leave(uuid, uuid, date, date, text, text, text, text) to authenticated;

drop function if exists public.record_leave(uuid, uuid, uuid, date, date, text, text, text);
create function public.record_leave(
  p_business uuid, p_employee uuid, p_type uuid, p_start date, p_end date,
  p_start_half text default 'full', p_end_half text default 'full', p_reason text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_days numeric;
  v_id uuid;
  v_type public.leave_types;
  v_needed boolean;
begin
  if not private.can_emp('leave', 'approve', p_business, p_employee) then
    raise exception 'You don''t have permission to enter time off for this person' using errcode = '42501';
  end if;
  v_days := private.check_leave(p_business, p_employee, p_type, p_start, p_end, p_start_half, p_end_half, null, null, true);
  select * into v_type from public.leave_types where id = p_type;
  v_needed := private.leave_document_needed(p_type, v_days);
  insert into public.leave_requests (business_id, employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, reason,
                                     status, decided_by, decided_at, document_status, document_due_on)
  values (p_business, p_employee, p_type, p_start, p_end, p_start_half, p_end_half, v_days, nullif(trim(left(p_reason, 500)), ''),
          'approved', auth.uid(), now(), case when v_needed then 'needed' else 'not_needed' end,
          case when v_needed then p_end + v_type.document_deadline_days end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_leave(uuid, uuid, uuid, date, date, text, text, text) from public, anon;
grant execute on function public.record_leave(uuid, uuid, uuid, date, date, text, text, text) to authenticated;

-- What a request would look like before it's sent: days, what's left, the
-- document needed, or the rule it breaks.
create or replace function public.preview_my_leave(
  p_business uuid, p_type uuid, p_start date, p_end date, p_start_half text default 'full', p_end_half text default 'full',
  p_has_document boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_days numeric;
  v_type public.leave_types;
begin
  if v_emp is null then
    return jsonb_build_object('ok', false, 'error', 'Your login isn''t linked to a staff profile yet. Ask HR to link it.');
  end if;
  if p_start < private.biz_today(p_business) - 30 then
    return jsonb_build_object('ok', false, 'error', 'For time off more than 30 days ago, ask HR to enter it');
  end if;
  begin
    v_days := private.check_leave(p_business, v_emp, p_type, p_start, p_end, p_start_half, p_end_half,
                                  case when p_has_document then 'preview' end);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  select * into v_type from public.leave_types where id = p_type;
  return jsonb_build_object(
    'ok', true, 'days', v_days,
    'document', case when not private.leave_document_needed(p_type, v_days) then 'none'
                     when p_has_document then 'attached'
                     else 'later' end,
    'document_due', case when private.leave_document_needed(p_type, v_days) and not p_has_document then p_end + v_type.document_deadline_days end);
end $$;
revoke all on function public.preview_my_leave(uuid, uuid, date, date, text, text, boolean) from public, anon;
grant execute on function public.preview_my_leave(uuid, uuid, date, date, text, text, boolean) to authenticated;

-- The types a person can use today, with what's left and the rules that apply.
create or replace function private.leave_types_for(p_business uuid, p_employee uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.biz_today(p_business);
  lt public.leave_types;
  v_year record;
  v_bal public.leave_balances;
  v_out jsonb := '[]'::jsonb;
begin
  for lt in select * from public.leave_types where business_id = p_business and is_active order by sort, name loop
    continue when private.leave_type_block(p_business, lt.id, p_employee, v_today) is not null;
    select * into v_year from private.leave_year(lt.id, p_employee, v_today);
    v_bal := private.balance_row(p_business, p_employee, lt.id, v_year.year);
    v_out := v_out || jsonb_build_object(
      'id', lt.id, 'name', lt.name, 'color', lt.color, 'is_paid', lt.is_paid, 'mode', lt.entitlement_mode,
      'allow_half_day', lt.allow_half_day, 'year_starts', v_year.starts, 'year_ends', v_year.ends,
      'entitled', case when lt.entitlement_mode = 'unlimited' then null else coalesce(v_bal.entitled, 0) + coalesce(v_bal.adjusted, 0) + coalesce(v_bal.carried_forward, 0) end,
      'granted', private.granted_days(p_employee, lt.id, v_today),
      'taken', coalesce(v_bal.taken, 0), 'pending', coalesce(v_bal.pending, 0),
      'available', case when lt.entitlement_mode = 'unlimited' then null
                        else greatest(0, coalesce(v_bal.balance, 0) - coalesce(v_bal.pending, 0) + private.granted_days(p_employee, lt.id, v_today)) end,
      'rules', jsonb_build_object(
        'notice_value', lt.notice_value, 'notice_unit', lt.notice_unit, 'after_the_fact', lt.allow_after_the_fact,
        'min_days', lt.min_days_per_request, 'max_days', lt.max_days_per_request, 'max_consecutive', lt.max_consecutive_days,
        'max_off', lt.max_off_per_department, 'document_rule', lt.document_rule, 'document_over_days', lt.document_over_days,
        'document_later', lt.document_later_allowed, 'document_deadline_days', lt.document_deadline_days,
        'birthday_window', case when lt.entitlement_mode = 'birthday' then lt.birthday_window end,
        'birthday_window_days', lt.birthday_window_days));
  end loop;
  return v_out;
end $$;

create or replace function public.my_leave_types(p_business uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
begin
  if v_emp is null then return '[]'::jsonb; end if;
  return private.leave_types_for(p_business, v_emp);
end $$;
revoke all on function public.my_leave_types(uuid) from public, anon;
grant execute on function public.my_leave_types(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Documents after the fact, and what happens without one
-- ---------------------------------------------------------------------
create or replace function private.hr_users(p_business uuid)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct m.user_id from public.business_members m join public.roles r on r.id = m.role_id
   where m.business_id = p_business and m.status = 'active'
     and (r.is_owner or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.resource = 'leave'
                                   and rp.action = 'approve' and rp.scope = 'all'))
$$;

-- Everyone to tell about someone's paperwork: HR and their manager.
create or replace function private.notify_leave_people(r public.leave_requests, p_event text, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  v_mgr uuid;
begin
  select private.user_for_employee(r.business_id, e.manager_id) into v_mgr from public.employees e where e.id = r.employee_id;
  for u in select * from private.hr_users(r.business_id) union select v_mgr where v_mgr is not null loop
    continue when u = private.user_for_employee(r.business_id, r.employee_id);
    perform private.notify(r.business_id, u, p_event, p_title, p_body, '/app/time-off?tab=documents', 'leave');
  end loop;
end $$;

-- The employee (or HR) adds the document.
create or replace function public.attach_leave_document(p_request uuid, p_path text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_request;
  if r.id is null or not (r.employee_id = private.my_employee_in(r.business_id) or private.can_emp('leave', 'edit', r.business_id, r.employee_id)) then
    raise exception 'You can''t add a document to this time off' using errcode = '42501';
  end if;
  if p_path is null or p_path not like r.business_id::text || '/leave/' || r.employee_id::text || '/%' then
    raise exception 'That document is in the wrong folder' using errcode = '22023';
  end if;
  update public.leave_requests set attachment_path = p_path,
    document_status = case when document_status in ('needed', 'overdue', 'not_needed') then 'uploaded' else document_status end
   where id = r.id;
  if r.document_status = 'overdue' then
    perform private.notify_leave_people(r, 'leave.document_late', 'A late document was added',
      (select trim(first_name || ' ' || last_name) from public.employees where id = r.employee_id)
      || ' added their document after the deadline. The days are still absences until HR restores the time off.');
  end if;
end $$;
revoke all on function public.attach_leave_document(uuid, text) from public, anon;
grant execute on function public.attach_leave_document(uuid, text) to authenticated;

-- Puts time off back after its days were turned into absences.
create or replace function private.restore_leave_after_absence(r public.leave_requests)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if r.absent_since is null then return; end if;
  delete from public.attendance_records a
   where a.employee_id = r.employee_id and a.work_date between r.start_date and r.end_date and a.source = 'system'
     and a.status = 'absent' and not private.attendance_locked(a.business_id, a.work_date);
  update public.leave_requests set status = 'approved', absent_since = null where id = r.id;
end $$;

-- HR gives more time for the document, or doesn't need it after all. Both need a reason, kept in the history.
create or replace function public.extend_leave_document(p_request uuid, p_due date, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_request;
  if r.id is null or not private.can_emp('leave', 'approve', r.business_id, r.employee_id) then
    raise exception 'You don''t have permission to change this time off' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add a short reason. It''s kept in the history.' using errcode = '22023';
  end if;
  if p_due < private.biz_today(r.business_id) then
    raise exception 'Choose a new deadline from today on' using errcode = '22023';
  end if;
  perform private.restore_leave_after_absence(r);
  update public.leave_requests set document_due_on = p_due, document_status = 'needed', document_reminded_at = null,
    document_note = trim(p_reason) where id = r.id;
end $$;
revoke all on function public.extend_leave_document(uuid, date, text) from public, anon;
grant execute on function public.extend_leave_document(uuid, date, text) to authenticated;

create or replace function public.waive_leave_document(p_request uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_request;
  if r.id is null or not private.can_emp('leave', 'approve', r.business_id, r.employee_id) then
    raise exception 'You don''t have permission to change this time off' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add a short reason. It''s kept in the history.' using errcode = '22023';
  end if;
  perform private.restore_leave_after_absence(r);
  update public.leave_requests set document_status = 'waived', document_note = trim(p_reason) where id = r.id;
end $$;
revoke all on function public.waive_leave_document(uuid, text) from public, anon;
grant execute on function public.waive_leave_document(uuid, text) to authenticated;

-- Daily: reminders the day before a document is due, and missing documents
-- turn the time off into unapproved absences (which payroll deducts).
create or replace function private.process_leave_documents(p_business uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
  v_today date;
  v_type text;
  v_name text;
  v_user uuid;
  d date;
  v_n int := 0;
begin
  for r in select lr.* from public.leave_requests lr
            where (p_business is null or lr.business_id = p_business) and lr.document_status = 'needed'
              and lr.status in ('pending', 'approved') and lr.document_due_on is not null loop
    v_today := private.biz_today(r.business_id);
    select lt.name into v_type from public.leave_types lt where lt.id = r.leave_type_id;
    select trim(e.first_name || ' ' || e.last_name) into v_name from public.employees e where e.id = r.employee_id;
    v_user := private.user_for_employee(r.business_id, r.employee_id);

    if r.document_due_on < v_today then
      -- The deadline has passed: the days become unapproved absences.
      update public.leave_requests set document_status = 'overdue', status = 'cancelled', absent_since = now(),
        decision_comment = 'No document by ' || to_char(r.document_due_on, 'DD Mon') || ', so these days are unapproved absences'
       where id = r.id;
      update public.approval_requests set status = 'cancelled', decided_at = now()
       where source_table = 'leave_requests' and source_id = r.id and status = 'pending';
      update public.approval_request_steps s set status = 'skipped'
        from public.approval_requests ar where ar.id = s.request_id and ar.source_table = 'leave_requests' and ar.source_id = r.id
         and s.status in ('pending', 'waiting');
      d := r.start_date;
      while d <= r.end_date loop
        if (select dp.kind from private.day_plan(r.business_id, r.employee_id, d) dp) = 'working'
           and not private.attendance_locked(r.business_id, d) then
          insert into public.attendance_records (business_id, employee_id, work_date, status, source, edit_reason)
          values (r.business_id, r.employee_id, d, 'absent', 'system', 'No document for ' || v_type || ' by ' || to_char(r.document_due_on, 'DD Mon'))
          on conflict (employee_id, work_date) do nothing;
        end if;
        d := d + 1;
      end loop;
      perform private.notify(r.business_id, v_user, 'leave.document_overdue', 'Your time off is now an absence',
        'No document was added for ' || v_type || ' (' || to_char(r.start_date, 'DD Mon') || ') by ' || to_char(r.document_due_on, 'DD Mon')
        || '. Those days now count as unapproved absences. Talk to HR if this is wrong.', '/staff/time-off', 'leave');
      perform private.notify_leave_people(r, 'leave.document_overdue', v_name || '''s time off is now an absence',
        'No document for ' || v_type || ' (' || to_char(r.start_date, 'DD Mon') || ') by ' || to_char(r.document_due_on, 'DD Mon')
        || '. You can give more time or waive the document in Time off.');
      v_n := v_n + 1;
    elsif r.document_due_on <= v_today + 1 and r.document_reminded_at is null then
      perform private.notify(r.business_id, v_user, 'leave.document_due', 'Add your document for ' || v_type,
        'Please add it by ' || to_char(r.document_due_on, 'DD Mon') || '. Without it, those days become unapproved absences.',
        '/staff/time-off', 'leave');
      perform private.notify_leave_people(r, 'leave.document_due', v_name || '''s document is due ' || to_char(r.document_due_on, 'DD Mon'),
        'For ' || v_type || ' from ' || to_char(r.start_date, 'DD Mon') || '. It hasn''t been added yet.');
      update public.leave_requests set document_reminded_at = now() where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Run by the daily job with the server key.
create or replace function public.run_leave_document_checks()
returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service_request() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return private.process_leave_documents();
end $$;
revoke all on function public.run_leave_document_checks() from public, anon, authenticated;
grant execute on function public.run_leave_document_checks() to service_role;

-- ---------------------------------------------------------------------
-- 7. Years, balances for the office, and carry over removed
-- ---------------------------------------------------------------------
create or replace function public.start_leave_year(p_business uuid, p_year int)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  lt record;
  v_n int := 0;
begin
  if p_business not in (select private.biz_all('leave', 'edit')) then
    raise exception 'You don''t have permission to start a new year' using errcode = '42501';
  end if;
  for e in select id from public.employees where business_id = p_business and status in ('active','probation','on_leave','suspended') loop
    for lt in select id from public.leave_types where business_id = p_business and is_active loop
      perform private.ensure_balance(p_business, e.id, lt.id, p_year);
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;

-- One person's balances in their current leave year for each type (profile, office).
drop function if exists public.employee_leave_balances(uuid, uuid, int);
create function public.employee_leave_balances(p_business uuid, p_employee uuid, p_year int default null)
returns table (leave_type_id uuid, name text, color text, accrual_method text, balance numeric, taken numeric, pending numeric)
language plpgsql security definer set search_path = '' as $$
declare
  lt public.leave_types;
  v_year int;
  v_today date := private.biz_today(p_business);
  b public.leave_balances;
begin
  if not private.can_emp('leave', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s time off' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.business_id = p_business) then return; end if;
  for lt in select * from public.leave_types where business_id = p_business and is_active order by sort, name loop
    continue when lt.entitlement_mode in ('granted', 'birthday') and private.leave_type_block(p_business, lt.id, p_employee, v_today) is not null;
    v_year := coalesce(p_year, (select ly.year from private.leave_year(lt.id, p_employee, v_today) ly));
    b := private.balance_row(p_business, p_employee, lt.id, v_year);
    leave_type_id := lt.id; name := lt.name; color := lt.color;
    accrual_method := case when lt.entitlement_mode = 'unlimited' then 'none' else 'upfront' end;
    balance := coalesce(b.balance, 0) + private.granted_days(p_employee, lt.id, v_today);
    taken := coalesce(b.taken, 0); pending := coalesce(b.pending, 0);
    return next;
  end loop;
end $$;
revoke all on function public.employee_leave_balances(uuid, uuid, int) from public, anon;
grant execute on function public.employee_leave_balances(uuid, uuid, int) to authenticated;

-- Staff's own balances keep working, and only list types they can use.
create or replace function public.my_leave_balances(p_business uuid, p_year int default null)
returns table (leave_type_id uuid, name text, color text, is_paid boolean, accrual_method text, entitled numeric, accrued numeric,
               carried_forward numeric, adjusted numeric, taken numeric, pending numeric, balance numeric, allow_half_day boolean,
               requires_document boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_today date := private.biz_today(p_business);
  lt public.leave_types;
  b public.leave_balances;
  v_year int;
begin
  if v_emp is null then return; end if;
  for lt in select * from public.leave_types where business_id = p_business and is_active order by sort, name loop
    continue when private.leave_type_block(p_business, lt.id, v_emp, v_today) is not null;
    v_year := coalesce(p_year, (select ly.year from private.leave_year(lt.id, v_emp, v_today) ly));
    b := private.balance_row(p_business, v_emp, lt.id, v_year);
    leave_type_id := lt.id; name := lt.name; color := lt.color; is_paid := lt.is_paid;
    accrual_method := case when lt.entitlement_mode = 'unlimited' then 'none' else 'upfront' end;
    entitled := b.entitled; accrued := b.accrued; carried_forward := b.carried_forward; adjusted := b.adjusted;
    taken := b.taken; pending := b.pending;
    balance := coalesce(b.balance, 0) + private.granted_days(v_emp, lt.id, v_today);
    allow_half_day := lt.allow_half_day; requires_document := lt.document_rule <> 'none';
    return next;
  end loop;
end $$;
revoke all on function public.my_leave_balances(uuid, int) from public, anon;
grant execute on function public.my_leave_balances(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Attendance: leave only counts while it's approved (cancelled time
--    off, including time off whose document never came, is an absence).
--    Already true in private.attendance_days; system absences are
--    written as records so payroll sees them too.
-- ---------------------------------------------------------------------

call private.finalize_tenant_tables();
