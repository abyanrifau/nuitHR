-- ONE-TIME DATABASE SETUP for a new, empty Supabase project.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Generated from supabase/migrations. Do not run twice.

create schema if not exists private;
create table if not exists private.schema_migrations (name text primary key, applied_at timestamptz not null default now());

-- ===================== 20260918000001_core.sql =====================
-- =====================================================================
-- 0001 CORE: tenancy, access control, organisation, employees,
-- approvals, documents & letters, notifications, system tables.
--
-- Tenant isolation model
--   * Every business-data table has business_id NOT NULL.
--   * Every such table has UNIQUE (business_id, id) and child tables use
--     composite foreign keys (business_id, x_id) -> parent(business_id, id)
--     so a row can never point at another tenant's data.
--   * Row Level Security is enabled on every public table (the migration
--     fails if one is missing - see private.finalize_tenant_tables()).
--   * Permission checks go through private.* helper functions that return
--     sets (business ids / employee ids) so Postgres evaluates them once
--     per query instead of once per row.
-- =====================================================================


create schema if not exists private;
grant usage on schema private to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.lock_business_id() returns trigger
language plpgsql as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'A record cannot be moved to another business' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.slugify(p text) returns text
language sql immutable as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), ''), 'business')
$$;

-- ---------------------------------------------------------------------
-- Users (profiles) and platform staff
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  avatar_path text,
  last_business_id uuid,
  two_factor_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- People who work for the software vendor (support desk). They can only
-- see a business while that business has an active support access grant.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Businesses (tenants)
-- ---------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique,
  logo_path text,
  industry text not null default 'other'
    check (industry in ('resort','guesthouse','hotel','restaurant','retail','office','construction','manufacturing','other')),
  country text not null default 'MV',
  currency text not null default 'MVR',
  timezone text not null default 'Indian/Maldives',
  date_format text not null default 'DD/MM/YYYY',
  week_start smallint not null default 0 check (week_start between 0 and 6),
  working_days smallint[] not null default '{0,1,2,3,4}',
  employee_count_range text,
  address text,
  registration_no text,
  tin text,
  phone text,
  email text,
  website text,
  -- Letterhead / branding for letters, payslips and certificates
  signature_path text,
  stamp_path text,
  signatory_name text,
  signatory_title text,
  letterhead_footer text,
  careers_page_enabled boolean not null default false,
  careers_intro text,
  plan_status text not null default 'trial' check (plan_status in ('trial','active','past_due','cancelled')),
  trial_ends_at timestamptz,
  onboarding_completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_last_business_fk foreign key (last_business_id) references public.businesses (id) on delete set null;

-- ---------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  key text,                                  -- system role key (owner, admin, ...) or null for custom roles
  name text not null,
  description text,
  is_owner boolean not null default false,   -- owners bypass the permission matrix
  is_system boolean not null default false,  -- system roles cannot be deleted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  unique (business_id, key)
);

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  role_id uuid not null,
  resource text not null,
  action text not null check (action in ('view','create','edit','approve','delete','export')),
  scope text not null default 'all' check (scope in ('all','team','own')),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (role_id, resource, action),
  foreign key (business_id, role_id) references public.roles (business_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Organisation structure
-- ---------------------------------------------------------------------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  code text,
  address text,
  atoll_island text,
  phone text,
  latitude double precision,
  longitude double precision,
  geofence_radius_m integer check (geofence_radius_m is null or geofence_radius_m > 0),
  geofence_mode text not null default 'off' check (geofence_mode in ('off','flag','block')),
  timezone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  code text,
  parent_id uuid,
  branch_id uuid,
  head_employee_id uuid,   -- FK added after employees table exists
  cost_center text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, parent_id) references public.departments (business_id, id) on delete set null (parent_id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null,
  department_id uuid,
  grade text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, title, department_id),
  foreign key (business_id, department_id) references public.departments (business_id, id) on delete set null (department_id)
);

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  employee_code text not null,
  first_name text not null,
  last_name text not null default '',
  preferred_name text,
  gender text check (gender in ('female','male','other','undisclosed')),
  date_of_birth date,
  marital_status text,
  nationality text,                    -- ISO 3166-1 alpha-2, e.g. MV, IN, BD, LK
  is_expatriate boolean not null default false,
  national_id text,
  passport_no text,
  passport_expiry date,
  personal_email text,
  work_email text,
  phone text,
  permanent_address text,
  current_address text,
  photo_path text,
  status text not null default 'active'
    check (status in ('active','probation','on_leave','suspended','resigned','terminated')),
  join_date date,
  probation_end_date date,
  confirmation_date date,
  contract_type text not null default 'permanent'
    check (contract_type in ('permanent','fixed_term','part_time','casual','intern','consultant')),
  contract_end_date date,
  branch_id uuid,
  department_id uuid,
  position_id uuid,
  manager_id uuid,
  pay_schedule_id uuid,        -- FK added in payroll migration
  attendance_policy_id uuid,   -- FK added in attendance migration
  exit_date date,
  exit_reason text,
  exit_notes text,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, employee_code),
  check (manager_id is null or manager_id <> id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id),
  foreign key (business_id, department_id) references public.departments (business_id, id) on delete set null (department_id),
  foreign key (business_id, position_id) references public.positions (business_id, id) on delete set null (position_id),
  foreign key (business_id, manager_id) references public.employees (business_id, id) on delete set null (manager_id)
);
create index employees_business_status_idx on public.employees (business_id, status);
create index employees_manager_idx on public.employees (business_id, manager_id);
create index employees_department_idx on public.employees (business_id, department_id);
create index employees_name_idx on public.employees (business_id, lower(first_name), lower(last_name));

alter table public.departments
  add constraint departments_head_fk foreign key (business_id, head_employee_id)
  references public.employees (business_id, id) on delete set null (head_employee_id);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null,
  employee_id uuid,            -- link to the employee record (for self-service / "own" scope)
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, user_id),
  unique (business_id, employee_id),
  foreign key (business_id, role_id) references public.roles (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete set null (employee_id)
);
create index business_members_user_idx on public.business_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null,
  role_id uuid not null,
  employee_id uuid,
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, role_id) references public.roles (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);
create index invitations_email_idx on public.invitations (lower(email));

create table public.employee_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  name text not null,
  relationship text,
  phone text,
  alt_phone text,
  address text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

create table public.employee_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  bank_name text not null,
  account_name text,
  account_number text not null,
  branch text,
  swift_code text,
  currency text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

-- Salary history. The "current" salary is the latest row with effective_date <= today.
create table public.employee_compensation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  effective_date date not null,
  basic_salary numeric(14,2) not null check (basic_salary >= 0),
  currency text not null default 'MVR',
  pay_basis text not null default 'monthly' check (pay_basis in ('monthly','daily','hourly')),
  reason text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (employee_id, effective_date),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  entity text not null check (entity in ('employee','compliance_item','candidate')),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  field_type text not null default 'text' check (field_type in ('text','number','date','select','boolean')),
  options jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, entity, key)
);

-- ---------------------------------------------------------------------
-- Modules & onboarding progress
-- ---------------------------------------------------------------------
create table public.business_modules (
  business_id uuid not null references public.businesses (id) on delete cascade,
  module_key text not null,
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  setup_completed_at timestamptz,
  enabled_at timestamptz default now(),
  disabled_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, module_key)
);

-- Wizard progress, saved per user so they can leave and come back.
create table public.onboarding_drafts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  business_id uuid references public.businesses (id) on delete cascade,
  current_step smallint not null default 1,
  data jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------
create table public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  request_type text not null,          -- leave, attendance_correction, timesheet, transport_claim, expense_claim, letter_request, document_request, training_sponsorship
  name text not null,
  is_default boolean not null default true,
  min_amount numeric(14,2),            -- workflow applies when amount >= min_amount (amount-based chains)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.approval_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  workflow_id uuid not null,
  step_order smallint not null,
  approver_type text not null check (approver_type in ('direct_manager','manager_of_manager','department_head','role','user')),
  approver_role_id uuid,
  approver_user_id uuid references auth.users (id) on delete set null,
  min_amount numeric(14,2),            -- step only needed when amount >= min_amount
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (workflow_id, step_order),
  foreign key (business_id, workflow_id) references public.approval_workflows (business_id, id) on delete cascade,
  foreign key (business_id, approver_role_id) references public.roles (business_id, id) on delete set null (approver_role_id)
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  request_type text not null,
  module_key text not null,
  source_table text not null,
  source_id uuid not null,
  employee_id uuid,
  requested_by uuid references auth.users (id) on delete set null,
  workflow_id uuid,
  title text not null,
  summary text,
  amount numeric(14,2),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  current_step smallint not null default 1,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (source_table, source_id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, workflow_id) references public.approval_workflows (business_id, id) on delete set null (workflow_id)
);
create index approval_requests_status_idx on public.approval_requests (business_id, status);

create table public.approval_request_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  request_id uuid not null,
  step_order smallint not null,
  approver_user_id uuid references auth.users (id) on delete set null,
  approver_role_id uuid,
  status text not null default 'waiting' check (status in ('waiting','pending','approved','rejected','skipped')),
  acted_by uuid references auth.users (id) on delete set null,
  acted_at timestamptz,
  comment text,
  delegated_from uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (request_id, step_order),
  foreign key (business_id, request_id) references public.approval_requests (business_id, id) on delete cascade,
  foreign key (business_id, approver_role_id) references public.roles (business_id, id) on delete set null (approver_role_id)
);
create index approval_request_steps_approver_idx on public.approval_request_steps (approver_user_id, status);

create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  delegator_user_id uuid not null references auth.users (id) on delete cascade,
  delegate_user_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  request_types text[],               -- null = all request types
  reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (delegator_user_id <> delegate_user_id),
  check (ends_at > starts_at)
);

-- ---------------------------------------------------------------------
-- Documents & staff letters
-- ---------------------------------------------------------------------
create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);

create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  category_id uuid,
  title text not null,
  file_path text not null,             -- storage path: {business_id}/documents/{employee_id}/...
  file_name text,
  mime_type text,
  size_bytes bigint,
  issue_date date,
  expiry_date date,
  notes text,
  visible_to_employee boolean not null default true,
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, category_id) references public.document_categories (business_id, id) on delete set null (category_id)
);
create index employee_documents_emp_idx on public.employee_documents (business_id, employee_id);

create table public.letter_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  kind text not null default 'custom'
    check (kind in ('employment_certificate','salary_certificate','warning','experience','noc','offer','custom')),
  subject text,
  body text not null default '',        -- HTML with {{merge_fields}}
  include_signature boolean not null default true,
  include_stamp boolean not null default false,
  requestable_by_staff boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);

create table public.generated_letters (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  template_id uuid,
  employee_id uuid not null,
  title text not null,
  body_rendered text not null,
  pdf_path text,
  document_id uuid,
  generated_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, template_id) references public.letter_templates (business_id, id) on delete set null (template_id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, document_id) references public.employee_documents (business_id, id) on delete set null (document_id)
);

create table public.letter_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  template_id uuid,
  purpose text,
  addressed_to text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','issued','cancelled')),
  generated_letter_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, template_id) references public.letter_templates (business_id, id) on delete set null (template_id),
  foreign key (business_id, generated_letter_id) references public.generated_letters (business_id, id) on delete set null (generated_letter_id)
);

-- ---------------------------------------------------------------------
-- Notifications & announcements
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  module_key text,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create index notifications_user_idx on public.notifications (user_id, business_id, read_at, created_at desc);

create table public.notification_preferences (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  channel text not null check (channel in ('in_app','email','sms','whatsapp')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id, event_type, channel)
);

create table public.notification_channels (
  business_id uuid not null references public.businesses (id) on delete cascade,
  channel text not null check (channel in ('in_app','email','sms','whatsapp')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,     -- non-secret settings only (sender name, reply-to...)
  last_tested_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, channel)
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  notification_id uuid,
  channel text not null,
  recipient text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, notification_id) references public.notifications (business_id, id) on delete set null (notification_id)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null,
  body text not null default '',
  branch_id uuid,
  department_id uuid,
  is_pinned boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id),
  foreign key (business_id, department_id) references public.departments (business_id, id) on delete set null (department_id)
);

