-- =====================================================================
-- 0028 ATTENDANCE ENGINE
--   Work schedules, one status per person per day, overtime rules and
--   approval, a stored monthly summary per person (for payroll formulas),
--   locking once payroll is finalized, importing clock-machine files, and
--   a history of office edits with the reason given.
--
--   Day statuses: present, late, half_day, early_leave, absent (no record
--   on a working day and no approved time off), on_leave, holiday, rest_day.
--   Rest days and public holidays are never absences.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Work schedules: which weekdays someone works, and their usual shift
--    (the shift holds the times and break length). A roster entry for a
--    day overrides the schedule for that day.
-- ---------------------------------------------------------------------
create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  working_days smallint[] not null default '{0,1,2,3,4}'
    check (working_days <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(working_days) between 1 and 7),
  shift_id uuid,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, shift_id) references public.shifts (business_id, id) on delete set null (shift_id)
);
create unique index work_schedules_one_default on public.work_schedules (business_id) where is_default;
create index work_schedules_shift_fk_idx on public.work_schedules (business_id, shift_id);
call private.std_rls('work_schedules', 'roster', null, true);

alter table public.employees add column if not exists work_schedule_id uuid;
alter table public.employees
  add constraint employees_work_schedule_fk foreign key (business_id, work_schedule_id)
  references public.work_schedules (business_id, id) on delete set null (work_schedule_id);
create index if not exists employees_work_schedule_fk_idx on public.employees (business_id, work_schedule_id);

-- ---------------------------------------------------------------------
-- 2. Rules (all editable in settings)
-- ---------------------------------------------------------------------
alter table public.attendance_policies
  add column if not exists overtime_mode text not null default 'daily_hours' check (overtime_mode in ('daily_hours', 'outside_shift')),
  add column if not exists overtime_daily_hours numeric(4,2),
  add column if not exists overtime_rounding text not null default 'down' check (overtime_rounding in ('none', 'nearest', 'down', 'up')),
  add column if not exists overtime_round_to integer not null default 15 check (overtime_round_to between 1 and 120),
  add column if not exists overtime_monthly_cap_hours numeric(6,2) check (overtime_monthly_cap_hours is null or overtime_monthly_cap_hours >= 0),
  add column if not exists overtime_requires_approval boolean not null default false;

-- Built-in rules for a company that hasn't saved its own yet (same values as the settings' defaults).
create or replace function private.policy_for(p_business uuid, p_employee uuid)
returns public.attendance_policies
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.attendance_policies;
begin
  select ap.* into p from public.employees e join public.attendance_policies ap on ap.id = e.attendance_policy_id
   where e.id = p_employee and e.business_id = p_business;
  if p.id is null then
    select * into p from public.attendance_policies where business_id = p_business and is_default;
  end if;
  if p.id is null then
    p.grace_minutes := 10; p.late_mark_after_minutes := 10; p.early_leave_minutes := 10;
    p.half_day_min_hours := 4; p.full_day_hours := 8; p.overtime_enabled := true; p.overtime_after_minutes := 30;
    p.overtime_rate_weekday := 1.25; p.overtime_rate_rest_day := 1.5; p.overtime_rate_holiday := 1.5;
    p.overtime_mode := 'daily_hours'; p.overtime_rounding := 'down'; p.overtime_round_to := 15;
    p.overtime_requires_approval := false;
    p.require_gps := false; p.require_selfie := false; p.allow_breaks := true;
  end if;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- 3. Day records: early leave as its own status, half days marked by a
--    manager, the kind of overtime, overtime approval, and edit reasons.
-- ---------------------------------------------------------------------
alter table public.attendance_records drop constraint if exists attendance_records_status_check;
alter table public.attendance_records add constraint attendance_records_status_check
  check (status in ('present','late','half_day','early_leave','absent','on_leave','holiday','rest_day'));
