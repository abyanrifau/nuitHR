-- =====================================================================
-- 0002 WORKFORCE: Attendance & Time Tracking, Leave Management
-- =====================================================================

-- ---------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  code text,
  color text not null default '#64748b',
  start_time time not null,
  end_time time not null,
  second_start_time time,              -- split shifts
  second_end_time time,
  break_minutes integer not null default 60 check (break_minutes >= 0),
  crosses_midnight boolean not null default false,
  branch_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  check ((second_start_time is null) = (second_end_time is null)),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id)
);

create table public.attendance_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  grace_minutes integer not null default 10 check (grace_minutes >= 0),
  late_mark_after_minutes integer not null default 10,
  early_leave_minutes integer not null default 10,
  half_day_min_hours numeric(4,2) not null default 4,
  full_day_hours numeric(4,2) not null default 8,
  mark_absent_without_clock_in boolean not null default true,
  overtime_enabled boolean not null default true,
  overtime_after_minutes integer not null default 30,     -- minimum extra minutes before OT counts
  overtime_rate_weekday numeric(5,2) not null default 1.25,
  overtime_rate_rest_day numeric(5,2) not null default 1.5,
  overtime_rate_holiday numeric(5,2) not null default 1.5,
  require_gps boolean not null default false,
  require_selfie boolean not null default false,
  allow_breaks boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);
create unique index attendance_policies_one_default on public.attendance_policies (business_id) where is_default;

alter table public.employees
  add constraint employees_attendance_policy_fk foreign key (business_id, attendance_policy_id)
  references public.attendance_policies (business_id, id) on delete set null (attendance_policy_id);

create table public.roster_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  work_date date not null,
  shift_id uuid,
  branch_id uuid,
  is_rest_day boolean not null default false,
  notes text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (employee_id, work_date),
  check (is_rest_day or shift_id is not null),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, shift_id) references public.shifts (business_id, id) on delete cascade,
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id)
);
create index roster_entries_date_idx on public.roster_entries (business_id, work_date);

create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  period_start date not null,
  period_end date not null,
  days_present numeric(6,2) not null default 0,
  days_absent numeric(6,2) not null default 0,
  worked_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  late_minutes integer not null default 0,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected')),
  submitted_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  comment text,
  payroll_run_id uuid,                -- FK added in payroll migration
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (employee_id, period_start, period_end),
  check (period_end >= period_start),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

-- One row per employee per working day.
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  work_date date not null,
  shift_id uuid,
  branch_id uuid,
  clock_in_at timestamptz,
  clock_in_lat double precision,
  clock_in_lng double precision,
  clock_in_accuracy_m double precision,
  clock_in_distance_m double precision,
  clock_in_outside_geofence boolean not null default false,
  clock_in_selfie_path text,
  clock_out_at timestamptz,
  clock_out_lat double precision,
  clock_out_lng double precision,
  clock_out_accuracy_m double precision,
  clock_out_distance_m double precision,
  clock_out_outside_geofence boolean not null default false,
  clock_out_selfie_path text,
  break_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  status text not null default 'present'
    check (status in ('present','late','half_day','absent','on_leave','holiday','rest_day')),
  source text not null default 'portal' check (source in ('portal','manual','import','correction')),
  is_flagged boolean not null default false,
  flag_reason text,
  timesheet_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (employee_id, work_date),
  check (clock_out_at is null or clock_in_at is null or clock_out_at >= clock_in_at),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, shift_id) references public.shifts (business_id, id) on delete set null (shift_id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id),
  foreign key (business_id, timesheet_id) references public.timesheets (business_id, id) on delete set null (timesheet_id)
);
create index attendance_records_date_idx on public.attendance_records (business_id, work_date);

create table public.attendance_breaks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  record_id uuid not null,
  employee_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (ended_at is null or ended_at >= started_at),
  foreign key (business_id, record_id) references public.attendance_records (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

-- Staff ask for a missed/incorrect clock to be fixed; a manager approves.
create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  record_id uuid,
  work_date date not null,
  requested_clock_in timestamptz,
  requested_clock_out timestamptz,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (requested_clock_in is not null or requested_clock_out is not null),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, record_id) references public.attendance_records (business_id, id) on delete set null (record_id)
);

-- ---------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  code text not null,
  color text not null default '#0ea5e9',
  is_paid boolean not null default true,
  entitlement_days numeric(6,2) not null default 0 check (entitlement_days >= 0),
  accrual_method text not null default 'upfront' check (accrual_method in ('upfront','monthly','yearly','none')),
  carry_forward_max numeric(6,2) not null default 0 check (carry_forward_max >= 0),
  carry_forward_expiry_months integer,
  requires_document boolean not null default false,
  document_required_after_days numeric(6,2),
  allow_half_day boolean not null default true,
  allow_negative_balance boolean not null default false,
  max_negative_days numeric(6,2) not null default 0,
  gender_eligibility text not null default 'any' check (gender_eligibility in ('any','female','male')),
  min_service_months integer not null default 0,
  eligible_contract_types text[],      -- null = all contract types
  counts_rest_days boolean not null default false,
  counts_public_holidays boolean not null default false,
  max_days_per_request numeric(6,2),
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, code)
);