-- ---------------------------------------------------------------------
-- System, security & support
-- ---------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,                -- insert/update/delete/login/finalize/...
  entity_type text,                    -- table or entity name
  entity_id uuid,
  resource text,                       -- permission resource the row belongs to (controls who may read it)
  subject_employee_id uuid,            -- employee the change is about (for "history" tabs)
  changes jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_log_business_idx on public.audit_log (business_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (business_id, entity_type, entity_id);
create index audit_log_subject_idx on public.audit_log (business_id, subject_employee_id);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  subject text not null,
  message text not null,
  category text,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  granted_by uuid default auth.uid() references auth.users (id) on delete set null,
  reason text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.data_exports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  kind text not null default 'full' check (kind in ('full','module')),
  status text not null default 'queued' check (status in ('queued','running','ready','failed','expired')),
  file_path text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

-- =====================================================================
-- Access-control helper functions (private schema, not exposed by API)
-- =====================================================================

-- Businesses the current user can access (active membership or support grant).
create or replace function private.my_business_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.business_id from public.business_members m
   where m.user_id = auth.uid() and m.status = 'active'
  union
  select g.business_id from public.support_access_grants g
   where g.revoked_at is null and g.expires_at > now()
     and exists (select 1 from public.platform_admins p where p.user_id = auth.uid())
$$;

-- The current user's scope for (resource, action) in each business.
-- scope is 'all' | 'team' | 'own' | null (no permission).
create or replace function private.my_scopes(p_resource text, p_action text)
returns table (business_id uuid, employee_id uuid, scope text)
language sql stable security definer set search_path = '' as $$
  select m.business_id, m.employee_id,
         case when r.is_owner then 'all'
              else (select rp.scope from public.role_permissions rp
                     where rp.role_id = m.role_id and rp.resource = p_resource and rp.action = p_action)
         end
    from public.business_members m
    join public.roles r on r.id = m.role_id and r.business_id = m.business_id
   where m.user_id = auth.uid() and m.status = 'active'
  union all
  -- Temporary support access is read-only.
  select g.business_id, null::uuid, 'all'
    from public.support_access_grants g
   where p_action = 'view' and g.revoked_at is null and g.expires_at > now()
     and exists (select 1 from public.platform_admins p where p.user_id = auth.uid())
$$;

-- Businesses where the user has the permission for ALL records.
create or replace function private.biz_all(p_resource text, p_action text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.business_id from private.my_scopes(p_resource, p_action) s where s.scope = 'all'
$$;

-- Businesses where the user has the permission at any scope.
create or replace function private.biz_with(p_resource text, p_action text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.business_id from private.my_scopes(p_resource, p_action) s where s.scope is not null
$$;

-- The user's own employee ids where they hold 'own' or 'team' scope.
create or replace function private.self_scope(p_resource text, p_action text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.employee_id from private.my_scopes(p_resource, p_action) s
   where s.scope in ('own','team') and s.employee_id is not null
$$;

-- Employees in the user's team (direct + indirect reports, and members of
-- departments they head) where they hold 'team' scope. Excludes self.
create or replace function private.team_scope(p_resource text, p_action text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive leads as (
    select s.business_id, s.employee_id
      from private.my_scopes(p_resource, p_action) s
     where s.scope = 'team' and s.employee_id is not null
  ), team as (
    select e.id, e.business_id
      from public.employees e
      join leads l on l.business_id = e.business_id
     where e.id <> l.employee_id
       and (e.manager_id = l.employee_id
            or e.department_id in (select d.id from public.departments d
                                    where d.business_id = l.business_id and d.head_employee_id = l.employee_id))
    union
    select e.id, e.business_id
      from public.employees e
      join team t on e.business_id = t.business_id and e.manager_id = t.id
  )
  select t.id from team t
   where t.id not in (select l.employee_id from leads l)
$$;

-- All employee ids the user can act on through 'own' or 'team' scope.
create or replace function private.emp_scope(p_resource text, p_action text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select private.self_scope(p_resource, p_action)
  union
  select private.team_scope(p_resource, p_action)
$$;

-- Single-row check, for places where a set-based policy is awkward
-- (audit log rows carry their own resource name).
create or replace function private.can_emp(p_resource text, p_action text, p_business uuid, p_employee uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_business in (select private.biz_all(p_resource, p_action))
      or (p_employee is not null and p_employee in (select private.emp_scope(p_resource, p_action)))
$$;

create or replace function private.is_owner(p_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m join public.roles r on r.id = m.role_id
     where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active' and r.is_owner)
$$;

-- User ids of people who share a business with the current user.
create or replace function private.co_member_user_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.business_members m
   where m.business_id in (select private.my_business_ids())
$$;

-- The employee records linked to the current user's logins (one per business).
create or replace function private.my_employee_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.employee_id from public.business_members m
   where m.user_id = auth.uid() and m.status = 'active' and m.employee_id is not null
$$;

-- Approval requests where the current user is (or stands in for) the approver.
create or replace function private.my_approval_request_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.request_id from public.approval_request_steps s
   where s.approver_user_id = auth.uid()
      or s.approver_user_id in (
           select d.delegator_user_id from public.approval_delegations d
            where d.delegate_user_id = auth.uid() and d.revoked_at is null
              and now() between d.starts_at and d.ends_at)
      or s.approver_role_id in (
           select m.role_id from public.business_members m
            where m.user_id = auth.uid() and m.status = 'active')
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- =====================================================================
-- Standard policy generator
--   p_emp_col   : column holding the employee id for 'own'/'team' scope
--                 (null for tables that are not about one employee)
--   p_member_read: every member of the business may read (reference data)
-- Writes on non-employee tables always need 'all' scope.
-- =====================================================================
create or replace procedure private.std_rls(p_table text, p_resource text, p_emp_col text default null, p_member_read boolean default false)
language plpgsql as $$
declare
  t text := format('public.%I', p_table);
  v_read text;
  v_create text;
  v_edit text;
  v_delete text;
begin
  execute format('alter table %s enable row level security', t);

  if p_emp_col is null then
    v_read   := format('business_id in (select private.biz_with(%L, ''view''))', p_resource);
    v_create := format('business_id in (select private.biz_all(%L, ''create''))', p_resource);
    v_edit   := format('business_id in (select private.biz_all(%L, ''edit''))', p_resource);
    v_delete := format('business_id in (select private.biz_all(%L, ''delete''))', p_resource);
  else
    v_read   := format('business_id in (select private.biz_all(%1$L, ''view'')) or %2$I in (select private.emp_scope(%1$L, ''view''))', p_resource, p_emp_col);
    v_create := format('business_id in (select private.biz_all(%1$L, ''create'')) or %2$I in (select private.emp_scope(%1$L, ''create''))', p_resource, p_emp_col);
    v_edit   := format('business_id in (select private.biz_all(%1$L, ''edit'')) or %2$I in (select private.emp_scope(%1$L, ''edit''))', p_resource, p_emp_col);
    v_delete := format('business_id in (select private.biz_all(%1$L, ''delete'')) or %2$I in (select private.emp_scope(%1$L, ''delete''))', p_resource, p_emp_col);
  end if;

  if p_member_read then
    v_read := 'business_id in (select private.my_business_ids())';
  end if;

  execute format('create policy tenant_select on %s for select to authenticated using (%s)', t, v_read);
  execute format('create policy tenant_insert on %s for insert to authenticated with check (%s)', t, v_create);
  execute format('create policy tenant_update on %s for update to authenticated using (%s) with check (%s)', t, v_edit, v_edit);
  execute format('create policy tenant_delete on %s for delete to authenticated using (%s)', t, v_delete);
end $$;

-- Run at the end of every migration: adds standard triggers to every
-- tenant table and refuses to continue if any public table lacks RLS.
create or replace procedure private.finalize_tenant_tables()
language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'updated_at')
       and not exists (select 1 from pg_trigger where tgname = 'trg_set_updated_at' and tgrelid = format('public.%I', r.relname)::regclass) then
      execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function private.set_updated_at()', r.relname);
    end if;

    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'business_id')
       and not exists (select 1 from pg_trigger where tgname = 'trg_lock_business_id' and tgrelid = format('public.%I', r.relname)::regclass) then
      execute format('create trigger trg_lock_business_id before update on public.%I for each row execute function private.lock_business_id()', r.relname);
    end if;
  end loop;

  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise exception 'Security check failed: table public.% has no Row Level Security', r.relname;
  end loop;
end $$;

-- =====================================================================
-- Audit trail
--   trigger args: (resource, employee_id column name or '')
-- =====================================================================
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  v_bid uuid;
  v_emp uuid;
begin
  select jsonb_object_agg(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k))
    into v_changes
    from jsonb_object_keys(v_row) as k
   where k not in ('updated_at','created_at')
     and (v_old -> k) is distinct from (v_new -> k);

  if tg_op = 'UPDATE' and v_changes is null then
    return new;
  end if;

  v_bid := case when tg_table_name = 'businesses' then (v_row ->> 'id')::uuid else (v_row ->> 'business_id')::uuid end;
  if coalesce(tg_argv[1], '') <> '' then
    v_emp := (v_row ->> tg_argv[1])::uuid;
  end if;

  -- Skip when the business itself is being deleted (cascade).
  if not exists (select 1 from public.businesses b where b.id = v_bid) then
    return coalesce(new, old);
  end if;

  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, resource, subject_employee_id, changes)
  values (v_bid, auth.uid(), lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid, tg_argv[0], v_emp, v_changes);

  return coalesce(new, old);
end $$;

create trigger audit_businesses after update on public.businesses
  for each row execute function private.audit_row('settings', '');
create trigger audit_employees after insert or update or delete on public.employees
  for each row execute function private.audit_row('employees', 'id');
create trigger audit_employee_compensation after insert or update or delete on public.employee_compensation
  for each row execute function private.audit_row('compensation', 'employee_id');
create trigger audit_employee_bank after insert or update or delete on public.employee_bank_accounts
  for each row execute function private.audit_row('compensation', 'employee_id');
create trigger audit_business_members after insert or update or delete on public.business_members
  for each row execute function private.audit_row('users', '');
create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function private.audit_row('roles', '');
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function private.audit_row('roles', '');
create trigger audit_business_modules after insert or update on public.business_modules
  for each row execute function private.audit_row('modules', '');
create trigger audit_support_grants after insert or update on public.support_access_grants
  for each row execute function private.audit_row('support', '');

-- =====================================================================
-- Privilege-escalation guards
--   These run as the caller (security invoker) so current_user tells us
--   who is making the change: 'authenticated' = a signed-in user talking
--   to the API directly. Trusted server code (security-definer functions,
--   the service role, migrations) runs as a different role and is allowed.
-- =====================================================================
create or replace function private.is_client_context() returns boolean
language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

create or replace function private.role_is_owner(p_role uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.is_owner from public.roles r where r.id = p_role), false)
$$;

create or replace function private.other_active_owner_exists(p_business uuid, p_exclude_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members m join public.roles r on r.id = m.role_id
                  where m.business_id = p_business and r.is_owner and m.status = 'active' and m.id <> p_exclude_member)
$$;

-- Only owners may grant/alter access to salary, payroll & role settings, or touch the owner role.
create or replace function private.guard_role_permissions() returns trigger
language plpgsql as $$
declare
  v_bid uuid := coalesce(new.business_id, old.business_id);
  v_role uuid := coalesce(new.role_id, old.role_id);
  v_resource text := coalesce(new.resource, old.resource);
begin
  if not private.is_client_context() then return coalesce(new, old); end if;
  if (v_resource in ('compensation','payroll','payslips','roles') or private.role_is_owner(v_role)
      or (tg_op = 'UPDATE' and old.resource in ('compensation','payroll','payslips','roles')))
     and not private.is_owner(v_bid) then
    raise exception 'Only the business owner can change access to salary, payroll or role settings' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_role_permissions before insert or update or delete on public.role_permissions
  for each row execute function private.guard_role_permissions();

create or replace function private.guard_roles() returns trigger
language plpgsql as $$
begin
  if not private.is_client_context() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.is_system or old.is_owner then
      raise exception 'Built-in roles cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' and (new.is_owner or new.is_system) then
    raise exception 'Custom roles cannot be marked as owner or built-in' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.is_owner <> old.is_owner or new.is_system <> old.is_system or new.key is distinct from old.key then
      raise exception 'Built-in role flags cannot be changed' using errcode = '42501';
    end if;
    if old.is_owner and not private.is_owner(old.business_id) then
      raise exception 'Only the business owner can change the Owner role' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_roles before insert or update or delete on public.roles
  for each row execute function private.guard_roles();

-- Only owners may add/remove/modify owners; there must always be an active owner.
create or replace function private.guard_business_members() returns trigger
language plpgsql as $$
declare
  v_bid uuid := coalesce(new.business_id, old.business_id);
  v_new_owner boolean := tg_op <> 'DELETE' and private.role_is_owner(new.role_id);
  v_old_owner boolean := tg_op <> 'INSERT' and private.role_is_owner(old.role_id);
begin
  -- The last-owner rule applies everywhere, including trusted server code.
  if v_old_owner
     and (tg_op = 'DELETE' or not v_new_owner or new.status <> 'active')
     and not private.other_active_owner_exists(v_bid, old.id)
     and exists (select 1 from public.businesses b where b.id = v_bid) then
    raise exception 'A business must always have at least one active owner' using errcode = '42501';
  end if;

  if not private.is_client_context() then return coalesce(new, old); end if;

  if (v_new_owner or v_old_owner) and not private.is_owner(v_bid) then
    raise exception 'Only an owner can add, change or remove an owner' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.user_id = auth.uid() and new.role_id <> old.role_id and not private.is_owner(v_bid) then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'A membership cannot be moved to another user' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_business_members before insert or update or delete on public.business_members
  for each row execute function private.guard_business_members();

-- =====================================================================
-- Row Level Security policies - core tables
-- =====================================================================

-- profiles: yourself, and people you share a business with (names/emails).
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or id in (select private.co_member_user_ids()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table public.platform_admins enable row level security;
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- businesses: members read; settings editors update; creation via create_business().
alter table public.businesses enable row level security;
create policy businesses_select on public.businesses for select to authenticated
  using (id in (select private.my_business_ids()));
create policy businesses_update on public.businesses for update to authenticated
  using (id in (select private.biz_all('settings', 'edit')))
  with check (id in (select private.biz_all('settings', 'edit')));

-- roles & permissions
call private.std_rls('roles', 'roles', null, true);
call private.std_rls('role_permissions', 'roles', null, true);

-- members: you see your own memberships; user managers see everyone.
alter table public.business_members enable row level security;
create policy tenant_select on public.business_members for select to authenticated
  using (user_id = auth.uid() or business_id in (select private.biz_with('users', 'view')));
create policy tenant_insert on public.business_members for insert to authenticated
  with check (business_id in (select private.biz_all('users', 'create')));
create policy tenant_update on public.business_members for update to authenticated
  using (business_id in (select private.biz_all('users', 'edit')))
  with check (business_id in (select private.biz_all('users', 'edit')));
create policy tenant_delete on public.business_members for delete to authenticated
  using (business_id in (select private.biz_all('users', 'delete')));

call private.std_rls('invitations', 'users');

-- modules: every member reads (the app adapts to them); only module managers change.
alter table public.business_modules enable row level security;
create policy tenant_select on public.business_modules for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy tenant_insert on public.business_modules for insert to authenticated
  with check (business_id in (select private.biz_all('modules', 'edit')));
create policy tenant_update on public.business_modules for update to authenticated
  using (business_id in (select private.biz_all('modules', 'edit')))
  with check (business_id in (select private.biz_all('modules', 'edit')));

alter table public.onboarding_drafts enable row level security;
create policy own_draft on public.onboarding_drafts for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (business_id is null or business_id in (select private.my_business_ids())));

-- organisation reference data: all members read, org managers write.
call private.std_rls('branches', 'org', null, true);
call private.std_rls('departments', 'org', null, true);
call private.std_rls('positions', 'org', null, true);
call private.std_rls('custom_field_definitions', 'settings', null, true);

-- employees & personal sub-records
call private.std_rls('employees', 'employees', 'id');
call private.std_rls('employee_emergency_contacts', 'employees', 'employee_id');
call private.std_rls('employee_bank_accounts', 'compensation', 'employee_id');
call private.std_rls('employee_compensation', 'compensation', 'employee_id');

-- approvals
call private.std_rls('approval_workflows', 'approvals', null, true);
call private.std_rls('approval_workflow_steps', 'approvals', null, true);

-- Requests are created and decided through security-definer functions
-- (added with the Approvals Inbox), so clients only get read access here.
alter table public.approval_requests enable row level security;
create policy tenant_select on public.approval_requests for select to authenticated
  using (
    requested_by = auth.uid()
    or business_id in (select private.biz_all('approvals', 'view'))
    or employee_id in (select private.emp_scope('approvals', 'view'))
    or id in (select private.my_approval_request_ids())
  );

alter table public.approval_request_steps enable row level security;
create policy tenant_select on public.approval_request_steps for select to authenticated
  using (request_id in (select r.id from public.approval_requests r));

alter table public.approval_delegations enable row level security;
create policy tenant_select on public.approval_delegations for select to authenticated
  using (delegator_user_id = auth.uid() or delegate_user_id = auth.uid()
         or business_id in (select private.biz_all('approvals', 'view')));
create policy tenant_insert on public.approval_delegations for insert to authenticated
  with check (business_id in (select private.my_business_ids())
              and (delegator_user_id = auth.uid() or business_id in (select private.biz_all('approvals', 'edit')))
              and delegate_user_id in (select m.user_id from public.business_members m
                                        where m.business_id = approval_delegations.business_id and m.status = 'active'));
create policy tenant_update on public.approval_delegations for update to authenticated
  using (delegator_user_id = auth.uid() or business_id in (select private.biz_all('approvals', 'edit')))
  with check (delegator_user_id = auth.uid() or business_id in (select private.biz_all('approvals', 'edit')));
create policy tenant_delete on public.approval_delegations for delete to authenticated
  using (delegator_user_id = auth.uid() or business_id in (select private.biz_all('approvals', 'edit')));

-- documents: staff only see their own documents when marked visible to them.
call private.std_rls('document_categories', 'documents', null, true);
alter table public.employee_documents enable row level security;
create policy tenant_select on public.employee_documents for select to authenticated
  using (
    business_id in (select private.biz_all('documents', 'view'))
    or employee_id in (select private.team_scope('documents', 'view'))
    or (visible_to_employee and employee_id in (select private.self_scope('documents', 'view')))
  );
create policy tenant_insert on public.employee_documents for insert to authenticated
  with check (business_id in (select private.biz_all('documents', 'create'))
              or employee_id in (select private.emp_scope('documents', 'create')));
create policy tenant_update on public.employee_documents for update to authenticated
  using (business_id in (select private.biz_all('documents', 'edit')) or employee_id in (select private.team_scope('documents', 'edit')))
  with check (business_id in (select private.biz_all('documents', 'edit')) or employee_id in (select private.team_scope('documents', 'edit')));
create policy tenant_delete on public.employee_documents for delete to authenticated
  using (business_id in (select private.biz_all('documents', 'delete')) or employee_id in (select private.team_scope('documents', 'delete')));

call private.std_rls('letter_templates', 'letters', null, true);
call private.std_rls('generated_letters', 'letters', 'employee_id');
call private.std_rls('letter_requests', 'letters', 'employee_id');

-- notifications: strictly personal.
alter table public.notifications enable row level security;
create policy own_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and business_id in (select private.my_business_ids()));
create policy own_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

alter table public.notification_preferences enable row level security;
create policy own_prefs on public.notification_preferences for all to authenticated
  using (user_id = auth.uid() and business_id in (select private.my_business_ids()))
  with check (user_id = auth.uid() and business_id in (select private.my_business_ids()));

alter table public.notification_channels enable row level security;
create policy tenant_select on public.notification_channels for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy tenant_write on public.notification_channels for all to authenticated
  using (business_id in (select private.biz_all('settings', 'edit')))
  with check (business_id in (select private.biz_all('settings', 'edit')));

alter table public.notification_deliveries enable row level security;
create policy tenant_select on public.notification_deliveries for select to authenticated
  using (business_id in (select private.biz_all('settings', 'view')));

-- announcements: members read published ones; editors read all and write.
alter table public.announcements enable row level security;
create policy tenant_select on public.announcements for select to authenticated
  using (
    business_id in (select private.biz_with('announcements', 'edit'))
    or (business_id in (select private.my_business_ids())
        and published_at is not null and published_at <= now()
        and (expires_at is null or expires_at > now()))
  );
create policy tenant_insert on public.announcements for insert to authenticated
  with check (business_id in (select private.biz_all('announcements', 'create')));
create policy tenant_update on public.announcements for update to authenticated
  using (business_id in (select private.biz_all('announcements', 'edit')))
  with check (business_id in (select private.biz_all('announcements', 'edit')));
create policy tenant_delete on public.announcements for delete to authenticated
  using (business_id in (select private.biz_all('announcements', 'delete')));

-- audit log: read-only; rows are written by triggers / definer functions.
alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select to authenticated
  using (
    (business_id is null and actor_id = auth.uid())
    -- Activity-log viewers see everything except salary/payroll entries,
    -- which stay limited to people who can see that salary data.
    or (business_id in (select private.biz_all('audit', 'view'))
        and (resource is null or resource not in ('compensation','payroll','payslips')))
    or (resource is not null and business_id in (select private.my_business_ids())
        and private.can_emp(resource, 'view', business_id, subject_employee_id))
  );

alter table public.support_tickets enable row level security;
create policy tenant_select on public.support_tickets for select to authenticated
  using (created_by = auth.uid() or business_id in (select private.biz_all('support', 'view')));
create policy tenant_insert on public.support_tickets for insert to authenticated
  with check (business_id in (select private.my_business_ids()) and created_by = auth.uid());

call private.std_rls('support_access_grants', 'support');
call private.std_rls('data_exports', 'data_export');

-- =====================================================================
-- Auth hooks & RPC functions
-- =====================================================================

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email, new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Creates a business with the caller as Owner, the default roles and the
-- chosen modules, all in one transaction.
--   p_business : { name, industry, country, currency, timezone, date_format, ... }
--   p_roles    : [{ key, name, description, permissions: [{ resource, action, scope }] }]
--   p_modules  : module keys to enable (core modules included by the caller)
create or replace function public.create_business(p_business jsonb, p_roles jsonb default '[]'::jsonb, p_modules text[] default '{}')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_bid uuid;
  v_owner_role uuid;
  v_role uuid;
  r jsonb;
  v_trial_days int := coalesce((p_business ->> 'trial_days')::int, 14);
begin
  if v_uid is null then
    raise exception 'You need to be signed in to create a business' using errcode = '28000';
  end if;
  if coalesce(trim(p_business ->> 'name'), '') = '' then
    raise exception 'Business name is required' using errcode = '22023';
  end if;
  if (select count(*) from public.businesses b where b.created_by = v_uid and b.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many businesses created today. Please contact support.' using errcode = '54000';
  end if;

  insert into public.businesses (
    name, slug, industry, country, currency, timezone, date_format, employee_count_range,
    address, registration_no, tin, phone, email, logo_path, created_by, trial_ends_at)
  values (
    trim(p_business ->> 'name'),
    private.slugify(p_business ->> 'name') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
    coalesce(nullif(p_business ->> 'industry', ''), 'other'),
    coalesce(nullif(p_business ->> 'country', ''), 'MV'),
    coalesce(nullif(p_business ->> 'currency', ''), 'MVR'),
    coalesce(nullif(p_business ->> 'timezone', ''), 'Indian/Maldives'),
    coalesce(nullif(p_business ->> 'date_format', ''), 'DD/MM/YYYY'),
    p_business ->> 'employee_count_range',
    p_business ->> 'address',
    p_business ->> 'registration_no',
    p_business ->> 'tin',
    p_business ->> 'phone',
    p_business ->> 'email',
    p_business ->> 'logo_path',
    v_uid,
    now() + make_interval(days => greatest(0, least(v_trial_days, 60))))
  returning id into v_bid;

    insert into public.roles (business_id, key, name, description, is_owner, is_system)
  values (v_bid, 'owner', 'Owner', 'Full access to everything, including billing and salary data.', true, true)
  returning id into v_owner_role;

  insert into public.business_members (business_id, user_id, role_id, status)
  values (v_bid, v_uid, v_owner_role, 'active');

  for r in select * from jsonb_array_elements(coalesce(p_roles, '[]'::jsonb)) loop
    continue when r ->> 'key' = 'owner';
    insert into public.roles (business_id, key, name, description, is_system)
    values (v_bid, r ->> 'key', r ->> 'name', r ->> 'description', true)
    returning id into v_role;

    insert into public.role_permissions (business_id, role_id, resource, action, scope)
    select v_bid, v_role, x ->> 'resource', x ->> 'action', coalesce(x ->> 'scope', 'all')
      from jsonb_array_elements(coalesce(r -> 'permissions', '[]'::jsonb)) x
    on conflict (role_id, resource, action) do nothing;
  end loop;

  insert into public.business_modules (business_id, module_key, enabled)
  select v_bid, m, true from unnest(coalesce(p_modules, '{}')) m
  on conflict do nothing;

  insert into public.document_categories (business_id, name, is_system)
  select v_bid, c, true
    from unnest(array['Identity','Contract','Certificates','Letters','Medical','Payroll','Other']) c;

  update public.profiles set last_business_id = v_bid where id = v_uid;

  return v_bid;
end $$;

revoke all on function public.create_business(jsonb, jsonb, text[]) from public, anon;
grant execute on function public.create_business(jsonb, jsonb, text[]) to authenticated;

-- Records a sign-in in the audit log of every business the user belongs to.
create or replace function public.log_sign_in(p_ip text default null, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, resource, ip, user_agent)
  select m.business_id, auth.uid(), 'sign_in', 'user', auth.uid(), 'users', left(p_ip, 64), left(p_user_agent, 300)
    from public.business_members m
   where m.user_id = auth.uid() and m.status = 'active';
  if not found then
    insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, ip, user_agent)
    values (null, auth.uid(), 'sign_in', 'user', auth.uid(), left(p_ip, 64), left(p_user_agent, 300));
  end if;
end $$;

revoke all on function public.log_sign_in(text, text) from public, anon;
grant execute on function public.log_sign_in(text, text) to authenticated;

-- Everything the app shell needs about the signed-in user's access in one call:
-- their businesses, role, enabled modules and permission matrix.
create or replace function public.get_my_access()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'business_id', b.id,
    'business_name', b.name,
    'logo_path', b.logo_path,
    'currency', b.currency,
    'timezone', b.timezone,
    'date_format', b.date_format,
    'country', b.country,
    'onboarding_completed_at', b.onboarding_completed_at,
    'role_id', r.id,
    'role_key', r.key,
    'role_name', r.name,
    'is_owner', r.is_owner,
    'employee_id', m.employee_id,
    'modules', coalesce((select jsonb_agg(bm.module_key order by bm.module_key)
                           from public.business_modules bm
                          where bm.business_id = b.id and bm.enabled), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(jsonb_build_object('resource', rp.resource, 'action', rp.action, 'scope', rp.scope))
                               from public.role_permissions rp where rp.role_id = r.id), '[]'::jsonb)
  ) order by b.name), '[]'::jsonb)
  from public.business_members m
  join public.businesses b on b.id = m.business_id
  join public.roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.status = 'active'