alter table public.attendance_records
  add column if not exists is_half_day boolean not null default false,
  add column if not exists overtime_type text check (overtime_type in ('normal', 'rest_day', 'holiday')),
  add column if not exists ot_decision text check (ot_decision in ('approved', 'rejected')),
  add column if not exists ot_decided_by uuid references auth.users (id) on delete set null,
  add column if not exists ot_decided_at timestamptz,
  add column if not exists edit_reason text;
create index if not exists attendance_records_ot_decided_by_fk_idx on public.attendance_records (ot_decided_by);

-- ---------------------------------------------------------------------
-- 4. What kind of day it is for someone: a public holiday, a rest day or
--    a working day, and the shift they're expected on.
--    Order: public holiday (not optional; whole company or their
--    location), then the roster for that day, then their work schedule,
--    then the company's default schedule, then the company's working days.
-- ---------------------------------------------------------------------
create or replace function private.day_plan(p_business uuid, p_employee uuid, p_date date)
returns table (kind text, shift_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
  re public.roster_entries;
  ws public.work_schedules;
  v_days smallint[];
begin
  select * into e from public.employees where id = p_employee and business_id = p_business;
  select * into re from public.roster_entries where employee_id = p_employee and work_date = p_date;
  select * into ws from public.work_schedules
   where business_id = p_business and (id = e.work_schedule_id or (e.work_schedule_id is null and is_default))
   order by (id = e.work_schedule_id) desc limit 1;
  shift_id := coalesce(re.shift_id, ws.shift_id);
  if exists (select 1 from public.public_holidays h
              where h.business_id = p_business and h.holiday_date = p_date and not h.is_optional
                and (h.branch_id is null or h.branch_id = e.branch_id)) then
    kind := 'holiday';
  elsif re.id is not null then
    kind := case when re.is_rest_day then 'rest' else 'working' end;
  else
    v_days := coalesce(ws.working_days, (select b.working_days from public.businesses b where b.id = p_business));
    kind := case when extract(dow from p_date)::smallint = any(v_days) then 'working' else 'rest' end;
  end if;
  return next;
end $$;

-- ---------------------------------------------------------------------
-- 5. Working out one day's numbers from its clock times.
-- ---------------------------------------------------------------------
create or replace function private.recalc_attendance(p_record uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.attendance_records;
  s public.shifts;
  p public.attendance_policies;
  v_kind text;
  v_plan_shift uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_break int := 0;
  v_worked int := 0;
  v_late int := 0;
  v_early int := 0;
  v_ot int := 0;
  v_ot_type text;
  v_round int;
  v_status text;
begin
  select * into r from public.attendance_records where id = p_record;
  -- Days entered without clock times (absent, on leave, holiday, rest day) keep what was chosen.
  if not found or r.clock_in_at is null then return; end if;
  p := private.policy_for(r.business_id, r.employee_id);
  select dp.kind, dp.shift_id into v_kind, v_plan_shift from private.day_plan(r.business_id, r.employee_id, r.work_date) dp;
  select * into s from public.shifts where id = coalesce(r.shift_id, v_plan_shift);
  if s.id is not null then
    v_start := private.biz_moment(r.business_id, r.work_date, s.start_time);
    v_end := private.biz_moment(r.business_id, r.work_date + case when s.crosses_midnight or s.end_time <= s.start_time then 1 else 0 end, s.end_time);
  end if;

  select coalesce(sum(extract(epoch from (coalesce(b.ended_at, r.clock_out_at, now()) - b.started_at)) / 60), 0)::int
    into v_break from public.attendance_breaks b where b.record_id = r.id;
  -- No break recorded: take off the shift's usual break, if the day was long enough to include one
  -- (longer than the break plus a half day). Short days keep all their time.
  if v_break = 0 and s.id is not null and s.break_minutes > 0 and r.clock_out_at is not null
     and extract(epoch from (r.clock_out_at - r.clock_in_at)) / 60 > s.break_minutes + p.half_day_min_hours * 60 then
    v_break := s.break_minutes;
  end if;

  -- Late: minutes after the shift started, once past the grace period (working days only).
  if v_kind = 'working' and v_start is not null and r.clock_in_at > v_start + make_interval(mins => p.grace_minutes) then
    v_late := (extract(epoch from (r.clock_in_at - v_start)) / 60)::int;
  end if;

  if r.clock_out_at is not null then
    v_worked := greatest(0, (extract(epoch from (r.clock_out_at - r.clock_in_at)) / 60)::int - v_break);
    if v_kind = 'working' then
      -- Early leave: left more than the allowed minutes before the shift ended.
      if v_end is not null and r.clock_out_at < v_end - make_interval(mins => p.early_leave_minutes) then
        v_early := (extract(epoch from (v_end - r.clock_out_at)) / 60)::int;
      end if;
      if p.overtime_enabled then
        if p.overtime_mode = 'outside_shift' and v_start is not null then
          -- Time worked before the shift started and after it ended.
          v_ot := least(v_worked,
            greatest(0, (extract(epoch from (v_start - r.clock_in_at)) / 60)::int)
            + greatest(0, (extract(epoch from (r.clock_out_at - v_end)) / 60)::int));
        else
          -- Time worked beyond the day's hours: the hours set in the rules, else the shift's
          -- length (less its break), else a full day.
          v_ot := v_worked - coalesce((p.overtime_daily_hours * 60)::int,
                                      case when s.id is not null then greatest(0, (extract(epoch from (v_end - v_start)) / 60)::int - s.break_minutes) end,
                                      (coalesce(p.full_day_hours, 8) * 60)::int);
        end if;
        v_ot_type := 'normal';
      end if;
    elsif p.overtime_enabled then
      -- Every hour worked on a rest day or public holiday is overtime at that day's rate.
      v_ot := v_worked;
      v_ot_type := case v_kind when 'holiday' then 'holiday' else 'rest_day' end;
    end if;

    -- Minimum before it counts, then rounding.
    if v_ot < greatest(p.overtime_after_minutes, 1) then v_ot := 0; end if;
    v_round := greatest(coalesce(p.overtime_round_to, 1), 1);
    v_ot := case p.overtime_rounding
      when 'down' then (v_ot / v_round) * v_round
      when 'up' then ((v_ot + v_round - 1) / v_round) * v_round
      when 'nearest' then (round(v_ot::numeric / v_round) * v_round)::int
      else v_ot end;
    if v_ot <= 0 then v_ot := 0; v_ot_type := null; end if;
  end if;

  v_status := case
    when v_kind = 'holiday' then 'holiday'
    when v_kind = 'rest' then 'rest_day'
    when r.is_half_day or (r.clock_out_at is not null and v_worked < p.half_day_min_hours * 60) then 'half_day'
    when v_early > 0 then 'early_leave'
    when v_late > 0 then 'late'
    else 'present' end;

  update public.attendance_records set
    break_minutes = v_break, worked_minutes = v_worked, late_minutes = v_late, early_leave_minutes = v_early,
    overtime_minutes = v_ot, overtime_type = v_ot_type, status = v_status,
    -- A changed amount of overtime needs deciding again.
    ot_decision = case when v_ot = r.overtime_minutes then r.ot_decision end,
    ot_decided_by = case when v_ot = r.overtime_minutes then r.ot_decided_by end,
    ot_decided_at = case when v_ot = r.overtime_minutes then r.ot_decided_at end
  where id = r.id;
end $$;

-- Recalculate when times, the shift or the half-day mark change.
drop trigger if exists attendance_times_changed on public.attendance_records;
create trigger attendance_times_changed after insert or update of clock_in_at, clock_out_at, shift_id, is_half_day on public.attendance_records
  for each row execute function private.after_attendance_times_changed();

-- Clocking in uses the roster, else the work schedule, for the day's shift.
create or replace function private.fill_expected_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.shift_id is null then
    select dp.shift_id into new.shift_id from private.day_plan(new.business_id, new.employee_id, new.work_date) dp;
  end if;
  return new;
end $$;
drop trigger if exists attendance_expected_shift on public.attendance_records;
create trigger attendance_expected_shift before insert on public.attendance_records
  for each row execute function private.fill_expected_shift();

-- ---------------------------------------------------------------------
-- 6. Locking: once a payroll run covering a day is finalized or paid, that
--    day's attendance can't change (until the run is reversed).
-- ---------------------------------------------------------------------
create or replace function private.attendance_locked(p_business uuid, p_date date)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payroll_runs r
                  where r.business_id = p_business and r.status in ('finalized', 'paid')
                    and p_date between r.period_start and r.period_end)
$$;

create or replace function private.guard_attendance_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ignore text[] := array['timesheet_id', 'updated_at', 'is_flagged', 'flag_reason'];
begin
  -- Linking a day to a timesheet or clearing a "please check" flag isn't a change to attendance.
  if tg_op = 'UPDATE' and (to_jsonb(new) - ignore) = (to_jsonb(old) - ignore) then
    return new;
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and private.attendance_locked(old.business_id, old.work_date))
     or (tg_op in ('INSERT', 'UPDATE') and private.attendance_locked(new.business_id, new.work_date)) then
    raise exception 'Payroll for this period is finalized, so its attendance is locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists attendance_lock on public.attendance_records;