create table public.public_holidays (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  holiday_date date not null,
  country text not null default 'MV',
  branch_id uuid,                      -- null = all branches
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, holiday_date, name),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete cascade
);
create index public_holidays_date_idx on public.public_holidays (business_id, holiday_date);

create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  leave_type_id uuid not null,
  period_year integer not null,
  entitled numeric(7,2) not null default 0,
  accrued numeric(7,2) not null default 0,
  carried_forward numeric(7,2) not null default 0,
  adjusted numeric(7,2) not null default 0,
  taken numeric(7,2) not null default 0,
  pending numeric(7,2) not null default 0,
  balance numeric(7,2) generated always as (accrued + carried_forward + adjusted - taken) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (employee_id, leave_type_id, period_year),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, leave_type_id) references public.leave_types (business_id, id) on delete cascade
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  leave_type_id uuid not null,
  start_date date not null,
  end_date date not null,
  start_half text not null default 'full' check (start_half in ('full','first_half','second_half')),
  end_half text not null default 'full' check (end_half in ('full','first_half','second_half')),
  days numeric(6,2) not null check (days > 0),
  reason text,
  attachment_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  payroll_run_id uuid,                 -- set when an unpaid leave deduction is taken in payroll
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (end_date >= start_date),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, leave_type_id) references public.leave_types (business_id, id)
);
create index leave_requests_dates_idx on public.leave_requests (business_id, start_date, end_date);
create index leave_requests_emp_idx on public.leave_requests (business_id, employee_id, status);

create table public.leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  leave_type_id uuid not null,
  period_year integer not null,
  days numeric(6,2) not null check (days <> 0),
  reason text not null check (length(trim(reason)) > 0),
  adjusted_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, leave_type_id) references public.leave_types (business_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
call private.std_rls('shifts', 'roster', null, true);
call private.std_rls('roster_entries', 'roster', 'employee_id');
call private.std_rls('attendance_policies', 'attendance', null, true);
call private.std_rls('timesheets', 'attendance', 'employee_id');
call private.std_rls('attendance_records', 'attendance', 'employee_id');
call private.std_rls('attendance_breaks', 'attendance', 'employee_id');

-- Staff may raise their own correction requests (pending only); editing/deciding
-- needs the attendance 'approve' or 'edit' permission.
alter table public.attendance_corrections enable row level security;
create policy tenant_select on public.attendance_corrections for select to authenticated
  using (business_id in (select private.biz_all('attendance', 'view'))
         or employee_id in (select private.emp_scope('attendance', 'view')));
create policy tenant_insert on public.attendance_corrections for insert to authenticated
  with check (
    status = 'pending'
    and (business_id in (select private.biz_all('attendance', 'create'))
         or employee_id in (select private.emp_scope('attendance', 'create'))
         or employee_id in (select private.self_scope('attendance', 'view')))
  );
create policy tenant_update on public.attendance_corrections for update to authenticated
  using (business_id in (select private.biz_all('attendance', 'approve'))
         or employee_id in (select private.team_scope('attendance', 'approve')))
  with check (business_id in (select private.biz_all('attendance', 'approve'))
              or employee_id in (select private.team_scope('attendance', 'approve')));
create policy tenant_delete on public.attendance_corrections for delete to authenticated
  using (business_id in (select private.biz_all('attendance', 'delete')));

call private.std_rls('leave_types', 'leave', null, true);
call private.std_rls('public_holidays', 'leave', null, true);
call private.std_rls('leave_adjustments', 'leave', 'employee_id');

-- Balances are maintained by the system and by HR adjustments.
alter table public.leave_balances enable row level security;
create policy tenant_select on public.leave_balances for select to authenticated
  using (business_id in (select private.biz_all('leave', 'view'))
         or employee_id in (select private.emp_scope('leave', 'view')));
create policy tenant_write on public.leave_balances for all to authenticated
  using (business_id in (select private.biz_all('leave', 'edit')))
  with check (business_id in (select private.biz_all('leave', 'edit')));

-- Staff apply for their own leave (always as 'pending'). Deciding happens
-- through the approvals functions or by users holding leave 'edit'.
alter table public.leave_requests enable row level security;
create policy tenant_select on public.leave_requests for select to authenticated
  using (business_id in (select private.biz_all('leave', 'view'))
         or employee_id in (select private.emp_scope('leave', 'view')));
create policy tenant_insert on public.leave_requests for insert to authenticated
  with check (
    (business_id in (select private.biz_all('leave', 'create'))
     or employee_id in (select private.emp_scope('leave', 'create')))
    and (status = 'pending' or business_id in (select private.biz_all('leave', 'approve')))
  );
create policy tenant_update on public.leave_requests for update to authenticated
  using (business_id in (select private.biz_all('leave', 'edit')))
  with check (business_id in (select private.biz_all('leave', 'edit')));
create policy tenant_delete on public.leave_requests for delete to authenticated
  using (business_id in (select private.biz_all('leave', 'delete')));

create trigger audit_leave_adjustments after insert on public.leave_adjustments
  for each row execute function private.audit_row('leave', 'employee_id');

call private.finalize_tenant_tables();