$$;

revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260918000001_core.sql') on conflict do nothing;

-- ===================== 20260918000002_workforce.sql =====================
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
insert into private.schema_migrations (name) values ('20260918000002_workforce.sql') on conflict do nothing;

-- ===================== 20260918000003_hiring_compliance.sql =====================
-- =====================================================================
-- 0003 HIRING & COMPLIANCE: Recruitment, Onboarding/Offboarding,
-- Compliance & Expiry Tracking
-- =====================================================================

-- ---------------------------------------------------------------------
-- Recruitment
-- ---------------------------------------------------------------------
create table public.vacancies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null,
  slug text not null,
  department_id uuid,
  branch_id uuid,
  position_id uuid,
  employment_type text not null default 'permanent'
    check (employment_type in ('permanent','fixed_term','part_time','casual','intern','consultant')),
  description text not null default '',
  requirements text not null default '',
  salary_min numeric(14,2),
  salary_max numeric(14,2),
  show_salary boolean not null default false,
  openings integer not null default 1 check (openings > 0),
  deadline date,
  status text not null default 'draft' check (status in ('draft','open','closed','filled')),
  is_public boolean not null default false,
  hiring_manager_user_id uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, slug),
  check (salary_max is null or salary_min is null or salary_max >= salary_min),
  foreign key (business_id, department_id) references public.departments (business_id, id) on delete set null (department_id),
  foreign key (business_id, branch_id) references public.branches (business_id, id) on delete set null (branch_id),
  foreign key (business_id, position_id) references public.positions (business_id, id) on delete set null (position_id)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  nationality text,
  current_position text,
  current_employer text,
  location text,
  cv_path text,
  source text not null default 'manual' check (source in ('manual','careers_page','referral','agency','job_board','other')),
  tags text[] not null default '{}',
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create index candidates_email_idx on public.candidates (business_id, lower(email));

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  vacancy_id uuid not null,
  candidate_id uuid not null,
  stage text not null default 'applied' check (stage in ('applied','screening','interview','offer','hired','rejected')),
  stage_position integer not null default 0,   -- order inside a kanban column
  rating smallint check (rating between 1 and 5),
  cover_letter text,
  answers jsonb not null default '{}'::jsonb,
  rejected_reason text,
  hired_employee_id uuid,
  applied_at timestamptz not null default now(),
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (vacancy_id, candidate_id),
  foreign key (business_id, vacancy_id) references public.vacancies (business_id, id) on delete cascade,
  foreign key (business_id, candidate_id) references public.candidates (business_id, id) on delete cascade,
  foreign key (business_id, hired_employee_id) references public.employees (business_id, id) on delete set null (hired_employee_id)
);

create table public.candidate_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  application_id uuid not null,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  body text not null,
  rating smallint check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, application_id) references public.applications (business_id, id) on delete cascade
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  application_id uuid not null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30,
  location text,
  meeting_link text,
  interviewer_user_ids uuid[] not null default '{}',
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  feedback text,
  rating smallint check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, application_id) references public.applications (business_id, id) on delete cascade
);

create table public.candidate_attachments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  candidate_id uuid not null,
  file_path text not null,
  file_name text not null,
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, candidate_id) references public.candidates (business_id, id) on delete cascade
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  application_id uuid not null,
  salary numeric(14,2),
  start_date date,
  position_id uuid,
  letter_body text,
  pdf_path text,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','withdrawn')),
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, application_id) references public.applications (business_id, id) on delete cascade,
  foreign key (business_id, position_id) references public.positions (business_id, id) on delete set null (position_id)
);

-- ---------------------------------------------------------------------
-- Onboarding & Offboarding
-- ---------------------------------------------------------------------
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('onboarding','offboarding')),
  department_id uuid,
  position_id uuid,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, department_id) references public.departments (business_id, id) on delete set null (department_id),
  foreign key (business_id, position_id) references public.positions (business_id, id) on delete set null (position_id)
);

create table public.checklist_template_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  template_id uuid not null,
  title text not null,
  description text,
  assignee_type text not null default 'hr' check (assignee_type in ('hr','manager','employee','user')),
  assignee_user_id uuid references auth.users (id) on delete set null,
  due_offset_days integer not null default 0,   -- days after join date (onboarding) or before exit date (offboarding)
  requires_attachment boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, template_id) references public.checklist_templates (business_id, id) on delete cascade
);

create table public.employee_checklists (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  template_id uuid,
  kind text not null check (kind in ('onboarding','offboarding')),
  status text not null default 'in_progress' check (status in ('in_progress','completed','cancelled')),
  trigger_source text not null default 'manual' check (trigger_source in ('manual','employee_created','hired','status_change')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, template_id) references public.checklist_templates (business_id, id) on delete set null (template_id)
);

create table public.employee_checklist_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  checklist_id uuid not null,
  employee_id uuid not null,
  title text not null,
  description text,
  assignee_type text not null default 'hr' check (assignee_type in ('hr','manager','employee','user')),
  assignee_user_id uuid references auth.users (id) on delete set null,
  due_date date,
  status text not null default 'todo' check (status in ('todo','done','skipped')),
  requires_attachment boolean not null default false,
  attachment_path text,
  completed_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  notes text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, checklist_id) references public.employee_checklists (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);
create index employee_checklist_tasks_assignee_idx on public.employee_checklist_tasks (assignee_user_id, status);

-- ---------------------------------------------------------------------
-- Compliance & expiry tracking
-- ---------------------------------------------------------------------
create table public.compliance_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  key text not null default 'custom'
    check (key in ('work_permit','passport','visa','contract','medical','license','insurance','custom')),
  applies_to text not null default 'all' check (applies_to in ('all','expatriates','locals')),
  remind_days_before integer[] not null default '{90,60,30,7}',
  notify_employee boolean not null default true,
  -- extra fields to capture for this type, e.g. [{"key":"permit_no","label":"Work permit number","type":"text"}]
  field_schema jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);

create table public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  type_id uuid not null,
  reference_no text,
  issued_on date,
  expires_on date,
  issuing_authority text,
  details jsonb not null default '{}'::jsonb,   -- values for the type's field_schema (permit no, employer on permit, deposit, insurance...)
  document_id uuid,
  renewal_status text not null default 'none' check (renewal_status in ('none','in_progress','renewed','not_renewing')),
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, type_id) references public.compliance_types (business_id, id) on delete cascade,
  foreign key (business_id, document_id) references public.employee_documents (business_id, id) on delete set null (document_id)
);
create index compliance_items_expiry_idx on public.compliance_items (business_id, expires_on) where not is_archived;

create table public.compliance_reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  item_id uuid not null,
  days_before integer not null,
  sent_at timestamptz not null default now(),
  unique (business_id, id),
  unique (item_id, days_before),
  foreign key (business_id, item_id) references public.compliance_items (business_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
call private.std_rls('vacancies', 'recruitment');
call private.std_rls('candidates', 'recruitment');
call private.std_rls('applications', 'recruitment');
call private.std_rls('candidate_notes', 'recruitment');
call private.std_rls('interviews', 'recruitment');
call private.std_rls('candidate_attachments', 'recruitment');
call private.std_rls('offers', 'recruitment');

call private.std_rls('checklist_templates', 'onboarding');
call private.std_rls('checklist_template_tasks', 'onboarding');
call private.std_rls('employee_checklists', 'onboarding', 'employee_id');

-- Tasks: normal permission rules, plus whoever a task is assigned to may see and complete it.
alter table public.employee_checklist_tasks enable row level security;
create policy tenant_select on public.employee_checklist_tasks for select to authenticated
  using (business_id in (select private.biz_all('onboarding', 'view'))
         or employee_id in (select private.emp_scope('onboarding', 'view'))
         or (assignee_user_id = auth.uid() and business_id in (select private.my_business_ids())));
create policy tenant_insert on public.employee_checklist_tasks for insert to authenticated
  with check (business_id in (select private.biz_all('onboarding', 'create'))
              or employee_id in (select private.team_scope('onboarding', 'create')));
create policy tenant_update on public.employee_checklist_tasks for update to authenticated
  using (business_id in (select private.biz_all('onboarding', 'edit'))
         or employee_id in (select private.team_scope('onboarding', 'edit'))
         or (assignee_user_id = auth.uid() and business_id in (select private.my_business_ids())))
  with check (business_id in (select private.biz_all('onboarding', 'edit'))
              or employee_id in (select private.team_scope('onboarding', 'edit'))
              or (assignee_user_id = auth.uid() and business_id in (select private.my_business_ids())));
create policy tenant_delete on public.employee_checklist_tasks for delete to authenticated
  using (business_id in (select private.biz_all('onboarding', 'delete')));

call private.std_rls('compliance_types', 'compliance', null, true);
call private.std_rls('compliance_items', 'compliance', 'employee_id');
call private.std_rls('compliance_reminders', 'compliance');

-- ---------------------------------------------------------------------
-- Public careers page (anonymous visitors)
-- Only these functions are reachable without signing in; they expose
-- the minimum fields needed and never the underlying tables.
-- ---------------------------------------------------------------------
create or replace function public.get_public_careers(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'business', jsonb_build_object('name', b.name, 'logo_path', b.logo_path, 'intro', b.careers_intro, 'country', b.country),
    'vacancies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'slug', v.slug, 'title', v.title, 'employment_type', v.employment_type,
               'description', v.description, 'requirements', v.requirements, 'deadline', v.deadline,
               'department', d.name, 'branch', br.name,
               'salary_min', case when v.show_salary then v.salary_min end,
               'salary_max', case when v.show_salary then v.salary_max end,
               'currency', b.currency)
             order by v.created_at desc)
        from public.vacancies v
        left join public.departments d on d.id = v.department_id
        left join public.branches br on br.id = v.branch_id
       where v.business_id = b.id and v.is_public and v.status = 'open'
         and (v.deadline is null or v.deadline >= current_date)), '[]'::jsonb))
  from public.businesses b
  where b.slug = p_slug and b.careers_page_enabled
$$;

revoke all on function public.get_public_careers(text) from public;
grant execute on function public.get_public_careers(text) to anon, authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260918000003_hiring_compliance.sql') on conflict do nothing;

-- ===================== 20260918000004_pay.sql =====================
-- =====================================================================
-- 0004 PAY: Payroll, Transport Allowance Claims, Expense Claims
-- Statutory rates live in tables per business - nothing is hard-coded.
-- =====================================================================

create table public.account_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null default 'expense' check (account_type in ('expense','liability','asset','equity','income')),
  -- Which payroll amounts post here by default, e.g. salary_expense, net_pay_payable,
  -- pension_employee_payable, pension_employer_expense, pension_employer_payable, tax_payable
  mapping_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, code)
);
create unique index account_codes_mapping_key on public.account_codes (business_id, mapping_key) where mapping_key is not null;

create table public.pay_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  frequency text not null default 'monthly' check (frequency in ('monthly','semi_monthly','biweekly','weekly')),
  period_start_day smallint not null default 1 check (period_start_day between 1 and 28),
  pay_day smallint not null default 28 check (pay_day between 1 and 31),     -- day of month (monthly) or weekday 0-6 (weekly)
  claims_cutoff_day smallint check (claims_cutoff_day between 1 and 31),      -- claims after this day roll to the next run
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);
create unique index pay_schedules_one_default on public.pay_schedules (business_id) where is_default;

alter table public.employees
  add constraint employees_pay_schedule_fk foreign key (business_id, pay_schedule_id)
  references public.pay_schedules (business_id, id) on delete set null (pay_schedule_id);

create table public.pay_components (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  code text not null,
  kind text not null check (kind in ('earning','deduction')),
  category text not null default 'allowance'
    check (category in ('allowance','service_charge','overtime','reimbursement','bonus','loan','advance','absence','statutory','other')),
  calc_type text not null default 'fixed'
    check (calc_type in ('fixed','percent_of_basic','per_day_present','per_hour_worked','manual')),
  default_amount numeric(14,2) not null default 0,
  default_percent numeric(7,4),
  is_taxable boolean not null default true,
  is_pensionable boolean not null default false,
  prorate boolean not null default true,        -- reduce for unpaid days / partial months
  show_on_payslip boolean not null default true,
  account_code_id uuid,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, code),
  foreign key (business_id, account_code_id) references public.account_codes (business_id, id) on delete set null (account_code_id)
);

create table public.employee_pay_components (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  component_id uuid not null,
  amount numeric(14,2),
  percent numeric(7,4),
  start_date date not null default current_date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (end_date is null or end_date >= start_date),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, component_id) references public.pay_components (business_id, id) on delete cascade
);

-- Pension scheme(s). Preset for the Maldives Retirement Pension Scheme, all editable.
create table public.pension_schemes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  employee_rate numeric(6,3) not null default 0 check (employee_rate between 0 and 100),
  employer_rate numeric(6,3) not null default 0 check (employer_rate between 0 and 100),
  applies_to text not null default 'locals' check (applies_to in ('all','locals','expatriates')),
  wage_base text not null default 'pensionable' check (wage_base in ('basic','pensionable','gross')),
  min_age smallint,
  max_age smallint,
  wage_ceiling numeric(14,2),
  effective_from date not null default current_date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.tax_tables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  basis text not null default 'monthly' check (basis in ('monthly','annual')),
  applies_to text not null default 'all' check (applies_to in ('all','locals','expatriates')),
  effective_from date not null default current_date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.tax_brackets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  tax_table_id uuid not null,
  lower_bound numeric(14,2) not null default 0,
  upper_bound numeric(14,2),            -- null = no upper limit
  rate numeric(6,3) not null check (rate between 0 and 100),
  fixed_amount numeric(14,2) not null default 0,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (upper_bound is null or upper_bound > lower_bound),
  foreign key (business_id, tax_table_id) references public.tax_tables (business_id, id) on delete cascade
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  pay_schedule_id uuid,
  name text not null,
  period_start date not null,
  period_end date not null,
  pay_date date not null,
  status text not null default 'draft' check (status in ('draft','calculated','finalized','paid','reversed')),
  employee_count integer not null default 0,
  total_gross numeric(16,2) not null default 0,
  total_deductions numeric(16,2) not null default 0,
  total_net numeric(16,2) not null default 0,
  total_employer_contributions numeric(16,2) not null default 0,
  calculated_at timestamptz,
  calculated_by uuid references auth.users (id) on delete set null,
  finalized_at timestamptz,
  finalized_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  reversed_at timestamptz,
  reversed_by uuid references auth.users (id) on delete set null,
  reversal_reason text,
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (period_end >= period_start),
  check (status <> 'reversed' or length(coalesce(reversal_reason, '')) > 0),
  foreign key (business_id, pay_schedule_id) references public.pay_schedules (business_id, id) on delete set null (pay_schedule_id)
);
create index payroll_runs_period_idx on public.payroll_runs (business_id, period_start desc);

alter table public.timesheets
  add constraint timesheets_payroll_run_fk foreign key (business_id, payroll_run_id)
  references public.payroll_runs (business_id, id) on delete set null (payroll_run_id);
alter table public.leave_requests
  add constraint leave_requests_payroll_run_fk foreign key (business_id, payroll_run_id)
  references public.payroll_runs (business_id, id) on delete set null (payroll_run_id);

