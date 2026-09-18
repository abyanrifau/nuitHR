-- =====================================================================
-- 0011 TIME & SHIFTS, TIME OFF
--   Clocking in and out (with location check and late / overtime maths),
--   breaks, fixing a clock time, timesheets, and time off requests with
--   balances that stay right however a request is decided.
--   All time maths uses the company's own time zone.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------
create or replace function private.biz_tz(p_business uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select b.timezone from public.businesses b where b.id = p_business), 'Indian/Maldives')
$$;

-- Today's date in the company's time zone.
create or replace function private.biz_today(p_business uuid)
returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone private.biz_tz(p_business))::date
$$;

-- A local date + time in the company's time zone, as a real moment.
create or replace function private.biz_moment(p_business uuid, p_date date, p_time time)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((p_date + p_time)::timestamp) at time zone private.biz_tz(p_business)
$$;

-- Distance in metres between two points on the map.
create or replace function private.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- The attendance rules that apply to a person (their own, else the company default, else built-in defaults).
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
    p.require_gps := false; p.require_selfie := false; p.allow_breaks := true;
  end if;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- Working out a day's numbers from its clock times
-- ---------------------------------------------------------------------
create or replace function private.recalc_attendance(p_record uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.attendance_records;
  s public.shifts;
  p public.attendance_policies;
  v_start timestamptz;
  v_end timestamptz;
  v_break int := 0;
  v_worked int := 0;
  v_late int := 0;
  v_early int := 0;
  v_ot int := 0;
  v_shift_mins int;
  v_status text;
begin
  select * into r from public.attendance_records where id = p_record;
  if not found or r.clock_in_at is null then return; end if;
  p := private.policy_for(r.business_id, r.employee_id);
  if r.shift_id is not null then
    select * into s from public.shifts where id = r.shift_id;
    v_start := private.biz_moment(r.business_id, r.work_date, s.start_time);
    v_end := private.biz_moment(r.business_id, r.work_date + case when s.crosses_midnight or s.end_time <= s.start_time then 1 else 0 end, s.end_time);
    v_shift_mins := greatest(0, (extract(epoch from (v_end - v_start)) / 60)::int - s.break_minutes);
  end if;

  select coalesce(sum(extract(epoch from (coalesce(b.ended_at, r.clock_out_at, now()) - b.started_at)) / 60), 0)::int
    into v_break from public.attendance_breaks b where b.record_id = r.id;

  -- Late: minutes after the shift started, once past the grace period.
  if v_start is not null and r.clock_in_at > v_start + make_interval(mins => p.grace_minutes) then
    v_late := (extract(epoch from (r.clock_in_at - v_start)) / 60)::int;
  end if;

  if r.clock_out_at is not null then
    v_worked := greatest(0, (extract(epoch from (r.clock_out_at - r.clock_in_at)) / 60)::int - v_break);
    if v_end is not null and r.clock_out_at < v_end - make_interval(mins => p.early_leave_minutes) then
      v_early := (extract(epoch from (v_end - r.clock_out_at)) / 60)::int;
    end if;
    if p.overtime_enabled then
      v_ot := v_worked - coalesce(v_shift_mins, (p.full_day_hours * 60)::int);
      if v_ot < p.overtime_after_minutes then v_ot := 0; end if;
    end if;
  end if;

  v_status := case
    when r.status in ('on_leave', 'holiday', 'rest_day') and r.clock_in_at is null then r.status
    when r.clock_out_at is not null and v_worked < p.half_day_min_hours * 60 then 'half_day'
    when v_late > 0 then 'late'
    else 'present' end;

  update public.attendance_records set
    break_minutes = v_break, worked_minutes = v_worked, late_minutes = v_late,
    early_leave_minutes = v_early, overtime_minutes = v_ot, status = v_status
  where id = r.id;
end $$;

-- ---------------------------------------------------------------------
-- Clocking in and out (staff app)
-- ---------------------------------------------------------------------
create or replace function public.clock_in(
  p_business uuid, p_lat double precision default null, p_lng double precision default null,
  p_accuracy double precision default null, p_selfie_path text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_today date := private.biz_today(p_business);
  p public.attendance_policies;
  re public.roster_entries;
  br public.branches;
  v_branch uuid;
  v_dist double precision;
  v_outside boolean := false;
  v_flag text;
  v_id uuid;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business and module_key = 'attendance' and enabled) then
    raise exception 'Clocking in isn''t switched on for your company' using errcode = '42501';
  end if;
  if exists (select 1 from public.attendance_records where employee_id = v_emp and clock_in_at is not null and clock_out_at is null
              and work_date >= v_today - 1) then
    raise exception 'You''re already clocked in. Clock out first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_records where employee_id = v_emp and work_date = v_today and clock_out_at is not null) then
    raise exception 'You''ve already clocked in and out today. Ask your manager to fix the times if needed.' using errcode = '22023';
  end if;

  p := private.policy_for(p_business, v_emp);
  select * into re from public.roster_entries where employee_id = v_emp and work_date = v_today;
  v_branch := coalesce(re.branch_id, (select e.branch_id from public.employees e where e.id = v_emp));
  if p.require_gps and (p_lat is null or p_lng is null) then
    raise exception 'Turn on location so we can check where you are clocking in' using errcode = '22023';
  end if;
  if p.require_selfie and p_selfie_path is null then
    raise exception 'Take a photo to clock in' using errcode = '22023';
  end if;
  if p_selfie_path is not null and p_selfie_path not like p_business::text || '/attendance/' || v_emp::text || '/%' then
    raise exception 'That photo is in the wrong folder' using errcode = '22023';
  end if;

  -- Location fence for the place they work.
  select * into br from public.branches where id = v_branch;
  if br.id is not null and br.geofence_mode <> 'off' and br.latitude is not null and br.geofence_radius_m is not null then
    if p_lat is null then
      v_outside := true;
      v_flag := 'No location given';
    else
      v_dist := private.distance_m(p_lat, p_lng, br.latitude, br.longitude);
      v_outside := v_dist > br.geofence_radius_m + least(coalesce(p_accuracy, 0), 100);
      if v_outside then v_flag := format('Clocked in %s m from %s', round(v_dist), br.name); end if;
    end if;
    if v_outside and br.geofence_mode = 'block' then
      raise exception 'You need to be at % to clock in', br.name using errcode = '22023';
    end if;
  end if;

  insert into public.attendance_records (business_id, employee_id, work_date, shift_id, branch_id, clock_in_at,
    clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_distance_m, clock_in_outside_geofence, clock_in_selfie_path,
    is_flagged, flag_reason, source, status)
  values (p_business, v_emp, v_today, re.shift_id, v_branch, now(), p_lat, p_lng, p_accuracy, v_dist, v_outside, p_selfie_path,
    v_outside, v_flag, 'portal', 'present')
  on conflict (employee_id, work_date) do update set
    clock_in_at = excluded.clock_in_at, shift_id = excluded.shift_id, branch_id = excluded.branch_id,
    clock_in_lat = excluded.clock_in_lat, clock_in_lng = excluded.clock_in_lng, clock_in_accuracy_m = excluded.clock_in_accuracy_m,
    clock_in_distance_m = excluded.clock_in_distance_m, clock_in_outside_geofence = excluded.clock_in_outside_geofence,
    clock_in_selfie_path = excluded.clock_in_selfie_path, is_flagged = excluded.is_flagged, flag_reason = excluded.flag_reason,
    status = 'present'
  returning id into v_id;
  perform private.recalc_attendance(v_id);
  return (select jsonb_build_object('id', a.id, 'late_minutes', a.late_minutes, 'flagged', a.is_flagged, 'flag_reason', a.flag_reason)
            from public.attendance_records a where a.id = v_id);
end $$;

create or replace function public.clock_out(
  p_business uuid, p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  r public.attendance_records;
  br public.branches;
  v_dist double precision;
  v_outside boolean := false;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  select * into r from public.attendance_records
   where employee_id = v_emp and business_id = p_business and clock_in_at is not null and clock_out_at is null
     and work_date >= private.biz_today(p_business) - 1
   order by clock_in_at desc limit 1;
  if not found then
    raise exception 'You''re not clocked in' using errcode = '22023';
  end if;
  update public.attendance_breaks set ended_at = now() where record_id = r.id and ended_at is null;
  select * into br from public.branches where id = r.branch_id;
  if br.id is not null and br.latitude is not null and br.geofence_radius_m is not null and p_lat is not null then
    v_dist := private.distance_m(p_lat, p_lng, br.latitude, br.longitude);
    v_outside := br.geofence_mode <> 'off' and v_dist > br.geofence_radius_m + least(coalesce(p_accuracy, 0), 100);
  end if;
  update public.attendance_records set
    clock_out_at = now(), clock_out_lat = p_lat, clock_out_lng = p_lng, clock_out_accuracy_m = p_accuracy,
    clock_out_distance_m = v_dist, clock_out_outside_geofence = v_outside,
    is_flagged = is_flagged or v_outside,
    flag_reason = case when v_outside then concat_ws('; ', flag_reason, format('Clocked out %s m away', round(v_dist))) else flag_reason end
  where id = r.id;
  perform private.recalc_attendance(r.id);
  return (select jsonb_build_object('id', a.id, 'worked_minutes', a.worked_minutes, 'overtime_minutes', a.overtime_minutes)
            from public.attendance_records a where a.id = r.id);
end $$;

-- Start or end a break (toggle).
create or replace function public.toggle_break(p_business uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  r public.attendance_records;
  v_open uuid;
begin
  select * into r from public.attendance_records
   where employee_id = v_emp and business_id = p_business and clock_in_at is not null and clock_out_at is null
   order by clock_in_at desc limit 1;
  if not found then
    raise exception 'Clock in first' using errcode = '22023';
  end if;
  if not (private.policy_for(p_business, v_emp)).allow_breaks then
    raise exception 'Breaks aren''t tracked for your shifts' using errcode = '22023';
  end if;
  select id into v_open from public.attendance_breaks where record_id = r.id and ended_at is null;
  if v_open is not null then
    update public.attendance_breaks set ended_at = now() where id = v_open;
    perform private.recalc_attendance(r.id);
    return 'ended';
  end if;
  insert into public.attendance_breaks (business_id, record_id, employee_id, started_at) values (p_business, r.id, v_emp, now());
  return 'started';
end $$;

-- ---------------------------------------------------------------------
-- Fixing a clock time: staff ask, a manager approves, the day updates.
-- ---------------------------------------------------------------------
create or replace function public.request_time_fix(
  p_business uuid, p_work_date date, p_clock_in timestamptz, p_clock_out timestamptz, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_rec uuid;
  v_id uuid;
  v_name text;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say what happened, for example "forgot to clock out"' using errcode = '22023';
  end if;
  if p_clock_in is null and p_clock_out is null then
    raise exception 'Enter the time you started, finished, or both' using errcode = '22023';
  end if;
  if p_clock_in is not null and p_clock_out is not null and p_clock_out <= p_clock_in then
    raise exception 'The finish time must be after the start time' using errcode = '22023';
  end if;
  if p_work_date > private.biz_today(p_business) or p_work_date < private.biz_today(p_business) - 60 then
    raise exception 'You can fix days from the last 60 days' using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_corrections where employee_id = v_emp and work_date = p_work_date and status = 'pending') then
    raise exception 'You already asked to fix that day. Wait for an answer, or cancel it first.' using errcode = '22023';
  end if;
  select id into v_rec from public.attendance_records where employee_id = v_emp and work_date = p_work_date;
  insert into public.attendance_corrections (business_id, employee_id, record_id, work_date, requested_clock_in, requested_clock_out, reason)
  values (p_business, v_emp, v_rec, p_work_date, p_clock_in, p_clock_out, trim(left(p_reason, 500)))
  returning id into v_id;
  select trim(first_name || ' ' || last_name) into v_name from public.employees where id = v_emp;
  perform private.create_request(p_business, 'attendance_correction', 'attendance', 'attendance_corrections', v_id, v_emp,
    'Time fix for ' || v_name || ', ' || to_char(p_work_date, 'DD Mon'),
    concat_ws(' · ',
      case when p_clock_in is not null then 'In ' || to_char(p_clock_in at time zone private.biz_tz(p_business), 'HH24:MI') end,
      case when p_clock_out is not null then 'Out ' || to_char(p_clock_out at time zone private.biz_tz(p_business), 'HH24:MI') end,
      trim(p_reason)));
  return v_id;
end $$;

-- When a time fix is approved, write the times onto the day and redo the maths.
create or replace function private.after_time_fix_decided() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_rec uuid;
  v_shift uuid;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select re.shift_id into v_shift from public.roster_entries re where re.employee_id = new.employee_id and re.work_date = new.work_date;
    insert into public.attendance_records (business_id, employee_id, work_date, shift_id, clock_in_at, clock_out_at, source)
    values (new.business_id, new.employee_id, new.work_date, v_shift, new.requested_clock_in, new.requested_clock_out, 'correction')
    on conflict (employee_id, work_date) do update set
      clock_in_at = coalesce(excluded.clock_in_at, public.attendance_records.clock_in_at),
      clock_out_at = coalesce(excluded.clock_out_at, public.attendance_records.clock_out_at),
      source = 'correction'
    returning id into v_rec;
    update public.attendance_corrections set record_id = v_rec where id = new.id and record_id is distinct from v_rec;
    perform private.recalc_attendance(v_rec);
  end if;
  return new;
end $$;
drop trigger if exists time_fix_decided on public.attendance_corrections;
create trigger time_fix_decided after update of status on public.attendance_corrections
  for each row execute function private.after_time_fix_decided();

-- Recalculate whenever an office user edits a day's times directly.
create or replace function private.after_attendance_times_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 then
    perform private.recalc_attendance(new.id);
  end if;
  return new;
end $$;
drop trigger if exists attendance_times_changed on public.attendance_records;
create trigger attendance_times_changed after insert or update of clock_in_at, clock_out_at, shift_id on public.attendance_records
  for each row execute function private.after_attendance_times_changed();

-- ---------------------------------------------------------------------
-- Timesheets: add up a period for everyone (office users with attendance edit).
-- ---------------------------------------------------------------------
create or replace function public.build_timesheets(p_business uuid, p_start date, p_end date)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int := 0;
  e record;
  t record;
  v_id uuid;
begin
  if p_business not in (select private.biz_all('attendance', 'edit')) then
    raise exception 'You don''t have permission to prepare timesheets' using errcode = '42501';
  end if;
  if p_end < p_start or p_end - p_start > 62 then
    raise exception 'Choose a period of up to two months' using errcode = '22023';
  end if;
  for e in select id from public.employees where business_id = p_business and status in ('active','probation','on_leave','suspended') loop
    select count(*) filter (where status in ('present','late')) + 0.5 * count(*) filter (where status = 'half_day') as present,
           count(*) filter (where status = 'absent') as absent,
           coalesce(sum(worked_minutes), 0) as worked, coalesce(sum(overtime_minutes), 0) as ot, coalesce(sum(late_minutes), 0) as late
      into t
      from public.attendance_records where employee_id = e.id and work_date between p_start and p_end;
    insert into public.timesheets (business_id, employee_id, period_start, period_end, days_present, days_absent, worked_minutes, overtime_minutes, late_minutes)
    values (p_business, e.id, p_start, p_end, t.present, t.absent, t.worked, t.ot, t.late)
    on conflict (employee_id, period_start, period_end) do update set
      days_present = excluded.days_present, days_absent = excluded.days_absent, worked_minutes = excluded.worked_minutes,
      overtime_minutes = excluded.overtime_minutes, late_minutes = excluded.late_minutes
      where public.timesheets.status in ('draft', 'rejected')
    returning id into v_id;
    if v_id is not null then
      update public.attendance_records set timesheet_id = v_id where employee_id = e.id and work_date between p_start and p_end;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Time off
-- ---------------------------------------------------------------------
-- Days a request uses: working days only (unless the type counts rest days / holidays), with half days.
create or replace function private.leave_days(
  p_business uuid, p_type uuid, p_start date, p_end date, p_start_half text, p_end_half text, p_branch uuid default null)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  lt public.leave_types;
  v_work smallint[];
  d date;
  v_days numeric := 0;
  v_counts boolean;
begin
  select * into lt from public.leave_types where id = p_type and business_id = p_business;
  select working_days into v_work from public.businesses where id = p_business;
  d := p_start;
  while d <= p_end loop
    v_counts := (extract(dow from d)::smallint = any(v_work)) or lt.counts_rest_days;
    if v_counts and not lt.counts_public_holidays and exists (
      select 1 from public.public_holidays h where h.business_id = p_business and h.holiday_date = d and not h.is_optional
        and (h.branch_id is null or h.branch_id = p_branch)) then
      v_counts := false;
    end if;
    if v_counts then
      v_days := v_days + case
        when d = p_start and d = p_end and (p_start_half <> 'full' or p_end_half <> 'full') then 0.5
        when d = p_start and p_start_half <> 'full' then 0.5
        when d = p_end and p_end_half <> 'full' then 0.5
        else 1 end;
    end if;
    d := d + 1;
  end loop;
  return v_days;
end $$;

-- Make sure a balance row exists for the year, and bring monthly build-up up to date.
create or replace function private.ensure_balance(p_business uuid, p_employee uuid, p_type uuid, p_year int)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  lt public.leave_types;
  v_join date;
  v_id uuid;
  v_entitled numeric;
  v_accrued numeric;
  v_months numeric;
  v_today date := private.biz_today(p_business);
  v_start_month int := 1;
begin
  select * into lt from public.leave_types where id = p_type and business_id = p_business;
  -- Nothing to do while a type or person is being removed.
  if lt.id is null or not exists (select 1 from public.employees where id = p_employee) then return null; end if;
  select join_date into v_join from public.employees where id = p_employee;
  -- People who join during the year get their share of the year.
  if v_join is not null and extract(year from v_join) = p_year then
    v_start_month := extract(month from v_join)::int;
  end if;
  v_entitled := case when lt.accrual_method = 'none' then 0
                     else round(lt.entitlement_days * (13 - v_start_month) / 12.0 * 2) / 2 end;
  if lt.accrual_method = 'monthly' then
    v_months := case when p_year < extract(year from v_today) then 12
                     when p_year > extract(year from v_today) then 0
                     else greatest(0, extract(month from v_today)::int - v_start_month + 1) end;
    v_accrued := least(v_entitled, round(lt.entitlement_days / 12.0 * v_months * 2) / 2);
  else
    v_accrued := v_entitled;
  end if;
  insert into public.leave_balances (business_id, employee_id, leave_type_id, period_year, entitled, accrued)
  values (p_business, p_employee, p_type, p_year, v_entitled, v_accrued)
  on conflict (employee_id, leave_type_id, period_year) do update set entitled = excluded.entitled, accrued = excluded.accrued
  returning id into v_id;
  return v_id;
end $$;

-- Keep balances right for every way a request changes: asked, approved, declined, cancelled, entered by HR.
create or replace function private.leave_request_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_year int;
  v_bal uuid;
  v_pending numeric := 0;
  v_taken numeric := 0;
begin
  v_year := extract(year from coalesce(new.start_date, old.start_date))::int;
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
  -- Tell the person when an office user decides their request directly.
  -- (Requests decided in the Requests list already notify, so skip those.)
  if tg_op = 'UPDATE' and new.status in ('approved', 'rejected') and old.status = 'pending'
     and not exists (select 1 from public.approval_requests ar where ar.source_table = 'leave_requests' and ar.source_id = new.id) then
    perform private.notify(new.business_id, private.user_for_employee(new.business_id, new.employee_id), 'leave.decided',
      case when new.status = 'approved' then 'Time off approved' else 'Time off declined' end,
      concat_ws(' · ', to_char(new.start_date, 'DD Mon') || case when new.end_date <> new.start_date then ' to ' || to_char(new.end_date, 'DD Mon') else '' end,
                new.decision_comment), '/staff/time-off', 'leave');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists leave_request_balance on public.leave_requests;
create trigger leave_request_balance after insert or update of status, days or delete on public.leave_requests
  for each row execute function private.leave_request_balance();

create or replace function private.leave_adjustment_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_bal uuid;
begin
  v_bal := private.ensure_balance(new.business_id, new.employee_id, new.leave_type_id, new.period_year);
  update public.leave_balances set adjusted = adjusted + new.days where id = v_bal;
  return new;
end $$;
drop trigger if exists leave_adjustment_balance on public.leave_adjustments;
create trigger leave_adjustment_balance after insert on public.leave_adjustments
  for each row execute function private.leave_adjustment_balance();

-- Can this person take this kind of leave, and how many days would it use? Shared by asking and entering.
create or replace function private.check_leave(
  p_business uuid, p_employee uuid, p_type uuid, p_start date, p_end date, p_start_half text, p_end_half text,
  p_attachment text, p_ignore uuid default null)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  lt public.leave_types;
  e public.employees;
  v_days numeric;
  v_bal public.leave_balances;
  v_available numeric;
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
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'Split time off that crosses into a new year into two requests' using errcode = '22023';
  end if;
  if (p_start_half <> 'full' or p_end_half <> 'full') and not lt.allow_half_day then
    raise exception '% can''t be taken as half days', lt.name using errcode = '22023';
  end if;
  if lt.gender_eligibility <> 'any' and e.gender is distinct from lt.gender_eligibility then
    raise exception '% isn''t available to you', lt.name using errcode = '22023';
  end if;
  if lt.min_service_months > 0 and (e.join_date is null or e.join_date > p_start - make_interval(months => lt.min_service_months)) then
    raise exception '% is available after % months of service', lt.name, lt.min_service_months using errcode = '22023';
  end if;
  if lt.eligible_contract_types is not null and not (e.contract_type = any(lt.eligible_contract_types)) then
    raise exception '% isn''t available for your type of contract', lt.name using errcode = '22023';
  end if;
  if exists (select 1 from public.leave_requests r where r.employee_id = p_employee and r.status in ('pending','approved')
              and r.id is distinct from p_ignore and r.start_date <= p_end and r.end_date >= p_start) then
    raise exception 'You already have time off on some of those days' using errcode = '22023';
  end if;
  v_days := private.leave_days(p_business, p_type, p_start, p_end, p_start_half, p_end_half, e.branch_id);
  if v_days <= 0 then
    raise exception 'Those dates are all rest days or public holidays, so no time off is needed' using errcode = '22023';
  end if;
  if lt.max_days_per_request is not null and v_days > lt.max_days_per_request then
    raise exception '% can be up to % days at a time', lt.name, lt.max_days_per_request using errcode = '22023';
  end if;
  if lt.requires_document and p_attachment is null and v_days > coalesce(lt.document_required_after_days, 0) then
    raise exception 'Add a document (for example a medical certificate) for this request' using errcode = '22023';
  end if;
  if lt.accrual_method <> 'none' then
    select * into v_bal from public.leave_balances where id = private.ensure_balance(p_business, p_employee, p_type, extract(year from p_start)::int);
    v_available := v_bal.balance - v_bal.pending;
    if v_days > v_available + (case when lt.allow_negative_balance then lt.max_negative_days else 0 end) then
      raise exception 'Not enough % left: you have % days and this needs %', lower(lt.name), greatest(v_available, 0), v_days using errcode = '22023';
    end if;
  end if;
  return v_days;
end $$;

-- Staff ask for time off. It goes through the approval steps.
create or replace function public.request_leave(
  p_business uuid, p_type uuid, p_start date, p_end date,
  p_start_half text default 'full', p_end_half text default 'full', p_reason text default null, p_attachment text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_days numeric;
  v_id uuid;
  v_type text;
  v_name text;
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
  insert into public.leave_requests (business_id, employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, reason, attachment_path, status)
  values (p_business, v_emp, p_type, p_start, p_end, p_start_half, p_end_half, v_days, nullif(trim(left(p_reason, 500)), ''), p_attachment, 'pending')
  returning id into v_id;
  select name into v_type from public.leave_types where id = p_type;
  select trim(first_name || ' ' || last_name) into v_name from public.employees where id = v_emp;
  perform private.create_request(p_business, 'leave', 'leave', 'leave_requests', v_id, v_emp,
    v_type || ' for ' || v_name,
    concat_ws(' · ', to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' to ' || to_char(p_end, 'DD Mon') else '' end,
              trim(to_char(v_days, 'FM999990.0')) || case when v_days = 1 then ' day' else ' days' end, nullif(trim(p_reason), '')),
    null, jsonb_build_object('start_date', p_start, 'end_date', p_end, 'days', v_days));
  return v_id;
end $$;

-- HR enters time off for someone (already approved, for example sick days reported by phone).
create or replace function public.record_leave(
  p_business uuid, p_employee uuid, p_type uuid, p_start date, p_end date,
  p_start_half text default 'full', p_end_half text default 'full', p_reason text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_days numeric;
  v_id uuid;
begin
  if not private.can_emp('leave', 'approve', p_business, p_employee) then
    raise exception 'You don''t have permission to enter time off for this person' using errcode = '42501';
  end if;
  v_days := private.check_leave(p_business, p_employee, p_type, p_start, p_end, p_start_half, p_end_half, 'entered-by-office');
  insert into public.leave_requests (business_id, employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, reason,
                                     status, decided_by, decided_at)
  values (p_business, p_employee, p_type, p_start, p_end, p_start_half, p_end_half, v_days, nullif(trim(left(p_reason, 500)), ''),
          'approved', auth.uid(), now())
  returning id into v_id;
  return v_id;
end $$;

-- HR cancels approved time off (for example someone came back early); the days go back.
create or replace function public.cancel_approved_leave(p_request uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_request;
  if not found or not private.can_emp('leave', 'approve', r.business_id, r.employee_id) then
    raise exception 'You don''t have permission to change this time off' using errcode = '42501';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only approved time off can be cancelled here' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add a short reason' using errcode = '22023';
  end if;
  update public.leave_requests set status = 'cancelled', decision_comment = trim(p_reason), decided_by = auth.uid(), decided_at = now()
   where id = r.id;
end $$;

-- Start a new time off year: set up balances and carry over unused days (up to each type's limit).
create or replace function public.start_leave_year(p_business uuid, p_year int)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  lt record;
  v_prev public.leave_balances;
  v_bal uuid;
  v_n int := 0;
begin
  if p_business not in (select private.biz_all('leave', 'edit')) then
    raise exception 'You don''t have permission to start a new year' using errcode = '42501';
  end if;
  for e in select id from public.employees where business_id = p_business and status in ('active','probation','on_leave','suspended') loop
    for lt in select * from public.leave_types where business_id = p_business and is_active loop
      v_bal := private.ensure_balance(p_business, e.id, lt.id, p_year);
      select * into v_prev from public.leave_balances where employee_id = e.id and leave_type_id = lt.id and period_year = p_year - 1;
      if v_prev.id is not null and lt.carry_forward_max > 0 then
        update public.leave_balances set carried_forward = least(greatest(v_prev.balance, 0), lt.carry_forward_max) where id = v_bal;
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;

-- My balances for the year (creates missing rows; staff can read their own).
create or replace function public.my_leave_balances(p_business uuid, p_year int default null)
returns table (leave_type_id uuid, name text, color text, is_paid boolean, accrual_method text, entitled numeric, accrued numeric,
               carried_forward numeric, adjusted numeric, taken numeric, pending numeric, balance numeric, allow_half_day boolean,
               requires_document boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_year int := coalesce(p_year, extract(year from private.biz_today(p_business))::int);
  lt record;
begin
  if v_emp is null then return; end if;
  for lt in select id from public.leave_types where business_id = p_business and is_active loop
    perform private.ensure_balance(p_business, v_emp, lt.id, v_year);
  end loop;
  return query
    select t.id, t.name, t.color, t.is_paid, t.accrual_method, b.entitled, b.accrued, b.carried_forward, b.adjusted, b.taken, b.pending,
           b.balance, t.allow_half_day, t.requires_document
      from public.leave_types t join public.leave_balances b on b.leave_type_id = t.id and b.employee_id = v_emp and b.period_year = v_year
     where t.business_id = p_business and t.is_active
     order by t.sort, t.name;
end $$;

-- Office view: bring everyone's balances for a year up to date (creates missing rows).
create or replace function public.refresh_leave_balances(p_business uuid, p_year int)
returns void
language plpgsql security definer set search_path = '' as $$
declare e record; lt record;
begin
  if p_business not in (select private.biz_with('leave', 'view')) then
    raise exception 'You don''t have permission to see time off' using errcode = '42501';
  end if;
  for e in select id from public.employees where business_id = p_business and status in ('active','probation','on_leave','suspended') loop
    for lt in select id from public.leave_types where business_id = p_business and is_active loop
      perform private.ensure_balance(p_business, e.id, lt.id, p_year);
    end loop;
  end loop;
end $$;

-- Staff attachments for leave go in leave/{employee}/..., already covered by the storage rules.

revoke all on function public.clock_in(uuid, double precision, double precision, double precision, text) from public, anon;
revoke all on function public.clock_out(uuid, double precision, double precision, double precision) from public, anon;
revoke all on function public.toggle_break(uuid) from public, anon;
revoke all on function public.request_time_fix(uuid, date, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.build_timesheets(uuid, date, date) from public, anon;
revoke all on function public.request_leave(uuid, uuid, date, date, text, text, text, text) from public, anon;
revoke all on function public.record_leave(uuid, uuid, uuid, date, date, text, text, text) from public, anon;
revoke all on function public.cancel_approved_leave(uuid, text) from public, anon;
revoke all on function public.start_leave_year(uuid, int) from public, anon;
revoke all on function public.my_leave_balances(uuid, int) from public, anon;
revoke all on function public.refresh_leave_balances(uuid, int) from public, anon;
grant execute on function public.clock_in(uuid, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.clock_out(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.toggle_break(uuid) to authenticated;
grant execute on function public.request_time_fix(uuid, date, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.build_timesheets(uuid, date, date) to authenticated;
grant execute on function public.request_leave(uuid, uuid, date, date, text, text, text, text) to authenticated;
grant execute on function public.record_leave(uuid, uuid, uuid, date, date, text, text, text) to authenticated;
grant execute on function public.cancel_approved_leave(uuid, text) to authenticated;
grant execute on function public.start_leave_year(uuid, int) to authenticated;
grant execute on function public.my_leave_balances(uuid, int) to authenticated;
grant execute on function public.refresh_leave_balances(uuid, int) to authenticated;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