create trigger attendance_lock before insert or update or delete on public.attendance_records
  for each row execute function private.guard_attendance_lock();

-- ---------------------------------------------------------------------
-- 7. One row per person per day for a date range: the day's status and
--    numbers. Days before someone joined or after they left aren't
--    included; today and later days without a record have no status yet.
-- ---------------------------------------------------------------------
create or replace function private.attendance_days(p_business uuid, p_start date, p_end date, p_employee uuid default null)
returns table (
  employee_id uuid, day date, kind text, status text, worked_minutes int, late_minutes int, early_leave_minutes int,
  overtime_minutes int, overtime_type text, overtime_state text, record_id uuid, clock_in_at timestamptz, clock_out_at timestamptz,
  leave_name text, missing_clock_out boolean, source text)
language sql stable security definer set search_path = '' as $$
  with emps as (
    select e.id, e.branch_id, e.join_date, e.exit_date, e.work_schedule_id
      from public.employees e
     where e.business_id = p_business and (p_employee is null or e.id = p_employee)
       and (e.join_date is null or e.join_date <= p_end)
       and (e.exit_date is null or e.exit_date >= p_start)
       and (e.status not in ('resigned', 'terminated') or e.exit_date is not null)
  ),
  biz as (select b.working_days, private.biz_today(b.id) as today from public.businesses b where b.id = p_business),
  def as (select w.working_days, w.shift_id from public.work_schedules w where w.business_id = p_business and w.is_default),
  days as (
    select m.*, g::date as day
      from emps m
      cross join lateral generate_series(greatest(p_start, coalesce(m.join_date, p_start)), least(p_end, coalesce(m.exit_date, p_end)), interval '1 day') g
  )
  select d.id, d.day, k.kind,
         case
           when ar.clock_in_at is not null then ar.status
           when ar.id is not null and ar.status in ('absent', 'on_leave', 'holiday', 'rest_day') then ar.status
           when k.kind = 'holiday' then 'holiday'
           when k.kind = 'rest' then 'rest_day'
           when lv.name is not null then 'on_leave'
           when d.day >= (select today from biz) then null
           else 'absent' end,
         coalesce(ar.worked_minutes, 0), coalesce(ar.late_minutes, 0), coalesce(ar.early_leave_minutes, 0),
         coalesce(ar.overtime_minutes, 0), ar.overtime_type,
         case when coalesce(ar.overtime_minutes, 0) = 0 then null
              when not (private.policy_for(p_business, d.id)).overtime_requires_approval then 'approved'
              else coalesce(ar.ot_decision, 'pending') end,
         ar.id, ar.clock_in_at, ar.clock_out_at, lv.name,
         ar.clock_in_at is not null and ar.clock_out_at is null and d.day < (select today from biz),
         ar.source
    from days d
    left join public.attendance_records ar on ar.employee_id = d.id and ar.work_date = d.day
    left join public.roster_entries re on re.employee_id = d.id and re.work_date = d.day
    left join public.work_schedules ws on ws.id = d.work_schedule_id
    left join lateral (
      select lt.name from public.leave_requests lr join public.leave_types lt on lt.id = lr.leave_type_id
       where lr.employee_id = d.id and lr.status = 'approved' and d.day between lr.start_date and lr.end_date
       limit 1) lv on true
    cross join lateral (
      select case
        when exists (select 1 from public.public_holidays h where h.business_id = p_business and h.holiday_date = d.day
                      and not h.is_optional and (h.branch_id is null or h.branch_id = d.branch_id)) then 'holiday'
        when re.id is not null then case when re.is_rest_day then 'rest' else 'working' end
        when extract(dow from d.day)::smallint = any(coalesce(ws.working_days, (select working_days from def), (select working_days from biz))) then 'working'
        else 'rest' end as kind) k