-- One row per employee per run: the payslip header, with a snapshot of the
-- details at the time so old payslips never change when profiles change.
create table public.payroll_run_employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  run_id uuid not null,
  employee_id uuid not null,
  employee_code text,
  employee_name text not null,
  department_name text,
  position_title text,
  branch_name text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  basic_salary numeric(14,2) not null default 0,
  period_days numeric(6,2) not null default 0,
  paid_days numeric(6,2) not null default 0,
  unpaid_leave_days numeric(6,2) not null default 0,
  absent_days numeric(6,2) not null default 0,
  worked_hours numeric(8,2) not null default 0,
  overtime_hours numeric(8,2) not null default 0,
  gross_pay numeric(14,2) not null default 0,
  taxable_pay numeric(14,2) not null default 0,
  pensionable_pay numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  employer_contributions numeric(14,2) not null default 0,
  exceptions jsonb not null default '[]'::jsonb,   -- [{code, message, severity}]
  status text not null default 'included' check (status in ('included','excluded','on_hold')),
  payslip_pdf_path text,
  payslip_published_at timestamptz,              -- visible to the employee from this moment
  payslip_emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (run_id, employee_id),
  foreign key (business_id, run_id) references public.payroll_runs (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

create table public.payroll_run_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  run_id uuid not null,
  run_employee_id uuid not null,
  employee_id uuid not null,
  component_id uuid,
  code text not null,
  name text not null,
  kind text not null check (kind in ('earning','deduction','employer_contribution')),
  quantity numeric(10,2),
  rate numeric(14,4),
  amount numeric(14,2) not null,
  is_taxable boolean not null default false,
  is_pensionable boolean not null default false,
  source text not null default 'component'
    check (source in ('salary','component','overtime','leave','absence','transport_claim','expense_claim','loan','statutory','manual','adjustment')),
  source_id uuid,
  account_code text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, run_id) references public.payroll_runs (business_id, id) on delete cascade,
  foreign key (business_id, run_employee_id) references public.payroll_run_employees (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, component_id) references public.pay_components (business_id, id) on delete set null (component_id)
);
create index payroll_run_lines_run_idx on public.payroll_run_lines (business_id, run_id);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  kind text not null default 'loan' check (kind in ('loan','advance')),
  principal numeric(14,2) not null check (principal > 0),
  installment_amount numeric(14,2) not null check (installment_amount > 0),
  start_date date not null,            -- first payroll period to deduct from
  disbursed_on date,
  outstanding numeric(14,2) not null,
  status text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  reason text,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (outstanding >= 0 and outstanding <= principal),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  loan_id uuid not null,
  run_id uuid,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'payroll' check (method in ('payroll','cash','bank','waived')),
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, loan_id) references public.loans (business_id, id) on delete cascade,
  foreign key (business_id, run_id) references public.payroll_runs (business_id, id) on delete set null (run_id)
);

create table public.final_settlements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  exit_date date not null,
  last_working_day date,
  service_years numeric(6,2),
  pending_salary numeric(14,2) not null default 0,
  leave_encashment_days numeric(6,2) not null default 0,
  leave_encashment_amount numeric(14,2) not null default 0,
  gratuity_amount numeric(14,2) not null default 0,
  notice_pay numeric(14,2) not null default 0,
  other_earnings numeric(14,2) not null default 0,
  loans_outstanding numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  breakdown jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','paid','cancelled')),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  run_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, run_id) references public.payroll_runs (business_id, id) on delete set null (run_id)
);

-- ---------------------------------------------------------------------
-- Transport allowance claims
-- ---------------------------------------------------------------------
create table public.transport_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  claim_date date not null,
  route text not null,
  description text,
  amount numeric(12,2) not null check (amount > 0),
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid','cancelled')),
  target_period_start date,            -- payroll period this claim is scheduled into
  is_late boolean not null default false,
  payroll_run_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, payroll_run_id) references public.payroll_runs (business_id, id) on delete set null (payroll_run_id)
);
create index transport_claims_status_idx on public.transport_claims (business_id, status, claim_date);

-- ---------------------------------------------------------------------
-- Expense claims (reimbursable staff expenses - not supplier invoices)
-- ---------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  account_code_id uuid,
  requires_receipt boolean not null default true,
  max_amount numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, account_code_id) references public.account_codes (business_id, id) on delete set null (account_code_id)
);

create table public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  category_id uuid not null,
  expense_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'MVR',
  description text not null,
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','reimbursed','cancelled')),
  reimbursement_method text not null default 'payroll' check (reimbursement_method in ('payroll','separate')),
  payroll_run_id uuid,
  paid_at timestamptz,
  paid_reference text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, category_id) references public.expense_categories (business_id, id),
  foreign key (business_id, payroll_run_id) references public.payroll_runs (business_id, id) on delete set null (payroll_run_id)
);
create index expense_claims_status_idx on public.expense_claims (business_id, status, expense_date);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
call private.std_rls('account_codes', 'payroll');
call private.std_rls('pay_schedules', 'payroll', null, true);   -- staff need pay dates / claim cut-offs
call private.std_rls('pay_components', 'payroll');
call private.std_rls('employee_pay_components', 'compensation', 'employee_id');
call private.std_rls('pension_schemes', 'payroll');
call private.std_rls('tax_tables', 'payroll');
call private.std_rls('tax_brackets', 'payroll');
call private.std_rls('payroll_runs', 'payroll');
call private.std_rls('loans', 'compensation', 'employee_id');
call private.std_rls('loan_repayments', 'payroll');
call private.std_rls('final_settlements', 'payroll');

-- Payslips: payroll users see everything; employees see their own payslip
-- only once it has been published (after the run is finalized).
alter table public.payroll_run_employees enable row level security;
create policy tenant_select on public.payroll_run_employees for select to authenticated
  using (business_id in (select private.biz_all('payroll', 'view'))
         or business_id in (select private.biz_all('payslips', 'view'))
         or (payslip_published_at is not null and employee_id in (select private.emp_scope('payslips', 'view'))));
create policy tenant_write on public.payroll_run_employees for all to authenticated
  using (business_id in (select private.biz_all('payroll', 'edit')))
  with check (business_id in (select private.biz_all('payroll', 'edit')));

alter table public.payroll_run_lines enable row level security;
create policy tenant_select on public.payroll_run_lines for select to authenticated
  using (run_employee_id in (select pre.id from public.payroll_run_employees pre));
create policy tenant_write on public.payroll_run_lines for all to authenticated
  using (business_id in (select private.biz_all('payroll', 'edit')))
  with check (business_id in (select private.biz_all('payroll', 'edit')));

-- Finalized runs are locked: no changes to lines or payslip amounts.
create or replace function private.guard_locked_payroll() returns trigger
language plpgsql as $$
declare
  v_run uuid := coalesce(new.run_id, old.run_id);
  v_status text;
begin
  select r.status into v_status from public.payroll_runs r where r.id = v_run;
  if v_status in ('finalized','paid','reversed')
     and exists (select 1 from public.businesses b where b.id = coalesce(new.business_id, old.business_id)) then
    -- Allow publishing/emailing payslip PDFs after finalization, nothing else.
    if tg_table_name = 'payroll_run_employees' and tg_op = 'UPDATE'
       and (to_jsonb(new) - array['payslip_pdf_path','payslip_published_at','payslip_emailed_at','updated_at'])
           = (to_jsonb(old) - array['payslip_pdf_path','payslip_published_at','payslip_emailed_at','updated_at']) then
      return new;
    end if;
    raise exception 'This payroll run is finalized and locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_locked_run_employees before insert or update or delete on public.payroll_run_employees
  for each row execute function private.guard_locked_payroll();
create trigger guard_locked_run_lines before insert or update or delete on public.payroll_run_lines
  for each row execute function private.guard_locked_payroll();

-- Status changes on a run: finalized runs may only become 'paid' or 'reversed' (with a reason).
create or replace function private.guard_payroll_run_status() returns trigger
language plpgsql as $$
begin
  if old.status in ('finalized','paid') then
    if new.status = old.status then
      if (to_jsonb(new) - array['updated_at','notes']) <> (to_jsonb(old) - array['updated_at','notes']) then
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
create trigger guard_payroll_run_status before update on public.payroll_runs
  for each row execute function private.guard_payroll_run_status();

create or replace function private.guard_payroll_run_delete() returns trigger
language plpgsql as $$
begin
  if old.status in ('finalized','paid','reversed') and exists (select 1 from public.businesses b where b.id = old.business_id) then
    raise exception 'Finalized payroll runs cannot be deleted; reverse them instead' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger guard_payroll_run_delete before delete on public.payroll_runs
  for each row execute function private.guard_payroll_run_delete();

create trigger audit_payroll_runs after insert or update or delete on public.payroll_runs
  for each row execute function private.audit_row('payroll', '');
create trigger audit_pension_schemes after insert or update or delete on public.pension_schemes
  for each row execute function private.audit_row('payroll', '');
create trigger audit_tax_tables after insert or update or delete on public.tax_tables
  for each row execute function private.audit_row('payroll', '');
create trigger audit_employee_pay_components after insert or update or delete on public.employee_pay_components
  for each row execute function private.audit_row('compensation', 'employee_id');
create trigger audit_loans after insert or update or delete on public.loans
  for each row execute function private.audit_row('compensation', 'employee_id');

-- Claims: staff submit their own as 'pending'; approvers decide.
alter table public.transport_claims enable row level security;
create policy tenant_select on public.transport_claims for select to authenticated
  using (business_id in (select private.biz_all('transport_claims', 'view'))
         or employee_id in (select private.emp_scope('transport_claims', 'view')));
create policy tenant_insert on public.transport_claims for insert to authenticated
  with check ((business_id in (select private.biz_all('transport_claims', 'create'))
               or employee_id in (select private.emp_scope('transport_claims', 'create')))
              and (status = 'pending' or business_id in (select private.biz_all('transport_claims', 'approve'))));
create policy tenant_update on public.transport_claims for update to authenticated
  using (business_id in (select private.biz_all('transport_claims', 'edit')))
  with check (business_id in (select private.biz_all('transport_claims', 'edit')));
create policy tenant_delete on public.transport_claims for delete to authenticated
  using (business_id in (select private.biz_all('transport_claims', 'delete')));

call private.std_rls('expense_categories', 'expenses', null, true);
alter table public.expense_claims enable row level security;
create policy tenant_select on public.expense_claims for select to authenticated
  using (business_id in (select private.biz_all('expenses', 'view'))
         or employee_id in (select private.emp_scope('expenses', 'view')));
create policy tenant_insert on public.expense_claims for insert to authenticated
  with check ((business_id in (select private.biz_all('expenses', 'create'))
               or employee_id in (select private.emp_scope('expenses', 'create')))
              and (status = 'pending' or business_id in (select private.biz_all('expenses', 'approve'))));
create policy tenant_update on public.expense_claims for update to authenticated
  using (business_id in (select private.biz_all('expenses', 'edit')))
  with check (business_id in (select private.biz_all('expenses', 'edit')));
create policy tenant_delete on public.expense_claims for delete to authenticated
  using (business_id in (select private.biz_all('expenses', 'delete')));

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260918000004_pay.sql') on conflict do nothing;

-- ===================== 20260918000005_development.sql =====================
-- =====================================================================
-- 0005 DEVELOPMENT: Learning (LMS) and People Development (Performance)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Learning
-- ---------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null,
  description text not null default '',
  category text,
  cover_path text,
  estimated_minutes integer,
  is_mandatory boolean not null default false,
  pass_mark smallint not null default 70 check (pass_mark between 0 and 100),
  certificate_enabled boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  course_id uuid not null,
  title text not null,
  kind text not null check (kind in ('text','video','pdf','quiz')),
  content text,                        -- text lessons (HTML/markdown)
  video_url text,
  file_path text,                      -- uploaded video/PDF in storage
  pass_mark smallint check (pass_mark between 0 and 100),   -- quiz lessons; falls back to course pass mark
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, course_id) references public.courses (business_id, id) on delete cascade
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  lesson_id uuid not null,
  question text not null,
  kind text not null default 'single' check (kind in ('single','multiple','true_false')),
  options jsonb not null default '[]'::jsonb,      -- [{ "id": "a", "text": "..." }]
  points smallint not null default 1 check (points > 0),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, lesson_id) references public.course_lessons (business_id, id) on delete cascade
);

-- Correct answers are kept apart so learners can never read them.
create table public.quiz_answer_keys (
  question_id uuid primary key,
  business_id uuid not null,
  correct_option_ids text[] not null,
  explanation text,
  updated_at timestamptz not null default now(),
  unique (business_id, question_id),
  foreign key (business_id, question_id) references public.quiz_questions (business_id, id) on delete cascade
);

create table public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  course_id uuid not null,
  target_type text not null check (target_type in ('employee','department','position','branch','everyone')),
  target_id uuid,
  due_date date,
  is_mandatory boolean not null default false,
  assigned_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check ((target_type = 'everyone') = (target_id is null)),
  foreign key (business_id, course_id) references public.courses (business_id, id) on delete cascade
);

create table public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  course_id uuid not null,
  employee_id uuid not null,
  assignment_id uuid,
  due_date date,
  is_mandatory boolean not null default false,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed','failed')),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  score smallint,
  started_at timestamptz,
  completed_at timestamptz,
  certificate_path text,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (course_id, employee_id),
  foreign key (business_id, course_id) references public.courses (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, assignment_id) references public.course_assignments (business_id, id) on delete set null (assignment_id)
);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  enrollment_id uuid not null,
  employee_id uuid not null,
  lesson_id uuid not null,
  completed_at timestamptz not null default now(),
  unique (business_id, id),
  unique (enrollment_id, lesson_id),
  foreign key (business_id, enrollment_id) references public.course_enrollments (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, lesson_id) references public.course_lessons (business_id, id) on delete cascade
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  enrollment_id uuid not null,
  employee_id uuid not null,
  lesson_id uuid not null,
  answers jsonb not null default '{}'::jsonb,   -- { question_id: [option ids] }
  score smallint not null,
  passed boolean not null,
  submitted_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, enrollment_id) references public.course_enrollments (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, lesson_id) references public.course_lessons (business_id, id) on delete cascade
);

create table public.training_sponsorships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  provider text not null,
  course_name text not null,
  location text,
  start_date date,
  end_date date,
  cost numeric(14,2) not null default 0 check (cost >= 0),
  currency text not null default 'MVR',
  bond_months smallint,
  bond_end_date date,
  status text not null default 'requested'
    check (status in ('requested','approved','rejected','in_progress','completed','cancelled')),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  certificate_path text,
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (end_date is null or start_date is null or end_date >= start_date),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- People development: goals, reviews, surveys
-- ---------------------------------------------------------------------
create table public.review_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  description text,
  rating_scale jsonb not null default '[{"value":1,"label":"Needs improvement"},{"value":2,"label":"Developing"},{"value":3,"label":"Meets expectations"},{"value":4,"label":"Exceeds expectations"},{"value":5,"label":"Outstanding"}]'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);

create table public.review_questions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  template_id uuid not null,
  section text,
  question text not null,
  kind text not null default 'rating_text' check (kind in ('rating','text','rating_text')),
  audience text not null default 'all' check (audience in ('self','manager','peer','all')),
  is_required boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, template_id) references public.review_templates (business_id, id) on delete cascade
);

create table public.review_cycles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  period_type text not null default 'annual' check (period_type in ('quarterly','half_yearly','annual','custom')),
  period_start date not null,
  period_end date not null,
  self_review_due date,
  manager_review_due date,
  template_id uuid not null,
  include_peer_review boolean not null default false,
  status text not null default 'draft' check (status in ('draft','open','closed')),
  participant_filter jsonb not null default '{}'::jsonb,   -- {department_ids:[], branch_ids:[]} empty = everyone
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (period_end >= period_start),
  foreign key (business_id, template_id) references public.review_templates (business_id, id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  level text not null check (level in ('company','department','individual')),
  department_id uuid,
  employee_id uuid,
  parent_goal_id uuid,
  cycle_id uuid,
  title text not null,
  description text,
  metric text,
  target_value numeric(14,2),
  current_value numeric(14,2),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  weight smallint check (weight between 0 and 100),
  start_date date,
  due_date date,
  status text not null default 'not_started'
    check (status in ('not_started','on_track','at_risk','behind','completed','cancelled')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check ((level = 'individual') = (employee_id is not null)),
  check (level <> 'department' or department_id is not null),
  foreign key (business_id, department_id) references public.departments (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, parent_goal_id) references public.goals (business_id, id) on delete set null (parent_goal_id),
  foreign key (business_id, cycle_id) references public.review_cycles (business_id, id) on delete set null (cycle_id)
);

create table public.goal_updates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  goal_id uuid not null,
  progress_percent smallint check (progress_percent between 0 and 100),
  value numeric(14,2),
  comment text,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, goal_id) references public.goals (business_id, id) on delete cascade
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  cycle_id uuid not null,
  employee_id uuid not null,
  reviewer_employee_id uuid,
  status text not null default 'self_review'
    check (status in ('self_review','manager_review','meeting','finalized','shared','acknowledged')),
  self_submitted_at timestamptz,
  manager_submitted_at timestamptz,
  overall_rating numeric(3,1),
  manager_summary text,
  meeting_date date,
  meeting_notes text,
  finalized_at timestamptz,
  shared_at timestamptz,
  acknowledged_at timestamptz,
  employee_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (cycle_id, employee_id),
  foreign key (business_id, cycle_id) references public.review_cycles (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, reviewer_employee_id) references public.employees (business_id, id) on delete set null (reviewer_employee_id)
);

create table public.review_peers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  review_id uuid not null,
  peer_employee_id uuid not null,
  status text not null default 'pending' check (status in ('pending','submitted','declined')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (review_id, peer_employee_id),
  foreign key (business_id, review_id) references public.reviews (business_id, id) on delete cascade,
  foreign key (business_id, peer_employee_id) references public.employees (business_id, id) on delete cascade
);

create table public.review_responses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  review_id uuid not null,
  question_id uuid not null,
  respondent_type text not null check (respondent_type in ('self','manager','peer')),
  respondent_employee_id uuid,
  rating smallint,
  answer text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (review_id, question_id, respondent_type, respondent_employee_id),
  foreign key (business_id, review_id) references public.reviews (business_id, id) on delete cascade,
  foreign key (business_id, question_id) references public.review_questions (business_id, id) on delete cascade,
  foreign key (business_id, respondent_employee_id) references public.employees (business_id, id) on delete set null (respondent_employee_id)
);

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null,
  description text,
  kind text not null default 'pulse' check (kind in ('engagement','pulse','custom')),
  is_anonymous boolean not null default true,
  status text not null default 'draft' check (status in ('draft','open','closed')),
  opens_at timestamptz,
  closes_at timestamptz,
  audience jsonb not null default '{}'::jsonb,   -- {department_ids:[], branch_ids:[]} empty = everyone
  min_responses_to_show smallint not null default 3,  -- protects anonymity in small teams
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  survey_id uuid not null,
  question text not null,
  kind text not null default 'scale' check (kind in ('scale','nps','single','multiple','text')),
  options jsonb not null default '[]'::jsonb,
  is_required boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, survey_id) references public.surveys (business_id, id) on delete cascade
);

-- Who has responded (to stop double-voting) is stored separately from
-- what they answered, so anonymous answers can't be traced back.
create table public.survey_participation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  survey_id uuid not null,
  employee_id uuid not null,
  submitted_at timestamptz not null default now(),
  unique (business_id, id),
  unique (survey_id, employee_id),
  foreign key (business_id, survey_id) references public.surveys (business_id, id) on delete cascade,
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  survey_id uuid not null,
  respondent_employee_id uuid,         -- null when the survey is anonymous
  submitted_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, survey_id) references public.surveys (business_id, id) on delete cascade,
  foreign key (business_id, respondent_employee_id) references public.employees (business_id, id) on delete set null (respondent_employee_id)
);

create table public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  response_id uuid not null,
  question_id uuid not null,
  value jsonb not null,
  unique (business_id, id),
  unique (response_id, question_id),
  foreign key (business_id, response_id) references public.survey_responses (business_id, id) on delete cascade,
  foreign key (business_id, question_id) references public.survey_questions (business_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

-- Course content: managers of learning see everything; staff see published
-- courses they are enrolled in (via functions added with the Learning module).
alter table public.courses enable row level security;
create policy tenant_select on public.courses for select to authenticated
  using (business_id in (select private.biz_all('learning', 'view'))
         or (status = 'published' and id in (
               select ce.course_id from public.course_enrollments ce)));
create policy tenant_insert on public.courses for insert to authenticated
  with check (business_id in (select private.biz_all('learning', 'create')));
create policy tenant_update on public.courses for update to authenticated
  using (business_id in (select private.biz_all('learning', 'edit')))
  with check (business_id in (select private.biz_all('learning', 'edit')));
create policy tenant_delete on public.courses for delete to authenticated
  using (business_id in (select private.biz_all('learning', 'delete')));

alter table public.course_lessons enable row level security;
create policy tenant_select on public.course_lessons for select to authenticated
  using (course_id in (select c.id from public.courses c));
create policy tenant_write on public.course_lessons for all to authenticated
  using (business_id in (select private.biz_all('learning', 'edit')))
  with check (business_id in (select private.biz_all('learning', 'edit')));

alter table public.quiz_questions enable row level security;
create policy tenant_select on public.quiz_questions for select to authenticated
  using (lesson_id in (select l.id from public.course_lessons l));
create policy tenant_write on public.quiz_questions for all to authenticated
  using (business_id in (select private.biz_all('learning', 'edit')))
  with check (business_id in (select private.biz_all('learning', 'edit')));

alter table public.quiz_answer_keys enable row level security;
create policy tenant_all on public.quiz_answer_keys for all to authenticated
  using (business_id in (select private.biz_all('learning', 'edit')))
  with check (business_id in (select private.biz_all('learning', 'edit')));

call private.std_rls('course_assignments', 'learning');
call private.std_rls('course_enrollments', 'training', 'employee_id');
call private.std_rls('lesson_progress', 'training', 'employee_id');
-- Quiz attempts are written only by the grading function (answers are checked server-side).
alter table public.quiz_attempts enable row level security;
create policy tenant_select on public.quiz_attempts for select to authenticated
  using (business_id in (select private.biz_all('training', 'view'))
         or employee_id in (select private.emp_scope('training', 'view')));

call private.std_rls('training_sponsorships', 'sponsorships', 'employee_id');

call private.std_rls('review_templates', 'reviews', null, true);
call private.std_rls('review_questions', 'reviews', null, true);
call private.std_rls('review_cycles', 'reviews', null, true);

-- Goals: company goals are visible to everyone; department goals to that
-- department; individual goals follow normal own/team rules.
alter table public.goals enable row level security;
create policy tenant_select on public.goals for select to authenticated
  using (
    business_id in (select private.biz_all('goals', 'view'))
    or (level = 'company' and business_id in (select private.my_business_ids()))
    or (level = 'department' and department_id in (
          select e.department_id from public.employees e where e.id in (select private.self_scope('goals', 'view'))))
    or employee_id in (select private.emp_scope('goals', 'view'))
  );
create policy tenant_insert on public.goals for insert to authenticated
  with check (business_id in (select private.biz_all('goals', 'create'))
              or employee_id in (select private.emp_scope('goals', 'create')));
create policy tenant_update on public.goals for update to authenticated
  using (business_id in (select private.biz_all('goals', 'edit')) or employee_id in (select private.emp_scope('goals', 'edit')))
  with check (business_id in (select private.biz_all('goals', 'edit')) or employee_id in (select private.emp_scope('goals', 'edit')));
create policy tenant_delete on public.goals for delete to authenticated
  using (business_id in (select private.biz_all('goals', 'delete')) or employee_id in (select private.team_scope('goals', 'delete')));

alter table public.goal_updates enable row level security;
create policy tenant_select on public.goal_updates for select to authenticated
  using (goal_id in (select g.id from public.goals g));
create policy tenant_insert on public.goal_updates for insert to authenticated
  with check (author_id = auth.uid()
              and goal_id in (select g.id from public.goals g
                               where g.business_id in (select private.biz_all('goals', 'edit'))
                                  or g.employee_id in (select private.emp_scope('goals', 'edit'))));

-- Reviews: the employee sees their own once shared (and during self review);
-- managers see their team's; HR sees all. Writes go through review functions.
alter table public.reviews enable row level security;
create policy tenant_select on public.reviews for select to authenticated
  using (business_id in (select private.biz_all('reviews', 'view'))
         or employee_id in (select private.team_scope('reviews', 'view'))
         or employee_id in (select private.self_scope('reviews', 'view')));
create policy tenant_write on public.reviews for all to authenticated
  using (business_id in (select private.biz_all('reviews', 'edit')))
  with check (business_id in (select private.biz_all('reviews', 'edit')));

call private.std_rls('review_peers', 'reviews');

-- Responses: HR sees all; managers see their team's; employees see their own
-- self-review answers, and manager answers only after the review is shared.
alter table public.review_responses enable row level security;
create policy tenant_select on public.review_responses for select to authenticated
  using (
    business_id in (select private.biz_all('reviews', 'view'))
    or review_id in (select r.id from public.reviews r where r.employee_id in (select private.team_scope('reviews', 'view')))
    or (respondent_employee_id in (select private.self_scope('reviews', 'view')))
    or (respondent_type <> 'peer' and review_id in (
          select r.id from public.reviews r
           where r.employee_id in (select private.self_scope('reviews', 'view'))
             and r.status in ('shared','acknowledged')))
  );
create policy tenant_write on public.review_responses for all to authenticated
  using (business_id in (select private.biz_all('reviews', 'edit')))
  with check (business_id in (select private.biz_all('reviews', 'edit')));

call private.std_rls('surveys', 'surveys');
alter table public.survey_questions enable row level security;
create policy tenant_select on public.survey_questions for select to authenticated
  using (business_id in (select private.biz_all('surveys', 'view'))
         or survey_id in (select s.id from public.surveys s
                           where s.status = 'open' and s.business_id in (select private.my_business_ids())));
create policy tenant_write on public.survey_questions for all to authenticated
  using (business_id in (select private.biz_all('surveys', 'edit')))
  with check (business_id in (select private.biz_all('surveys', 'edit')));

-- Participation and answers are written only by the survey submit function.
alter table public.survey_participation enable row level security;
create policy tenant_select on public.survey_participation for select to authenticated
  using (business_id in (select private.biz_all('surveys', 'view'))
         or employee_id in (select private.my_employee_ids()));

alter table public.survey_responses enable row level security;
create policy tenant_select on public.survey_responses for select to authenticated
  using (business_id in (select private.biz_all('surveys', 'view')));

alter table public.survey_answers enable row level security;
create policy tenant_select on public.survey_answers for select to authenticated
  using (business_id in (select private.biz_all('surveys', 'view')));

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260918000005_development.sql') on conflict do nothing;

-- ===================== 20260918000006_storage.sql =====================
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
insert into private.schema_migrations (name) values ('20260918000006_storage.sql') on conflict do nothing;

-- ===================== 20260919000001_onboarding.sql =====================
-- =====================================================================
-- 0007 ONBOARDING: business profile, module switching, quick setup,
-- invitations, employee import and the getting-started checklist.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Module catalog (mirror of src/modules/registry.ts; a test keeps them in sync)
-- ---------------------------------------------------------------------
create table private.module_catalog (
  key text primary key,
  is_core boolean not null,
  requires text[] not null default '{}'
);

insert into private.module_catalog (key, is_core, requires) values
  ('employees', true, '{}'), ('approvals', true, '{}'), ('documents', true, '{}'), ('roles', true, '{}'),
  ('dashboard', true, '{}'), ('notifications', true, '{}'), ('portal', true, '{}'), ('system', true, '{}'),
  ('attendance', false, '{}'), ('leave', false, '{}'), ('recruitment', false, '{}'), ('onboarding', false, '{}'),
  ('compliance', false, '{}'), ('payroll', false, '{}'), ('transport', false, '{payroll}'), ('expenses', false, '{}'),
  ('learning', false, '{}'), ('performance', false, '{}');

-- ---------------------------------------------------------------------
-- Business profile & branches (runs as the caller, so RLS applies)
--   p_profile  : { name, industry, country, currency, timezone, date_format, employee_count_range,
--                  address, registration_no, tin, phone, email, logo_path }
--   p_branches : [{ id?, name, atoll_island? }]
-- ---------------------------------------------------------------------
create or replace function public.save_business_profile(p_business uuid, p_profile jsonb, p_branches jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  b jsonb;
  v_keep uuid[] := '{}';
  v_id uuid;
begin
  if jsonb_array_length(coalesce(p_branches, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one branch or location' using errcode = '22023';
  end if;

  update public.businesses set
    name = coalesce(nullif(trim(p_profile ->> 'name'), ''), name),
    industry = coalesce(nullif(p_profile ->> 'industry', ''), industry),
    country = coalesce(nullif(p_profile ->> 'country', ''), country),
    currency = coalesce(nullif(p_profile ->> 'currency', ''), currency),
    timezone = coalesce(nullif(p_profile ->> 'timezone', ''), timezone),
    date_format = coalesce(nullif(p_profile ->> 'date_format', ''), date_format),
    employee_count_range = p_profile ->> 'employee_count_range',
    address = nullif(trim(p_profile ->> 'address'), ''),
    registration_no = nullif(trim(p_profile ->> 'registration_no'), ''),
    tin = nullif(trim(p_profile ->> 'tin'), ''),
    phone = nullif(trim(p_profile ->> 'phone'), ''),
    email = nullif(trim(p_profile ->> 'email'), ''),
    logo_path = case when p_profile ? 'logo_path' then nullif(p_profile ->> 'logo_path', '') else logo_path end
  where id = p_business;
  if not found then
    raise exception 'You don''t have permission to change this business' using errcode = '42501';
  end if;

  for b in select * from jsonb_array_elements(p_branches) loop
    if coalesce(trim(b ->> 'name'), '') = '' then continue; end if;
    v_id := nullif(b ->> 'id', '')::uuid;
    if v_id is not null then
      update public.branches set name = trim(b ->> 'name'), atoll_island = nullif(trim(b ->> 'atoll_island'), ''), is_active = true
       where id = v_id and business_id = p_business;
      if not found then v_id := null; end if;
    end if;
    if v_id is null then
      insert into public.branches (business_id, name, atoll_island)
      values (p_business, trim(b ->> 'name'), nullif(trim(b ->> 'atoll_island'), ''))
      on conflict (business_id, name) do update set is_active = true, atoll_island = excluded.atoll_island
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  -- Branches removed from the list: delete if unused, otherwise just deactivate.
  update public.branches br set is_active = false
   where br.business_id = p_business and not (br.id = any(v_keep))
     and exists (select 1 from public.employees e where e.branch_id = br.id);
  delete from public.branches br
   where br.business_id = p_business and not (br.id = any(v_keep))
     and not exists (select 1 from public.employees e where e.branch_id = br.id);
end $$;

revoke all on function public.save_business_profile(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_business_profile(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Default data for modules that have no setup screen (idempotent)
-- ---------------------------------------------------------------------
create or replace function private.seed_module_defaults(p_business uuid, p_module text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tpl uuid;
begin
  if p_module = 'compliance' and not exists (select 1 from public.compliance_types where business_id = p_business) then
    insert into public.compliance_types (business_id, name, key, applies_to, remind_days_before, field_schema) values
      (p_business, 'Work permit', 'work_permit', 'expatriates', '{90,60,30,7}',
        '[{"key":"permit_no","label":"Work permit number","type":"text"},{"key":"employer_on_permit","label":"Employer named on permit","type":"text"},{"key":"deposit_amount","label":"Deposit amount","type":"number"},{"key":"insurance_policy_no","label":"Insurance policy number","type":"text"},{"key":"insurance_expiry","label":"Insurance expiry","type":"date"}]'::jsonb),
      (p_business, 'Passport', 'passport', 'all', '{180,90,30}', '[]'::jsonb),
      (p_business, 'Visa', 'visa', 'expatriates', '{60,30,7}', '[]'::jsonb),
      (p_business, 'Employment contract', 'contract', 'all', '{60,30,7}', '[]'::jsonb),
      (p_business, 'Medical check', 'medical', 'expatriates', '{30,7}', '[]'::jsonb),
      (p_business, 'Professional licence', 'license', 'all', '{60,30}', '[]'::jsonb);
  end if;

  if p_module = 'expenses' and not exists (select 1 from public.expense_categories where business_id = p_business) then
    insert into public.expense_categories (business_id, name, requires_receipt)
    select p_business, c, c <> 'Other' from unnest(array['Travel','Meals','Office supplies','Fuel','Phone & internet','Other']) c;
  end if;

  if p_module = 'onboarding' and not exists (select 1 from public.checklist_templates where business_id = p_business) then
    insert into public.checklist_templates (business_id, name, kind, is_default)
    values (p_business, 'Standard onboarding', 'onboarding', true) returning id into v_tpl;
    insert into public.checklist_template_tasks (business_id, template_id, title, assignee_type, due_offset_days, sort) values
      (p_business, v_tpl, 'Sign the employment contract', 'hr', 0, 1),
      (p_business, v_tpl, 'Collect ID card or passport copy', 'hr', 0, 2),
      (p_business, v_tpl, 'Prepare uniform and equipment', 'manager', 0, 3),
      (p_business, v_tpl, 'Orientation and property tour', 'manager', 1, 4),
      (p_business, v_tpl, 'Set up system access', 'hr', 1, 5),
      (p_business, v_tpl, 'Add your bank details', 'employee', 3, 6),
      (p_business, v_tpl, 'Read the staff handbook', 'employee', 7, 7);

    insert into public.checklist_templates (business_id, name, kind, is_default)
    values (p_business, 'Standard offboarding', 'offboarding', true) returning id into v_tpl;
    insert into public.checklist_template_tasks (business_id, template_id, title, assignee_type, due_offset_days, sort) values
      (p_business, v_tpl, 'Return company property (keys, uniform, devices)', 'manager', 0, 1),
      (p_business, v_tpl, 'Hold exit interview', 'hr', -2, 2),
      (p_business, v_tpl, 'Calculate final settlement', 'hr', 0, 3),
      (p_business, v_tpl, 'Remove system access', 'hr', 0, 4),
      (p_business, v_tpl, 'Clearance sign-off', 'manager', 0, 5);
  end if;

  if p_module = 'performance' and not exists (select 1 from public.review_templates where business_id = p_business) then
    insert into public.review_templates (business_id, name, description, is_default)
    values (p_business, 'Basic review', 'A simple review that works for any role.', true) returning id into v_tpl;
    insert into public.review_questions (business_id, template_id, section, question, kind, audience, sort) values
      (p_business, v_tpl, 'Performance', 'How well were goals and responsibilities met this period?', 'rating_text', 'all', 1),
      (p_business, v_tpl, 'Performance', 'Quality of work and attention to detail', 'rating', 'all', 2),
      (p_business, v_tpl, 'Teamwork', 'Works well with colleagues and guests/customers', 'rating_text', 'all', 3),
      (p_business, v_tpl, 'Growth', 'What went especially well?', 'text', 'all', 4),
      (p_business, v_tpl, 'Growth', 'What should be the focus for the next period?', 'text', 'all', 5);
  end if;

  if p_module = 'payroll' and not exists (select 1 from public.account_codes where business_id = p_business) then
    insert into public.account_codes (business_id, code, name, account_type, mapping_key) values
      (p_business, '6000', 'Salaries and wages', 'expense', 'salary_expense'),
      (p_business, '6010', 'Allowances', 'expense', 'allowance_expense'),
      (p_business, '6020', 'Overtime', 'expense', 'overtime_expense'),
      (p_business, '6030', 'Employer pension contribution', 'expense', 'pension_employer_expense'),
      (p_business, '6040', 'Staff reimbursements', 'expense', 'reimbursement_expense'),
      (p_business, '2100', 'Net salaries payable', 'liability', 'net_pay_payable'),
      (p_business, '2110', 'Pension payable', 'liability', 'pension_payable'),
      (p_business, '2120', 'Income tax payable', 'liability', 'tax_payable'),
      (p_business, '1300', 'Staff loans and advances', 'asset', 'staff_loans');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Turn modules on/off. Data is never deleted: switching a module off only
-- hides it, and switching it back on restores everything.
-- p_enabled must list every module that should be ON.
-- ---------------------------------------------------------------------
create or replace function public.set_business_modules(p_business uuid, p_enabled text[])
returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_missing text;
  v_unknown text;
  v_newly text[];
  k text;
begin
  if p_business not in (select private.biz_all('modules', 'edit')) then
    raise exception 'You don''t have permission to change modules' using errcode = '42501';
  end if;

  select string_agg(x, ', ') into v_unknown
    from unnest(p_enabled) x where x not in (select key from private.module_catalog);
  if v_unknown is not null then
    raise exception 'Unknown module: %', v_unknown using errcode = '22023';
  end if;

  select string_agg(c.key, ', ') into v_missing
    from private.module_catalog c where c.is_core and not (c.key = any(p_enabled));
  if v_missing is not null then
    raise exception 'Core modules are always included (%).', v_missing using errcode = '22023';
  end if;

  select string_agg(format('%s needs %s', c.key, r), '; ') into v_missing
    from private.module_catalog c, unnest(c.requires) r
   where c.key = any(p_enabled) and not (r = any(p_enabled));
  if v_missing is not null then
    raise exception 'Missing required module: %', v_missing using errcode = '22023';
  end if;

  select coalesce(array_agg(x), '{}') into v_newly from unnest(p_enabled) x
   where not exists (select 1 from public.business_modules bm
                      where bm.business_id = p_business and bm.module_key = x and bm.enabled);

  insert into public.business_modules (business_id, module_key, enabled, enabled_at, disabled_at)
  select p_business, x, true, now(), null from unnest(p_enabled) x
  on conflict (business_id, module_key) do update
    set enabled = true,
        enabled_at = case when public.business_modules.enabled then public.business_modules.enabled_at else now() end,
        disabled_at = null;

  update public.business_modules set enabled = false, disabled_at = now()
   where business_id = p_business and enabled and not (module_key = any(p_enabled));

  foreach k in array v_newly loop
    perform private.seed_module_defaults(p_business, k);
  end loop;

  return v_newly;
end $$;

revoke all on function public.set_business_modules(uuid, text[]) from public, anon;
grant execute on function public.set_business_modules(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- Quick setup for one module (wizard step 4, or later from Settings).
-- Only adds/updates the settings it is given; safe to run again.
-- ---------------------------------------------------------------------
create or replace function public.apply_module_setup(p_business uuid, p_module text, p_config jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_res text;
  v_act text := 'edit';
  d jsonb;
  x jsonb;
  v_dept uuid;
  v_sched uuid;
  v_tax uuid;
  v_tpl uuid;
  v_policy uuid;
begin
  v_res := case p_module
    when 'employees' then 'org'
    when 'leave' then 'leave'
    when 'attendance' then 'attendance'
    when 'payroll' then 'payroll'
    when 'transport' then 'payroll'
    when 'performance' then 'reviews'
    else null end;
  if v_res is null then
    raise exception 'Module % has no quick setup', p_module using errcode = '22023';
  end if;
  if p_module = 'employees' then v_act := 'create'; end if;
  if p_business not in (select private.biz_all(v_res, v_act)) then
    raise exception 'You don''t have permission to set up this module' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business and module_key = p_module and enabled) then
    raise exception 'Turn the module on before setting it up' using errcode = '22023';
  end if;

  -- Departments & positions -------------------------------------------
  if p_module = 'employees' then
    for d in select * from jsonb_array_elements(coalesce(p_config -> 'departments', '[]'::jsonb)) loop
      continue when coalesce(trim(d ->> 'name'), '') = '';
      insert into public.departments (business_id, name) values (p_business, trim(d ->> 'name'))
      on conflict (business_id, name) do update set is_active = true
      returning id into v_dept;
      for x in select * from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) loop
        continue when coalesce(trim(x #>> '{}'), '') = '';
        insert into public.positions (business_id, title, department_id) values (p_business, trim(x #>> '{}'), v_dept)
        on conflict (business_id, title, department_id) do nothing;
      end loop;
    end loop;
  end if;

  -- Leave types & public holidays --------------------------------------
  if p_module = 'leave' then
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'leave_types', '[]'::jsonb)) loop
      insert into public.leave_types (business_id, code, name, entitlement_days, is_paid, accrual_method,
                                      carry_forward_max, gender_eligibility, requires_document, sort)
      values (p_business, upper(x ->> 'code'), x ->> 'name', coalesce((x ->> 'days')::numeric, 0),
              coalesce((x ->> 'paid')::boolean, true), coalesce(x ->> 'accrual', 'upfront'),
              coalesce((x ->> 'carry_forward')::numeric, 0), coalesce(x ->> 'gender', 'any'),
              coalesce((x ->> 'requires_document')::boolean, false), coalesce((x ->> 'sort')::int, 0))
      on conflict (business_id, code) do update set
        name = excluded.name, entitlement_days = excluded.entitlement_days, is_paid = excluded.is_paid,
        accrual_method = excluded.accrual_method, carry_forward_max = excluded.carry_forward_max,
        gender_eligibility = excluded.gender_eligibility, requires_document = excluded.requires_document,
        is_active = true;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'holidays', '[]'::jsonb)) loop
      insert into public.public_holidays (business_id, name, holiday_date, country)
      values (p_business, x ->> 'name', (x ->> 'date')::date, coalesce(x ->> 'country', 'MV'))
      on conflict (business_id, holiday_date, name) do nothing;
    end loop;
  end if;

  -- Shifts & attendance rules ------------------------------------------
  if p_module = 'attendance' then
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'shifts', '[]'::jsonb)) loop
      insert into public.shifts (business_id, name, start_time, end_time, break_minutes, crosses_midnight, color)
      values (p_business, x ->> 'name', (x ->> 'start')::time, (x ->> 'end')::time,
              coalesce((x ->> 'break_minutes')::int, 60), (x ->> 'end')::time <= (x ->> 'start')::time,
              coalesce(x ->> 'color', '#64748b'))
      on conflict (business_id, name) do update set
        start_time = excluded.start_time, end_time = excluded.end_time, break_minutes = excluded.break_minutes,
        crosses_midnight = excluded.crosses_midnight, is_active = true;
    end loop;
    if p_config ? 'policy' then
      x := p_config -> 'policy';
      select id into v_policy from public.attendance_policies where business_id = p_business and is_default;
      if v_policy is null then
        insert into public.attendance_policies (business_id, name, is_default) values (p_business, 'Standard rules', true)
        returning id into v_policy;
      end if;
      update public.attendance_policies set
        grace_minutes = coalesce((x ->> 'grace_minutes')::int, grace_minutes),
        late_mark_after_minutes = coalesce((x ->> 'grace_minutes')::int, late_mark_after_minutes),
        half_day_min_hours = coalesce((x ->> 'half_day_min_hours')::numeric, half_day_min_hours),
        full_day_hours = coalesce((x ->> 'full_day_hours')::numeric, full_day_hours),
        overtime_enabled = coalesce((x ->> 'overtime_enabled')::boolean, overtime_enabled),
        overtime_after_minutes = coalesce((x ->> 'overtime_after_minutes')::int, overtime_after_minutes),
        overtime_rate_weekday = coalesce((x ->> 'overtime_rate_weekday')::numeric, overtime_rate_weekday),
        overtime_rate_rest_day = coalesce((x ->> 'overtime_rate_rest_day')::numeric, overtime_rate_rest_day),
        overtime_rate_holiday = coalesce((x ->> 'overtime_rate_holiday')::numeric, overtime_rate_holiday),
        require_gps = coalesce((x ->> 'require_gps')::boolean, require_gps),
        require_selfie = coalesce((x ->> 'require_selfie')::boolean, require_selfie)
      where id = v_policy;
    end if;
  end if;

  -- Pay cycle, pension, tax, pay components ----------------------------
  if p_module = 'payroll' then
    perform private.seed_module_defaults(p_business, 'payroll');
    if p_config ? 'schedule' then
      x := p_config -> 'schedule';
      select id into v_sched from public.pay_schedules where business_id = p_business and is_default;
      if v_sched is null then
        insert into public.pay_schedules (business_id, name, frequency, pay_day, period_start_day, is_default)
        values (p_business, coalesce(x ->> 'name', 'Monthly payroll'), coalesce(x ->> 'frequency', 'monthly'),
                coalesce((x ->> 'pay_day')::smallint, 28), coalesce((x ->> 'period_start_day')::smallint, 1), true);
      else
        update public.pay_schedules set
          frequency = coalesce(x ->> 'frequency', frequency),
          pay_day = coalesce((x ->> 'pay_day')::smallint, pay_day),
          period_start_day = coalesce((x ->> 'period_start_day')::smallint, period_start_day)
        where id = v_sched;
      end if;
    end if;
    if p_config ? 'pension' then
      x := p_config -> 'pension';
      update public.pension_schemes set is_active = false where business_id = p_business and is_active;
      insert into public.pension_schemes (business_id, name, employee_rate, employer_rate, applies_to, notes)
      values (p_business, x ->> 'name', (x ->> 'employee_rate')::numeric, (x ->> 'employer_rate')::numeric,
              coalesce(x ->> 'applies_to', 'locals'), x ->> 'note');
    end if;
    if p_config ? 'tax' then
      x := p_config -> 'tax';
      update public.tax_tables set is_active = false where business_id = p_business and is_active;
      insert into public.tax_tables (business_id, name, basis, notes)
      values (p_business, x ->> 'name', coalesce(x ->> 'basis', 'monthly'), x ->> 'note')
      returning id into v_tax;
      insert into public.tax_brackets (business_id, tax_table_id, lower_bound, upper_bound, rate, sort)
      select p_business, v_tax, (br ->> 'lower')::numeric, nullif(br ->> 'upper', '')::numeric, (br ->> 'rate')::numeric, ord::int
        from jsonb_array_elements(coalesce(x -> 'brackets', '[]'::jsonb)) with ordinality as t(br, ord);
    end if;
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'components', '[]'::jsonb)) loop
      insert into public.pay_components (business_id, code, name, kind, category, is_taxable, is_pensionable, calc_type, sort)
      values (p_business, upper(x ->> 'code'), x ->> 'name', coalesce(x ->> 'kind', 'earning'), coalesce(x ->> 'category', 'allowance'),
              coalesce((x ->> 'taxable')::boolean, true), coalesce((x ->> 'pensionable')::boolean, false),
              coalesce(x ->> 'calc_type', 'fixed'), coalesce((x ->> 'sort')::int, 0))
      on conflict (business_id, code) do nothing;
    end loop;
  end if;

  -- Claim cut-off day ---------------------------------------------------
  if p_module = 'transport' then
    update public.pay_schedules set claims_cutoff_day = (p_config ->> 'claims_cutoff_day')::smallint
     where business_id = p_business and is_default;
    if not found then
      raise exception 'Set up the payroll pay cycle first' using errcode = '22023';
    end if;
  end if;

  -- First review cycle --------------------------------------------------
  if p_module = 'performance' then
    perform private.seed_module_defaults(p_business, 'performance');
    if p_config ? 'cycle' then
      x := p_config -> 'cycle';
      select id into v_tpl from public.review_templates where business_id = p_business order by is_default desc, created_at limit 1;
      -- Saving again updates the same draft cycle instead of creating a copy.
      update public.review_cycles set
        period_type = coalesce(x ->> 'period_type', 'annual'), period_start = (x ->> 'period_start')::date,
        period_end = (x ->> 'period_end')::date, self_review_due = nullif(x ->> 'self_review_due', '')::date,
        manager_review_due = nullif(x ->> 'manager_review_due', '')::date
      where business_id = p_business and status = 'draft' and lower(name) = lower(trim(x ->> 'name'));
      if not found then
        insert into public.review_cycles (business_id, name, period_type, period_start, period_end,
                                          self_review_due, manager_review_due, template_id)
        values (p_business, trim(x ->> 'name'), coalesce(x ->> 'period_type', 'annual'), (x ->> 'period_start')::date,
                (x ->> 'period_end')::date, nullif(x ->> 'self_review_due', '')::date,
                nullif(x ->> 'manager_review_due', '')::date, v_tpl);
      end if;
    end if;
  end if;

  update public.business_modules set setup_completed_at = now()
   where business_id = p_business and module_key = p_module;
end $$;

revoke all on function public.apply_module_setup(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_module_setup(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Employee import (one or many), all-or-nothing. Runs as the caller.
--   p_rows: [{ employee_code?, first_name, last_name?, work_email?, phone?, department?, position?,
--              branch?, join_date?, gender?, nationality?, is_expatriate?, contract_type?, manager_code? }]
-- Missing departments/positions are created; branches must already exist.
-- ---------------------------------------------------------------------
create or replace function private.next_employee_code(p_business uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select 'E' || lpad((coalesce(max((regexp_match(employee_code, '^E(\d+)$'))[1]::int), 0) + 1)::text, 4, '0')
    from public.employees where business_id = p_business
$$;

create or replace function public.import_employees(p_business uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb;
  v_dept uuid;
  v_pos uuid;
  v_branch uuid;
  v_code text;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_line int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_line := v_line + 1;
    v_dept := null; v_pos := null; v_branch := null;

    if coalesce(trim(r ->> 'department'), '') <> '' then
      select id into v_dept from public.departments where business_id = p_business and lower(name) = lower(trim(r ->> 'department'));
      if v_dept is null then
        insert into public.departments (business_id, name) values (p_business, trim(r ->> 'department')) returning id into v_dept;
      end if;
    end if;
    if coalesce(trim(r ->> 'position'), '') <> '' then
      select id into v_pos from public.positions
       where business_id = p_business and lower(title) = lower(trim(r ->> 'position'))
         and department_id is not distinct from v_dept;
      if v_pos is null then
        insert into public.positions (business_id, title, department_id) values (p_business, trim(r ->> 'position'), v_dept)
        returning id into v_pos;
      end if;
    end if;
    if coalesce(trim(r ->> 'branch'), '') <> '' then
      select id into v_branch from public.branches where business_id = p_business and lower(name) = lower(trim(r ->> 'branch'));
      if v_branch is null then
        raise exception 'Row %: branch "%" doesn''t exist', v_line, r ->> 'branch' using errcode = '22023';
      end if;
    end if;

    v_code := coalesce(nullif(trim(r ->> 'employee_code'), ''), private.next_employee_code(p_business));
    begin
      insert into public.employees (business_id, employee_code, first_name, last_name, work_email, phone, department_id,
                                    position_id, branch_id, join_date, probation_end_date, gender, nationality, is_expatriate, contract_type, status)
      values (p_business, v_code, trim(r ->> 'first_name'), coalesce(trim(r ->> 'last_name'), ''),
              nullif(lower(trim(r ->> 'work_email')), ''), nullif(trim(r ->> 'phone'), ''), v_dept, v_pos, v_branch,
              nullif(r ->> 'join_date', '')::date, nullif(r ->> 'probation_end_date', '')::date, nullif(r ->> 'gender', ''), nullif(upper(r ->> 'nationality'), ''),
              coalesce((r ->> 'is_expatriate')::boolean, false), coalesce(nullif(r ->> 'contract_type', ''), 'permanent'),
              case when nullif(r ->> 'probation_end_date', '') is not null then 'probation' else 'active' end)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Row %: employee ID "%" is already used', v_line, v_code using errcode = '23505';
    end;
    v_out := v_out || jsonb_build_object('line', v_line, 'id', v_id, 'employee_code', v_code,
                                         'manager_code', nullif(trim(r ->> 'manager_code'), ''));
  end loop;

  -- Second pass: reporting lines (managers may appear anywhere in the file).
  for r in select * from jsonb_array_elements(v_out) loop
    continue when r ->> 'manager_code' is null;
    update public.employees e set manager_id = m.id
      from public.employees m
     where e.id = (r ->> 'id')::uuid and m.business_id = p_business and m.employee_code = r ->> 'manager_code';
    if not found then
      raise exception 'Row %: manager ID "%" not found', r ->> 'line', r ->> 'manager_code' using errcode = '22023';
    end if;
  end loop;

  return v_out;
end $$;

revoke all on function public.import_employees(uuid, jsonb) from public, anon;
grant execute on function public.import_employees(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------
-- Only owners may invite someone as an owner.
create or replace function private.guard_invitations() returns trigger
language plpgsql as $$
begin
  if private.is_client_context() and private.role_is_owner(new.role_id) and not private.is_owner(new.business_id) then
    raise exception 'Only an owner can invite another owner' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_invitations before insert or update on public.invitations
  for each row execute function private.guard_invitations();

create or replace function private.token_hash(p_token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- What the invitation page shows before signing in. Reveals nothing unless you hold the link.
create or replace function public.get_invitation_preview(p_token text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'business_name', b.name,
    'role_name', r.name,
    'email', i.email,
    'status', case when i.revoked_at is not null then 'revoked'
                   when i.accepted_at is not null then 'accepted'
                   when i.expires_at < now() then 'expired'
                   else 'valid' end)
  from public.invitations i
  join public.businesses b on b.id = i.business_id
  join public.roles r on r.id = i.role_id
  where i.token_hash = private.token_hash(p_token)
$$;
revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invitations;
  v_email text;
  v_linked uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to accept the invitation' using errcode = '28000';
  end if;
  select * into inv from public.invitations where token_hash = private.token_hash(p_token) for update;
  if not found then
    raise exception 'This invitation link isn''t valid' using errcode = '22023';
  end if;
  if inv.revoked_at is not null then
    raise exception 'This invitation was cancelled. Ask for a new one.' using errcode = '22023';
  end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then return inv.business_id; end if;
    raise exception 'This invitation has already been used' using errcode = '22023';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = '22023';
  end if;

  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from lower(inv.email) then
    raise exception 'This invitation was sent to %. Sign in with that email address to accept it.', inv.email using errcode = '42501';
  end if;

  if inv.employee_id is not null then
    select user_id into v_linked from public.business_members
     where business_id = inv.business_id and employee_id = inv.employee_id;
    if v_linked is not null and v_linked <> auth.uid() then
      raise exception 'This employee is already linked to another account' using errcode = '23505';
    end if;
  end if;

  insert into public.business_members (business_id, user_id, role_id, employee_id, status)
  values (inv.business_id, auth.uid(), inv.role_id, inv.employee_id, 'active')
  on conflict (business_id, user_id) do update
    set status = 'active',
        employee_id = coalesce(public.business_members.employee_id, excluded.employee_id);

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  update public.profiles set last_business_id = inv.business_id where id = auth.uid();
  return inv.business_id;
end $$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------
-- Getting-started checklist: which setup items are done (booleans only).
-- ---------------------------------------------------------------------
create or replace function public.get_setup_checklist(p_business uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_business not in (select private.my_business_ids()) then '{}'::jsonb else jsonb_build_object(
    'system.profile', (select address is not null and phone is not null from public.businesses where id = p_business),
    'documents.branding', (select logo_path is not null from public.businesses where id = p_business),
    'org.departments', exists (select 1 from public.departments where business_id = p_business),
    'employees.first', exists (select 1 from public.employees where business_id = p_business),
    'roles.invite', (select count(*) > 1 from public.business_members where business_id = p_business)
                    or exists (select 1 from public.invitations where business_id = p_business and revoked_at is null),
    'approvals.chains', exists (select 1 from public.approval_workflows where business_id = p_business),
    'notifications.test', exists (select 1 from public.notification_channels where business_id = p_business and last_tested_at is not null),
    'portal.announcement', exists (select 1 from public.announcements where business_id = p_business),
    'attendance.shifts', exists (select 1 from public.shifts where business_id = p_business),
    'attendance.geofence', exists (select 1 from public.branches where business_id = p_business and latitude is not null),
    'leave.types', exists (select 1 from public.leave_types where business_id = p_business),
    'leave.holidays', exists (select 1 from public.public_holidays where business_id = p_business),
    'recruitment.vacancy', exists (select 1 from public.vacancies where business_id = p_business),
    'onboarding.template', exists (select 1 from public.checklist_templates where business_id = p_business and kind = 'onboarding'),
    'compliance.items', exists (select 1 from public.compliance_items where business_id = p_business),
    'payroll.schedule', exists (select 1 from public.pay_schedules where business_id = p_business),
    'payroll.statutory', exists (select 1 from public.pension_schemes where business_id = p_business)
                         and exists (select 1 from public.tax_tables where business_id = p_business),
    'payroll.salaries', exists (select 1 from public.employee_compensation where business_id = p_business),
    'transport.cutoff', exists (select 1 from public.pay_schedules where business_id = p_business and claims_cutoff_day is not null),
    'expenses.categories', exists (select 1 from public.expense_categories where business_id = p_business),
    'learning.course', exists (select 1 from public.courses where business_id = p_business),
    'performance.cycle', exists (select 1 from public.review_cycles where business_id = p_business)
  ) end
$$;
revoke all on function public.get_setup_checklist(uuid) from public, anon;
grant execute on function public.get_setup_checklist(uuid) to authenticated;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260919000001_onboarding.sql') on conflict do nothing;

-- ===================== 20260919000002_tools_restructure.sql =====================
-- =====================================================================
-- 0008 TOOLS RESTRUCTURE
--   * Transport allowance claims + Expense claims become one "Claims" tool.
--     Transport is a built-in claim type next to meals, travel, supplies
--     and any custom types a business creates. Each type has its own rules.
--   * Claims no longer needs Payroll.
--   * Existing data is copied, never deleted: old claim tables stay as a
--     read-only archive, and every old claim appears under Claims.
--   * contact_messages stores the public contact form.
-- Internal keys (attendance, leave, recruitment...) stay the same; only
-- the names people see changed.
-- =====================================================================

create table public.claim_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  key text not null default 'custom' check (key in ('transport','meals','travel','supplies','custom')),
  cutoff_day smallint check (cutoff_day between 1 and 28),       -- claims after this day move to the next payroll
  max_amount numeric(12,2) check (max_amount is null or max_amount > 0),
  requires_receipt boolean not null default true,
  payout_method text not null default 'payroll' check (payout_method in ('payroll','separate')),
  account_code_id uuid,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, account_code_id) references public.account_codes (business_id, id) on delete set null (account_code_id)
);
create unique index claim_types_one_per_builtin on public.claim_types (business_id, key) where key <> 'custom';

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  claim_type_id uuid not null,
  claim_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'MVR',
  description text,
  route text,                                   -- transport: from/to
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid','cancelled')),
  -- 'payroll' = added to the next payroll run; 'separate' = paid outside payroll.
  -- Approved + not paid + (separate, or Payroll switched off) shows as "to be paid".
  payout_method text not null default 'payroll' check (payout_method in ('payroll','separate')),
  target_period_start date,
  is_late boolean not null default false,
  payroll_run_id uuid,
  paid_at timestamptz,
  paid_reference text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  legacy_source text check (legacy_source in ('transport_claims','expense_claims')),
  legacy_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (legacy_source, legacy_id),
  foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade,
  foreign key (business_id, claim_type_id) references public.claim_types (business_id, id),
  foreign key (business_id, payroll_run_id) references public.payroll_runs (business_id, id) on delete set null (payroll_run_id)
);
create index claims_status_idx on public.claims (business_id, status, claim_date);
create index claims_employee_idx on public.claims (business_id, employee_id);

-- Public contact form (written only by the server; nobody can read it through the API).
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  phone text,
  message text not null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.contact_messages enable row level security;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
call private.std_rls('claim_types', 'claims', null, true);

alter table public.claims enable row level security;
create policy tenant_select on public.claims for select to authenticated
  using (business_id in (select private.biz_all('claims', 'view'))
         or employee_id in (select private.emp_scope('claims', 'view')));
-- Staff submit their own claims, always as 'pending'.
create policy tenant_insert on public.claims for insert to authenticated
  with check ((business_id in (select private.biz_all('claims', 'create'))
               or employee_id in (select private.emp_scope('claims', 'create')))
              and (status = 'pending' or business_id in (select private.biz_all('claims', 'approve'))));
create policy tenant_update on public.claims for update to authenticated
  using (business_id in (select private.biz_all('claims', 'edit')))
  with check (business_id in (select private.biz_all('claims', 'edit')));
create policy tenant_delete on public.claims for delete to authenticated
  using (business_id in (select private.biz_all('claims', 'delete')));

create trigger audit_claims after update or delete on public.claims
  for each row execute function private.audit_row('claims', 'employee_id');

-- The old claim tables become a read-only archive (their rows are copied into claims below).
drop policy if exists tenant_select on public.transport_claims;
drop policy if exists tenant_insert on public.transport_claims;
drop policy if exists tenant_update on public.transport_claims;
drop policy if exists tenant_delete on public.transport_claims;
create policy archive_select on public.transport_claims for select to authenticated
  using (business_id in (select private.biz_all('claims', 'view'))
         or employee_id in (select private.emp_scope('claims', 'view')));

drop policy if exists tenant_select on public.expense_claims;
drop policy if exists tenant_insert on public.expense_claims;
drop policy if exists tenant_update on public.expense_claims;
drop policy if exists tenant_delete on public.expense_claims;
create policy archive_select on public.expense_claims for select to authenticated
  using (business_id in (select private.biz_all('claims', 'view'))
         or employee_id in (select private.emp_scope('claims', 'view')));

drop policy if exists tenant_select on public.expense_categories;
drop policy if exists tenant_insert on public.expense_categories;
drop policy if exists tenant_update on public.expense_categories;
drop policy if exists tenant_delete on public.expense_categories;
create policy archive_select on public.expense_categories for select to authenticated
  using (business_id in (select private.my_business_ids()));

-- Payroll lines may now come from a claim.
alter table public.payroll_run_lines drop constraint if exists payroll_run_lines_source_check;
alter table public.payroll_run_lines add constraint payroll_run_lines_source_check
  check (source in ('salary','component','overtime','leave','absence','claim','transport_claim','expense_claim','loan','statutory','manual','adjustment'));

-- ---------------------------------------------------------------------
-- Tool list: Transport + Expenses become Claims
-- ---------------------------------------------------------------------
delete from private.module_catalog where key in ('transport', 'expenses');
insert into private.module_catalog (key, is_core, requires) values ('claims', false, '{}')
on conflict (key) do update set requires = '{}';


-- Starter claim types are added the first time Claims is switched on.

create or replace function private.seed_module_defaults(p_business uuid, p_module text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tpl uuid;
begin
  if p_module = 'compliance' and not exists (select 1 from public.compliance_types where business_id = p_business) then
    insert into public.compliance_types (business_id, name, key, applies_to, remind_days_before, field_schema) values
      (p_business, 'Work permit', 'work_permit', 'expatriates', '{90,60,30,7}',
        '[{"key":"permit_no","label":"Work permit number","type":"text"},{"key":"employer_on_permit","label":"Employer named on permit","type":"text"},{"key":"deposit_amount","label":"Deposit amount","type":"number"},{"key":"insurance_policy_no","label":"Insurance policy number","type":"text"},{"key":"insurance_expiry","label":"Insurance expiry","type":"date"}]'::jsonb),
      (p_business, 'Passport', 'passport', 'all', '{180,90,30}', '[]'::jsonb),
      (p_business, 'Visa', 'visa', 'expatriates', '{60,30,7}', '[]'::jsonb),
      (p_business, 'Employment contract', 'contract', 'all', '{60,30,7}', '[]'::jsonb),
      (p_business, 'Medical check', 'medical', 'expatriates', '{30,7}', '[]'::jsonb),
      (p_business, 'Professional licence', 'license', 'all', '{60,30}', '[]'::jsonb);
  end if;

  if p_module = 'expenses' and not exists (select 1 from public.expense_categories where business_id = p_business) then
    insert into public.expense_categories (business_id, name, requires_receipt)
    select p_business, c, c <> 'Other' from unnest(array['Travel','Meals','Office supplies','Fuel','Phone & internet','Other']) c;
  end if;

  if p_module = 'onboarding' and not exists (select 1 from public.checklist_templates where business_id = p_business) then
    insert into public.checklist_templates (business_id, name, kind, is_default)
    values (p_business, 'Standard onboarding', 'onboarding', true) returning id into v_tpl;
    insert into public.checklist_template_tasks (business_id, template_id, title, assignee_type, due_offset_days, sort) values
      (p_business, v_tpl, 'Sign the employment contract', 'hr', 0, 1),
      (p_business, v_tpl, 'Collect ID card or passport copy', 'hr', 0, 2),
      (p_business, v_tpl, 'Prepare uniform and equipment', 'manager', 0, 3),
      (p_business, v_tpl, 'Orientation and property tour', 'manager', 1, 4),
      (p_business, v_tpl, 'Set up system access', 'hr', 1, 5),
      (p_business, v_tpl, 'Add your bank details', 'employee', 3, 6),
      (p_business, v_tpl, 'Read the staff handbook', 'employee', 7, 7);

    insert into public.checklist_templates (business_id, name, kind, is_default)
    values (p_business, 'Standard offboarding', 'offboarding', true) returning id into v_tpl;
    insert into public.checklist_template_tasks (business_id, template_id, title, assignee_type, due_offset_days, sort) values
      (p_business, v_tpl, 'Return company property (keys, uniform, devices)', 'manager', 0, 1),
      (p_business, v_tpl, 'Hold exit interview', 'hr', -2, 2),
      (p_business, v_tpl, 'Calculate final settlement', 'hr', 0, 3),
      (p_business, v_tpl, 'Remove system access', 'hr', 0, 4),
      (p_business, v_tpl, 'Clearance sign-off', 'manager', 0, 5);
  end if;

  if p_module = 'performance' and not exists (select 1 from public.review_templates where business_id = p_business) then
    insert into public.review_templates (business_id, name, description, is_default)
    values (p_business, 'Basic review', 'A simple review that works for any role.', true) returning id into v_tpl;
    insert into public.review_questions (business_id, template_id, section, question, kind, audience, sort) values
      (p_business, v_tpl, 'Performance', 'How well were goals and responsibilities met this period?', 'rating_text', 'all', 1),
      (p_business, v_tpl, 'Performance', 'Quality of work and attention to detail', 'rating', 'all', 2),
      (p_business, v_tpl, 'Teamwork', 'Works well with colleagues and guests/customers', 'rating_text', 'all', 3),
      (p_business, v_tpl, 'Growth', 'What went especially well?', 'text', 'all', 4),
      (p_business, v_tpl, 'Growth', 'What should be the focus for the next period?', 'text', 'all', 5);
  end if;

  if p_module = 'payroll' and not exists (select 1 from public.account_codes where business_id = p_business) then
    insert into public.account_codes (business_id, code, name, account_type, mapping_key) values
      (p_business, '6000', 'Salaries and wages', 'expense', 'salary_expense'),
      (p_business, '6010', 'Allowances', 'expense', 'allowance_expense'),
      (p_business, '6020', 'Overtime', 'expense', 'overtime_expense'),
      (p_business, '6030', 'Employer pension contribution', 'expense', 'pension_employer_expense'),
      (p_business, '6040', 'Staff reimbursements', 'expense', 'reimbursement_expense'),
      (p_business, '2100', 'Net salaries payable', 'liability', 'net_pay_payable'),
      (p_business, '2110', 'Pension payable', 'liability', 'pension_payable'),
      (p_business, '2120', 'Income tax payable', 'liability', 'tax_payable'),
      (p_business, '1300', 'Staff loans and advances', 'asset', 'staff_loans');
  end if;
  if p_module = 'claims' and not exists (select 1 from public.claim_types where business_id = p_business) then
    insert into public.claim_types (business_id, name, key, cutoff_day, requires_receipt, payout_method, is_system, sort) values
      (p_business, 'Transport', 'transport', 20, true, 'payroll', true, 1),
      (p_business, 'Meals', 'meals', null, true, 'payroll', true, 2),
      (p_business, 'Travel', 'travel', null, true, 'payroll', true, 3),
      (p_business, 'Supplies', 'supplies', null, true, 'payroll', true, 4),
      (p_business, 'Other', 'custom', null, false, 'payroll', false, 5);
  end if;
end $$;

-- Accepts the old tool keys for a while, so an older copy of the app keeps working.

create or replace function public.set_business_modules(p_business uuid, p_enabled text[])
returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_missing text;
  v_unknown text;
  v_newly text[];
  k text;
begin
  -- Old keys from before tools were renamed: Transport + Expense claims became Claims.
  p_enabled := array(select distinct case when x in ('transport', 'expenses') then 'claims' else x end from unnest(p_enabled) x);

  if p_business not in (select private.biz_all('modules', 'edit')) then
    raise exception 'You don''t have permission to change tools' using errcode = '42501';
  end if;

  select string_agg(x, ', ') into v_unknown
    from unnest(p_enabled) x where x not in (select key from private.module_catalog);
  if v_unknown is not null then
    raise exception 'Unknown tool: %', v_unknown using errcode = '22023';
  end if;

  select string_agg(c.key, ', ') into v_missing
    from private.module_catalog c where c.is_core and not (c.key = any(p_enabled));
  if v_missing is not null then
    raise exception 'The foundation tools are always included (%).', v_missing using errcode = '22023';
  end if;

  select string_agg(format('%s needs %s', c.key, r), '; ') into v_missing
    from private.module_catalog c, unnest(c.requires) r
   where c.key = any(p_enabled) and not (r = any(p_enabled));
  if v_missing is not null then
    raise exception 'A required tool is missing: %', v_missing using errcode = '22023';
  end if;

  select coalesce(array_agg(x), '{}') into v_newly from unnest(p_enabled) x
   where not exists (select 1 from public.business_modules bm
                      where bm.business_id = p_business and bm.module_key = x and bm.enabled);

  insert into public.business_modules (business_id, module_key, enabled, enabled_at, disabled_at)
  select p_business, x, true, now(), null from unnest(p_enabled) x
  on conflict (business_id, module_key) do update
    set enabled = true,
        enabled_at = case when public.business_modules.enabled then public.business_modules.enabled_at else now() end,
        disabled_at = null;

  update public.business_modules set enabled = false, disabled_at = now()
   where business_id = p_business and enabled and not (module_key = any(p_enabled));

  -- Starter data for every switched-on tool that is missing it (safe to repeat).
  foreach k in array p_enabled loop
    perform private.seed_module_defaults(p_business, k);
  end loop;

  return v_newly;
end $$;

drop function if exists public.apply_module_setup(uuid, text, jsonb);

create or replace function public.apply_module_setup(p_business uuid, p_module text, p_config jsonb, p_mark_done boolean default true)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_res text;
  v_act text := 'edit';
  d jsonb;
  x jsonb;
  v_dept uuid;
  v_sched uuid;
  v_tax uuid;
  v_tpl uuid;
  v_policy uuid;
begin
  v_res := case p_module
    when 'employees' then 'org'
    when 'leave' then 'leave'
    when 'attendance' then 'attendance'
    when 'payroll' then 'payroll'
    when 'transport' then 'claims'
    when 'claims' then 'claims'
    when 'performance' then 'reviews'
    else null end;
  if v_res is null then
    raise exception 'Tool % has no settings to apply', p_module using errcode = '22023';
  end if;
  if p_module = 'employees' then v_act := 'create'; end if;
  if p_business not in (select private.biz_all(v_res, v_act)) then
    raise exception 'You don''t have permission to change this tool''s settings' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business
                  and module_key = case when p_module = 'transport' then 'claims' else p_module end and enabled) then
    raise exception 'Switch the tool on first' using errcode = '22023';
  end if;

  -- Departments & positions -------------------------------------------
  if p_module = 'employees' then
    for d in select * from jsonb_array_elements(coalesce(p_config -> 'departments', '[]'::jsonb)) loop
      continue when coalesce(trim(d ->> 'name'), '') = '';
      insert into public.departments (business_id, name) values (p_business, trim(d ->> 'name'))
      on conflict (business_id, name) do update set is_active = true
      returning id into v_dept;
      for x in select * from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) loop
        continue when coalesce(trim(x #>> '{}'), '') = '';
        insert into public.positions (business_id, title, department_id) values (p_business, trim(x #>> '{}'), v_dept)
        on conflict (business_id, title, department_id) do nothing;
      end loop;
    end loop;
  end if;

  -- Leave types & public holidays --------------------------------------
  if p_module = 'leave' then
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'leave_types', '[]'::jsonb)) loop
      insert into public.leave_types (business_id, code, name, entitlement_days, is_paid, accrual_method,
                                      carry_forward_max, gender_eligibility, requires_document, sort)
      values (p_business, upper(x ->> 'code'), x ->> 'name', coalesce((x ->> 'days')::numeric, 0),
              coalesce((x ->> 'paid')::boolean, true), coalesce(x ->> 'accrual', 'upfront'),
              coalesce((x ->> 'carry_forward')::numeric, 0), coalesce(x ->> 'gender', 'any'),
              coalesce((x ->> 'requires_document')::boolean, false), coalesce((x ->> 'sort')::int, 0))
      on conflict (business_id, code) do update set
        name = excluded.name, entitlement_days = excluded.entitlement_days, is_paid = excluded.is_paid,
        accrual_method = excluded.accrual_method, carry_forward_max = excluded.carry_forward_max,
        gender_eligibility = excluded.gender_eligibility, requires_document = excluded.requires_document,
        is_active = true;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'holidays', '[]'::jsonb)) loop
      insert into public.public_holidays (business_id, name, holiday_date, country)
      values (p_business, x ->> 'name', (x ->> 'date')::date, coalesce(x ->> 'country', 'MV'))
      on conflict (business_id, holiday_date, name) do nothing;
    end loop;
  end if;

  -- Shifts & attendance rules ------------------------------------------
  if p_module = 'attendance' then
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'shifts', '[]'::jsonb)) loop
      insert into public.shifts (business_id, name, start_time, end_time, break_minutes, crosses_midnight, color)
      values (p_business, x ->> 'name', (x ->> 'start')::time, (x ->> 'end')::time,
              coalesce((x ->> 'break_minutes')::int, 60), (x ->> 'end')::time <= (x ->> 'start')::time,
              coalesce(x ->> 'color', '#64748b'))
      on conflict (business_id, name) do update set
        start_time = excluded.start_time, end_time = excluded.end_time, break_minutes = excluded.break_minutes,
        crosses_midnight = excluded.crosses_midnight, is_active = true;
    end loop;
    if p_config ? 'policy' then
      x := p_config -> 'policy';
      select id into v_policy from public.attendance_policies where business_id = p_business and is_default;
      if v_policy is null then
        insert into public.attendance_policies (business_id, name, is_default) values (p_business, 'Standard rules', true)
        returning id into v_policy;
      end if;
      update public.attendance_policies set
        grace_minutes = coalesce((x ->> 'grace_minutes')::int, grace_minutes),
        late_mark_after_minutes = coalesce((x ->> 'grace_minutes')::int, late_mark_after_minutes),
        half_day_min_hours = coalesce((x ->> 'half_day_min_hours')::numeric, half_day_min_hours),
        full_day_hours = coalesce((x ->> 'full_day_hours')::numeric, full_day_hours),
        overtime_enabled = coalesce((x ->> 'overtime_enabled')::boolean, overtime_enabled),
        overtime_after_minutes = coalesce((x ->> 'overtime_after_minutes')::int, overtime_after_minutes),
        overtime_rate_weekday = coalesce((x ->> 'overtime_rate_weekday')::numeric, overtime_rate_weekday),
        overtime_rate_rest_day = coalesce((x ->> 'overtime_rate_rest_day')::numeric, overtime_rate_rest_day),
        overtime_rate_holiday = coalesce((x ->> 'overtime_rate_holiday')::numeric, overtime_rate_holiday),
        require_gps = coalesce((x ->> 'require_gps')::boolean, require_gps),
        require_selfie = coalesce((x ->> 'require_selfie')::boolean, require_selfie)
      where id = v_policy;
    end if;
  end if;

  -- Pay cycle, pension, tax, pay components ----------------------------
  if p_module = 'payroll' then
    perform private.seed_module_defaults(p_business, 'payroll');
    if p_config ? 'schedule' then
      x := p_config -> 'schedule';
      select id into v_sched from public.pay_schedules where business_id = p_business and is_default;
      if v_sched is null then
        insert into public.pay_schedules (business_id, name, frequency, pay_day, period_start_day, is_default)
        values (p_business, coalesce(x ->> 'name', 'Monthly payroll'), coalesce(x ->> 'frequency', 'monthly'),
                coalesce((x ->> 'pay_day')::smallint, 28), coalesce((x ->> 'period_start_day')::smallint, 1), true);
      else
        update public.pay_schedules set
          frequency = coalesce(x ->> 'frequency', frequency),
          pay_day = coalesce((x ->> 'pay_day')::smallint, pay_day),
          period_start_day = coalesce((x ->> 'period_start_day')::smallint, period_start_day)
        where id = v_sched;
      end if;
    end if;
    if p_config ? 'pension' then
      x := p_config -> 'pension';
      update public.pension_schemes set is_active = false where business_id = p_business and is_active;
      insert into public.pension_schemes (business_id, name, employee_rate, employer_rate, applies_to, notes)
      values (p_business, x ->> 'name', (x ->> 'employee_rate')::numeric, (x ->> 'employer_rate')::numeric,
              coalesce(x ->> 'applies_to', 'locals'), x ->> 'note');
    end if;
    if p_config ? 'tax' then
      x := p_config -> 'tax';
      update public.tax_tables set is_active = false where business_id = p_business and is_active;
      insert into public.tax_tables (business_id, name, basis, notes)
      values (p_business, x ->> 'name', coalesce(x ->> 'basis', 'monthly'), x ->> 'note')
      returning id into v_tax;
      insert into public.tax_brackets (business_id, tax_table_id, lower_bound, upper_bound, rate, sort)
      select p_business, v_tax, (br ->> 'lower')::numeric, nullif(br ->> 'upper', '')::numeric, (br ->> 'rate')::numeric, ord::int
        from jsonb_array_elements(coalesce(x -> 'brackets', '[]'::jsonb)) with ordinality as t(br, ord);
    end if;
    for x in select * from jsonb_array_elements(coalesce(p_config -> 'components', '[]'::jsonb)) loop
      insert into public.pay_components (business_id, code, name, kind, category, is_taxable, is_pensionable, calc_type, sort)
      values (p_business, upper(x ->> 'code'), x ->> 'name', coalesce(x ->> 'kind', 'earning'), coalesce(x ->> 'category', 'allowance'),
              coalesce((x ->> 'taxable')::boolean, true), coalesce((x ->> 'pensionable')::boolean, false),
              coalesce(x ->> 'calc_type', 'fixed'), coalesce((x ->> 'sort')::int, 0))
      on conflict (business_id, code) do nothing;
    end loop;
  end if;

  -- Claim cut-off day (the old transport setting now lives on the Transport claim type)
  if p_module in ('transport', 'claims') then
    perform private.seed_module_defaults(p_business, 'claims');
    if p_config ? 'claims_cutoff_day' then
      update public.claim_types set cutoff_day = (p_config ->> 'claims_cutoff_day')::smallint
       where business_id = p_business and key = 'transport';
    end if;
  end if;

  -- First review cycle --------------------------------------------------
  if p_module = 'performance' then
    perform private.seed_module_defaults(p_business, 'performance');
    if p_config ? 'cycle' then
      x := p_config -> 'cycle';
      select id into v_tpl from public.review_templates where business_id = p_business order by is_default desc, created_at limit 1;
      -- Saving again updates the same draft cycle instead of creating a copy.
      update public.review_cycles set
        period_type = coalesce(x ->> 'period_type', 'annual'), period_start = (x ->> 'period_start')::date,
        period_end = (x ->> 'period_end')::date, self_review_due = nullif(x ->> 'self_review_due', '')::date,
        manager_review_due = nullif(x ->> 'manager_review_due', '')::date
      where business_id = p_business and status = 'draft' and lower(name) = lower(trim(x ->> 'name'));
      if not found then
        insert into public.review_cycles (business_id, name, period_type, period_start, period_end,
                                          self_review_due, manager_review_due, template_id)
        values (p_business, trim(x ->> 'name'), coalesce(x ->> 'period_type', 'annual'), (x ->> 'period_start')::date,
                (x ->> 'period_end')::date, nullif(x ->> 'self_review_due', '')::date,
                nullif(x ->> 'manager_review_due', '')::date, v_tpl);
      end if;
    end if;
  end if;

  if p_mark_done then
    update public.business_modules set setup_completed_at = now()
     where business_id = p_business and module_key = case when p_module = 'transport' then 'claims' else p_module end;
  end if;
end $$;

revoke all on function public.apply_module_setup(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.apply_module_setup(uuid, text, jsonb, boolean) to authenticated;

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

  -- Staff can always upload their own attachments for requests they are allowed to make
  -- (leave/claims/expenses/attendance selfies are also covered by 'create' own scope).
  return v_bid in (select private.biz_all(v_resource, p_action))
      or v_emp in (select private.emp_scope(v_resource, p_action));
end $$;

create or replace function public.get_setup_checklist(p_business uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_business not in (select private.my_business_ids()) then '{}'::jsonb else jsonb_build_object(
    'system.profile', (select address is not null and phone is not null from public.businesses where id = p_business),
    'documents.branding', (select logo_path is not null from public.businesses where id = p_business),
    'org.departments', exists (select 1 from public.departments where business_id = p_business),
    'employees.first', exists (select 1 from public.employees where business_id = p_business),
    'roles.invite', (select count(*) > 1 from public.business_members where business_id = p_business)
                    or exists (select 1 from public.invitations where business_id = p_business and revoked_at is null),
    'approvals.chains', exists (select 1 from public.approval_workflows where business_id = p_business),
    'notifications.test', exists (select 1 from public.notification_channels where business_id = p_business and last_tested_at is not null),
    'portal.announcement', exists (select 1 from public.announcements where business_id = p_business),
    'attendance.shifts', exists (select 1 from public.business_modules where business_id = p_business
                                  and module_key = 'attendance' and setup_completed_at is not null),
    'attendance.geofence', exists (select 1 from public.branches where business_id = p_business and latitude is not null),
    'leave.types', exists (select 1 from public.business_modules where business_id = p_business
                            and module_key = 'leave' and setup_completed_at is not null),
    'leave.holidays', exists (select 1 from public.public_holidays where business_id = p_business),
    'recruitment.vacancy', exists (select 1 from public.vacancies where business_id = p_business),
    'onboarding.template', exists (select 1 from public.checklist_templates where business_id = p_business and kind = 'onboarding'),
    'compliance.items', exists (select 1 from public.compliance_items where business_id = p_business),
    'payroll.schedule', exists (select 1 from public.pay_schedules where business_id = p_business),
    'payroll.statutory', exists (select 1 from public.business_modules where business_id = p_business
                                  and module_key = 'payroll' and setup_completed_at is not null),
    'payroll.salaries', exists (select 1 from public.employee_compensation where business_id = p_business),
    'claims.types', exists (select 1 from public.business_modules where business_id = p_business
                             and module_key = 'claims' and setup_completed_at is not null),
    'learning.course', exists (select 1 from public.courses where business_id = p_business),
    'performance.cycle', exists (select 1 from public.review_cycles where business_id = p_business)
  ) end
$$;

-- ---------------------------------------------------------------------
-- One-time moves. Written as functions so they are safe to run again and
-- can be tested: nothing is copied twice, nothing is deleted.
-- ---------------------------------------------------------------------

-- Businesses that had Transport or Expense claims switched on get Claims.
create or replace function private.migrate_legacy_tools()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_modules (business_id, module_key, enabled, enabled_at, disabled_at, setup_completed_at)
  select bm.business_id, 'claims', bool_or(bm.enabled), min(bm.enabled_at),
         case when bool_or(bm.enabled) then null else max(bm.disabled_at) end,
         max(bm.setup_completed_at)
    from public.business_modules bm
   where bm.module_key in ('transport', 'expenses')
   group by bm.business_id
  on conflict (business_id, module_key) do update
    set enabled = public.business_modules.enabled or excluded.enabled;

  delete from public.business_modules where module_key in ('transport', 'expenses');

  -- Roles keep the same access: the widest scope of either old claim permission.
  insert into public.role_permissions (business_id, role_id, resource, action, scope)
  select rp.business_id, rp.role_id, 'claims', rp.action,
         (array_agg(rp.scope order by case rp.scope when 'all' then 1 when 'team' then 2 else 3 end))[1]
    from public.role_permissions rp
   where rp.resource in ('transport_claims', 'expenses')
   group by rp.business_id, rp.role_id, rp.action
  on conflict (role_id, resource, action) do nothing;
  delete from public.role_permissions where resource in ('transport_claims', 'expenses');

  update public.approval_workflows set request_type = 'claim' where request_type in ('transport_claim', 'expense_claim');
  update public.approval_requests set request_type = 'claim', module_key = 'claims'
   where request_type in ('transport_claim', 'expense_claim');
end $$;

-- Every old transport and expense claim appears under Claims.
create or replace function private.migrate_legacy_claims()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  -- Starter claim types (including "Transport") for any business with old claims or the Claims tool.
  for r in
    select business_id from public.transport_claims
    union select business_id from public.expense_claims
    union select business_id from public.expense_categories
    union select business_id from public.business_modules where module_key = 'claims'
  loop
    perform private.seed_module_defaults(r.business_id, 'claims');
  end loop;

  -- The old transport cut-off day becomes the Transport type's cut-off.
  update public.claim_types ct set cutoff_day = ps.claims_cutoff_day
    from public.pay_schedules ps
   where ps.business_id = ct.business_id and ps.is_default and ps.claims_cutoff_day is not null
     and ct.key = 'transport' and ps.claims_cutoff_day between 1 and 28;

  -- Old expense categories become claim types (matched by name).
  insert into public.claim_types (business_id, name, key, max_amount, requires_receipt, account_code_id, is_active, sort)
  select ec.business_id, ec.name, 'custom', ec.max_amount, ec.requires_receipt, ec.account_code_id, ec.is_active, 50
    from public.expense_categories ec
   where not exists (select 1 from public.claim_types ct where ct.business_id = ec.business_id and lower(ct.name) = lower(ec.name));

  insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, description, route, receipt_path,
                             status, payout_method, target_period_start, is_late, payroll_run_id, paid_at, decided_by,
                             decided_at, decision_comment, created_by, created_at, legacy_source, legacy_id)
  select t.business_id, t.employee_id, ct.id, t.claim_date, t.amount, t.description, t.route, t.receipt_path,
         t.status, 'payroll', t.target_period_start, t.is_late, t.payroll_run_id,
         case when t.status = 'paid' then t.updated_at end, t.decided_by, t.decided_at, t.decision_comment,
         t.created_by, t.created_at, 'transport_claims', t.id
    from public.transport_claims t
    join public.claim_types ct on ct.business_id = t.business_id and ct.key = 'transport'
  on conflict (legacy_source, legacy_id) do nothing;

  insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, currency, description, receipt_path,
                             status, payout_method, payroll_run_id, paid_at, paid_reference, decided_by, decided_at,
                             decision_comment, created_by, created_at, legacy_source, legacy_id)
  select e.business_id, e.employee_id, ct.id, e.expense_date, e.amount, e.currency, e.description, e.receipt_path,
         case e.status when 'reimbursed' then 'paid' else e.status end, e.reimbursement_method, e.payroll_run_id,
         e.paid_at, e.paid_reference, e.decided_by, e.decided_at, e.decision_comment, e.created_by, e.created_at,
         'expense_claims', e.id
    from public.expense_claims e
    join public.expense_categories ec on ec.id = e.category_id
    join public.claim_types ct on ct.business_id = e.business_id and lower(ct.name) = lower(ec.name)
  on conflict (legacy_source, legacy_id) do nothing;
end $$;

select private.migrate_legacy_tools();
select private.migrate_legacy_claims();

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260919000002_tools_restructure.sql') on conflict do nothing;

-- ===================== 20260919000003_foundation_features.sql =====================
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
insert into private.schema_migrations (name) values ('20260919000003_foundation_features.sql') on conflict do nothing;

-- ===================== 20260920000001_staff_app.sql =====================
-- =====================================================================
-- 0010 STAFF APP
--   Staff can see their own records but not change them directly. These
--   functions let each person update a small, safe set of their own
--   details, and see a limited colleague directory. Every change still
--   goes through the audit trail triggers on the tables.
-- =====================================================================

-- The current user's own employee record in a company (null if not linked).
create or replace function private.my_employee_in(p_business uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select m.employee_id from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active'
$$;

-- Update my own contact details. Only these fields; nothing about pay, job or status.
create or replace function public.update_my_contact(
  p_business uuid, p_phone text, p_personal_email text, p_current_address text, p_permanent_address text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if coalesce(p_personal_email, '') <> '' and p_personal_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email' using errcode = '22023';
  end if;
  update public.employees set
    phone = nullif(trim(left(p_phone, 40)), ''),
    personal_email = nullif(lower(trim(left(p_personal_email, 200))), ''),
    current_address = nullif(trim(left(p_current_address, 500)), ''),
    permanent_address = nullif(trim(left(p_permanent_address, 500)), '')
  where id = v_emp and business_id = p_business;
end $$;

-- Add or change one of my emergency contacts (p_id null = add).
create or replace function public.save_my_emergency_contact(
  p_business uuid, p_id uuid, p_name text, p_relationship text, p_phone text, p_is_primary boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_id uuid;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name' using errcode = '22023';
  end if;
  if coalesce(p_is_primary, false) then
    update public.employee_emergency_contacts set is_primary = false where employee_id = v_emp and business_id = p_business;
  end if;
  if p_id is null then
    insert into public.employee_emergency_contacts (business_id, employee_id, name, relationship, phone, is_primary)
    values (p_business, v_emp, trim(left(p_name, 120)), nullif(trim(left(p_relationship, 80)), ''), nullif(trim(left(p_phone, 40)), ''), coalesce(p_is_primary, false))
    returning id into v_id;
  else
    update public.employee_emergency_contacts set
      name = trim(left(p_name, 120)), relationship = nullif(trim(left(p_relationship, 80)), ''),
      phone = nullif(trim(left(p_phone, 40)), ''), is_primary = coalesce(p_is_primary, false)
    where id = p_id and employee_id = v_emp and business_id = p_business
    returning id into v_id;
    if v_id is null then
      raise exception 'Contact not found' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.delete_my_emergency_contact(p_business uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
begin
  delete from public.employee_emergency_contacts where id = p_id and employee_id = v_emp and business_id = p_business;
  if not found then
    raise exception 'Contact not found' using errcode = '22023';
  end if;
end $$;

-- Colleague directory: names, job, team, location and work email only. No personal details.
create or replace function public.staff_directory(p_business uuid)
returns table (id uuid, first_name text, last_name text, preferred_name text, job_title text, department text, location text, work_email text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.first_name, e.last_name, e.preferred_name, p.title, d.name, b.name, e.work_email
    from public.employees e
    left join public.positions p on p.id = e.position_id
    left join public.departments d on d.id = e.department_id
    left join public.branches b on b.id = e.branch_id
   where e.business_id = p_business
     and p_business in (select private.my_business_ids())
     and e.status in ('active', 'probation', 'on_leave')
   order by e.first_name, e.last_name
$$;

revoke all on function public.update_my_contact(uuid, text, text, text, text) from public, anon;
revoke all on function public.save_my_emergency_contact(uuid, uuid, text, text, text, boolean) from public, anon;
revoke all on function public.delete_my_emergency_contact(uuid, uuid) from public, anon;
revoke all on function public.staff_directory(uuid) from public, anon;
grant execute on function public.update_my_contact(uuid, text, text, text, text) to authenticated;
grant execute on function public.save_my_emergency_contact(uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.delete_my_emergency_contact(uuid, uuid) to authenticated;
grant execute on function public.staff_directory(uuid) to authenticated;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260920000001_staff_app.sql') on conflict do nothing;