$$;

-- The same, for the office view and the staff app: only people you may see.
create or replace function public.attendance_days(p_business uuid, p_start date, p_end date, p_employee uuid default null)
returns table (
  employee_id uuid, day date, kind text, status text, worked_minutes int, late_minutes int, early_leave_minutes int,
  overtime_minutes int, overtime_type text, overtime_state text, record_id uuid, clock_in_at timestamptz, clock_out_at timestamptz,
  leave_name text, missing_clock_out boolean, source text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_business not in (select private.my_business_ids()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_end < p_start or p_end - p_start > 62 then
    raise exception 'Choose up to two months at a time' using errcode = '22023';
  end if;
  -- Checked once per person, not once per day.
  return query
    with allowed as (
      select e.id from public.employees e
       where e.business_id = p_business and (p_employee is null or e.id = p_employee)
         and private.can_emp('attendance', 'view', p_business, e.id))
    select d.* from private.attendance_days(p_business, p_start, p_end, p_employee) d
     where d.employee_id in (select id from allowed)
     order by d.employee_id, d.day;
end $$;
revoke all on function public.attendance_days(uuid, date, date, uuid) from public, anon;
grant execute on function public.attendance_days(uuid, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. The monthly summary per person, stored for payroll formulas.
-- ---------------------------------------------------------------------
create table public.attendance_months (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  month date not null check (extract(day from month) = 1),
  days_in_month int not null,
  days_employed int not null,
  working_days int not null,
  days_present int not null,            -- present, late or left early (working days)
  half_days int not null,
  unapproved_absences int not null,
  approved_absences int not null,       -- days on approved time off
  late_count int not null,
  late_minutes int not null,
  early_leaves int not null,
  longest_absence_run int not null,     -- consecutive unapproved absences (rest days and holidays don't break a run)
  rest_days int not null,
  holidays int not null,
  worked_minutes int not null,
  overtime_normal_minutes int not null,     -- approved (or not needing approval), within the monthly cap
  overtime_rest_day_minutes int not null,
  overtime_holiday_minutes int not null,
  overtime_pending_minutes int not null,    -- waiting for approval
  overtime_over_cap_minutes int not null,   -- approved but beyond the monthly cap, so not counted
  computed_at timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (employee_id, month),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);
create index attendance_months_month_idx on public.attendance_months (business_id, month);
call private.std_rls('attendance_months', 'attendance', 'employee_id');

-- Only the database writes summaries.
create or replace function private.guard_attendance_months() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if private.is_client_context() then
    raise exception 'Monthly summaries are worked out by Harbor' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger attendance_months_guard before insert or update or delete on public.attendance_months
  for each row execute function private.guard_attendance_months();

-- Works out and stores a month for everyone in the company (locked months are kept as they were).
create or replace function private.compute_attendance_month(p_business uuid, p_month date, p_employee uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_locked boolean := private.attendance_locked(p_business, (date_trunc('month', p_month))::date)
                      and private.attendance_locked(p_business, (date_trunc('month', p_month) + interval '1 month - 1 day')::date);
  v_n int;
begin
  with d as (select * from private.attendance_days(p_business, v_start, v_end, p_employee)),
  -- Consecutive unapproved absences, looking only at days that could be absences.
  runs as (
    select x.employee_id, max(x.n) as longest from (
      select employee_id, count(*) as n from (
        select employee_id, status,
               row_number() over (partition by employee_id order by day)
               - row_number() over (partition by employee_id, status = 'absent' order by day) as grp
          from d where status is not null and status not in ('rest_day', 'holiday')) y
       where status = 'absent' group by employee_id, grp) x
     group by x.employee_id),
  -- Overtime counted in date order until the monthly cap is reached.
  ot as (
    select o.employee_id, o.overtime_type,
           greatest(0, least(o.overtime_minutes, o.cap - (o.running - o.overtime_minutes))) as counted,
           o.overtime_minutes
      from (
        select d.employee_id, d.overtime_type, d.overtime_minutes,
               coalesce(((private.policy_for(p_business, d.employee_id)).overtime_monthly_cap_hours * 60)::int, 2147483647) as cap,
               sum(d.overtime_minutes) over (partition by d.employee_id order by d.day) as running
          from d where d.overtime_state = 'approved') o),
  ot_sum as (
    select employee_id,
           coalesce(sum(counted) filter (where overtime_type = 'normal'), 0) as normal,
           coalesce(sum(counted) filter (where overtime_type = 'rest_day'), 0) as rest,
           coalesce(sum(counted) filter (where overtime_type = 'holiday'), 0) as holiday,
           coalesce(sum(overtime_minutes - counted), 0) as over_cap
      from ot group by employee_id),
  agg as (
    select d.employee_id,
           count(*) as employed,
           count(*) filter (where d.kind = 'working') as working,
           count(*) filter (where d.status in ('present', 'late', 'early_leave') and d.kind = 'working') as present,
           count(*) filter (where d.status = 'half_day') as half,
           count(*) filter (where d.status = 'absent') as absent,
           count(*) filter (where d.status = 'on_leave') as on_leave,
           count(*) filter (where d.late_minutes > 0) as late_n,
           coalesce(sum(d.late_minutes), 0) as late_m,
           count(*) filter (where d.status = 'early_leave') as early_n,          -- a half day isn't also an early leave
           count(*) filter (where d.kind = 'rest') as rest_n,
           count(*) filter (where d.kind = 'holiday') as hol_n,
           coalesce(sum(d.worked_minutes), 0) as worked,
           coalesce(sum(d.overtime_minutes) filter (where d.overtime_state = 'pending'), 0) as pending
      from d group by d.employee_id)
  insert into public.attendance_months as am (business_id, employee_id, month, days_in_month, days_employed, working_days, days_present,
    half_days, unapproved_absences, approved_absences, late_count, late_minutes, early_leaves, longest_absence_run, rest_days, holidays,
    worked_minutes, overtime_normal_minutes, overtime_rest_day_minutes, overtime_holiday_minutes, overtime_pending_minutes,
    overtime_over_cap_minutes, computed_at, locked_at)
  select p_business, a.employee_id, v_start, (v_end - v_start + 1), a.employed, a.working, a.present, a.half, a.absent, a.on_leave,
         a.late_n, a.late_m, a.early_n, coalesce(r.longest, 0), a.rest_n, a.hol_n, a.worked,
         coalesce(o.normal, 0), coalesce(o.rest, 0), coalesce(o.holiday, 0), a.pending, coalesce(o.over_cap, 0),
         now(), case when v_locked then now() end
    from agg a left join runs r on r.employee_id = a.employee_id left join ot_sum o on o.employee_id = a.employee_id
  on conflict (employee_id, month) do update set
    days_in_month = excluded.days_in_month, days_employed = excluded.days_employed, working_days = excluded.working_days,
    days_present = excluded.days_present, half_days = excluded.half_days, unapproved_absences = excluded.unapproved_absences,
    approved_absences = excluded.approved_absences, late_count = excluded.late_count, late_minutes = excluded.late_minutes,
    early_leaves = excluded.early_leaves, longest_absence_run = excluded.longest_absence_run, rest_days = excluded.rest_days,
    holidays = excluded.holidays, worked_minutes = excluded.worked_minutes, overtime_normal_minutes = excluded.overtime_normal_minutes,
    overtime_rest_day_minutes = excluded.overtime_rest_day_minutes, overtime_holiday_minutes = excluded.overtime_holiday_minutes,
    overtime_pending_minutes = excluded.overtime_pending_minutes, overtime_over_cap_minutes = excluded.overtime_over_cap_minutes,
    computed_at = now(), locked_at = excluded.locked_at
    where am.locked_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Brings a month's summaries up to date (anyone who can see attendance; they then see only the rows they may).
create or replace function public.refresh_attendance_month(p_business uuid, p_month date)
returns int
language plpgsql security definer set search_path = '' as $$
begin
  if p_business not in (select private.biz_with('attendance', 'view')) then
    raise exception 'You don''t have permission to see attendance' using errcode = '42501';
  end if;
  return private.compute_attendance_month(p_business, p_month);
end $$;
revoke all on function public.refresh_attendance_month(uuid, date) from public, anon;
grant execute on function public.refresh_attendance_month(uuid, date) to authenticated;

-- Finalizing payroll stores and locks the months it fully covers.
create or replace function private.lock_attendance_months() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m date;
begin
  if new.status in ('finalized', 'paid') and old.status not in ('finalized', 'paid') then
    for m in select generate_series(date_trunc('month', new.period_start), date_trunc('month', new.period_end), interval '1 month')::date loop
      perform private.compute_attendance_month(new.business_id, m);
    end loop;
  elsif new.status = 'reversed' and old.status in ('finalized', 'paid') then
    update public.attendance_months set locked_at = null
     where business_id = new.business_id and month between date_trunc('month', new.period_start) and date_trunc('month', new.period_end)
       and not private.attendance_locked(business_id, month);
  end if;
  return new;
end $$;
drop trigger if exists payroll_locks_attendance on public.payroll_runs;
create trigger payroll_locks_attendance after update of status on public.payroll_runs
  for each row execute function private.lock_attendance_months();

-- ---------------------------------------------------------------------
-- 9. Overtime approval (when the rules ask for it).
-- ---------------------------------------------------------------------
create or replace function public.decide_overtime(p_business uuid, p_records uuid[], p_decision text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n int := 0;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject' using errcode = '22023';
  end if;
  for r in select id, employee_id from public.attendance_records
            where business_id = p_business and id = any(p_records) and overtime_minutes > 0 loop
    if not private.can_emp('attendance', 'approve', p_business, r.employee_id) then
      raise exception 'You can only decide overtime for people you manage' using errcode = '42501';
    end if;
    update public.attendance_records set ot_decision = p_decision, ot_decided_by = auth.uid(), ot_decided_at = now()
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.decide_overtime(uuid, uuid[], text) from public, anon;
grant execute on function public.decide_overtime(uuid, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Importing a clock machine's file. Rows arrive already matched to
--     columns: { row, code, date: YYYY-MM-DD, in: HH:MM, out: HH:MM }.
--     With p_dry_run, nothing is saved; every problem is listed.
-- ---------------------------------------------------------------------
create or replace function public.import_attendance(p_business uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  v_row int;
  v_emp uuid;
  v_date date;
  v_in time;
  v_out time;
  v_in_at timestamptz;
  v_out_at timestamptz;
  v_today date := private.biz_today(p_business);
  v_errors jsonb := '[]'::jsonb;
  v_ok int := 0;
  v_seen text[] := '{}';
  v_key text;
begin
  if p_business not in (select private.biz_with('attendance', 'edit')) then
    raise exception 'You don''t have permission to import time records' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import up to 5,000 rows at a time' using errcode = '22023';
  end if;

  for x in select * from jsonb_array_elements(p_rows) loop
    v_row := coalesce((x ->> 'row')::int, 0);
    select e.id into v_emp from public.employees e
     where e.business_id = p_business and lower(e.employee_code) = lower(trim(x ->> 'code'));
    if v_emp is null then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('No one has the employee number "%s"', x ->> 'code'));
      continue;
    end if;
    if not private.can_emp('attendance', 'edit', p_business, v_emp) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'You can''t change this person''s time records');
      continue;
    end if;
    begin
      v_date := (x ->> 'date')::date;
      v_in := nullif(x ->> 'in', '')::time;
      v_out := nullif(x ->> 'out', '')::time;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'The date or a time isn''t readable');
      continue;
    end;
    if v_date is null or v_in is null then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'A date and a time in are needed');
      continue;
    end if;
    if v_date > v_today then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'The date is in the future');
      continue;
    end if;
    if private.attendance_locked(p_business, v_date) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'Payroll for this date is finalized, so it is locked');
      continue;
    end if;
    v_key := v_emp::text || v_date::text;
    if v_key = any(v_seen) then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'This person and day appear twice in the file');
      continue;
    end if;
    v_seen := v_seen || v_key;
    v_ok := v_ok + 1;
    continue when p_dry_run;

    v_in_at := private.biz_moment(p_business, v_date, v_in);
    -- A time out earlier than the time in is the next morning (a night shift).
    v_out_at := case when v_out is null then null
                     else private.biz_moment(p_business, v_date + case when v_out < v_in then 1 else 0 end, v_out) end;
    insert into public.attendance_records (business_id, employee_id, work_date, clock_in_at, clock_out_at, source, status, edit_reason)
    values (p_business, v_emp, v_date, v_in_at, v_out_at, 'import', 'present', 'Imported from a clock machine file')
    on conflict (employee_id, work_date) do update set
      clock_in_at = excluded.clock_in_at, clock_out_at = excluded.clock_out_at, source = 'import',
      edit_reason = excluded.edit_reason, status = 'present';
  end loop;

  return jsonb_build_object('valid', v_ok, 'errors', v_errors, 'imported', case when p_dry_run then 0 else v_ok end);
end $$;
revoke all on function public.import_attendance(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_attendance(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 11. A history of office edits and imports, with the reason given
--     (clock-ins and clock-outs from the staff app aren't logged here).
-- ---------------------------------------------------------------------
drop trigger if exists audit_attendance_edits on public.attendance_records;
create trigger audit_attendance_edits after insert or update on public.attendance_records
  for each row when (pg_trigger_depth() < 1 and new.source in ('manual', 'import'))
  execute function private.audit_row('attendance', 'employee_id');
drop trigger if exists audit_attendance_deletes on public.attendance_records;
create trigger audit_attendance_deletes after delete on public.attendance_records
  for each row execute function private.audit_row('attendance', 'employee_id');

-- Bring existing days up to date with the new rules (days in finalized payroll periods stay as they were).
do $$
declare r record;
begin
  for r in select id from public.attendance_records a
            where a.clock_in_at is not null and not private.attendance_locked(a.business_id, a.work_date) loop
    perform private.recalc_attendance(r.id);
  end loop;
end $$;

call private.finalize_tenant_tables();
