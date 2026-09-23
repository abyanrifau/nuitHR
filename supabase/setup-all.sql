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

-- ===================== 20260921000001_time_and_leave.sql =====================
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
insert into private.schema_migrations (name) values ('20260921000001_time_and_leave.sql') on conflict do nothing;

-- ===================== 20260922000001_payroll_and_claims.sql =====================
-- =====================================================================
-- 0012 PAYROLL & CLAIMS
--   The payroll engine: salary (prorated for joiners, leavers, unpaid
--   leave and absence), allowances and deductions, overtime from time
--   records, approved claims, loan instalments, pension and income tax.
--   Runs go draft → calculated → finalized (locked, payslips published)
--   → paid, and can be reversed with a reason.
--   Staff claims with cut-off days, approval, and payout.
--   Rates come from each company's own settings, never from code.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Income tax on an amount using a table's brackets (progressive).
create or replace function private.tax_for(p_table uuid, p_amount numeric)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(round(sum(
           (greatest(0, least(p_amount, coalesce(b.upper_bound, p_amount)) - b.lower_bound)) * b.rate / 100
           + case when p_amount > b.lower_bound then b.fixed_amount else 0 end), 2), 0)
    from public.tax_brackets b
   where b.tax_table_id = p_table and p_amount > b.lower_bound
$$;

-- Is this person a local for pension/tax purposes?
create or replace function private.is_local(e public.employees, p_country text)
returns boolean
language sql immutable as $$
  select not coalesce(e.is_expatriate, false) and coalesce(e.nationality, p_country) = p_country
$$;

-- ---------------------------------------------------------------------
-- Creating a run
-- ---------------------------------------------------------------------
create or replace function public.create_payroll_run(p_business uuid, p_start date, p_end date, p_pay_date date, p_name text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_sched uuid;
begin
  if p_business not in (select private.biz_all('payroll', 'create')) then
    raise exception 'You don''t have permission to run payroll' using errcode = '42501';
  end if;
  if p_end < p_start or p_end - p_start > 62 then
    raise exception 'Choose a pay period of up to two months' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_runs where business_id = p_business and status <> 'reversed'
              and period_start <= p_end and period_end >= p_start) then
    raise exception 'There''s already a pay run for some of those dates' using errcode = '22023';
  end if;
  select id into v_sched from public.pay_schedules where business_id = p_business and is_default;
  insert into public.payroll_runs (business_id, pay_schedule_id, name, period_start, period_end, pay_date)
  values (p_business, v_sched, coalesce(nullif(trim(p_name), ''), to_char(p_start, 'FMMonth YYYY') || ' payroll'), p_start, p_end, p_pay_date)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Calculating a run (can be repeated until it's finalized)
-- ---------------------------------------------------------------------
create or replace function public.calculate_payroll_run(p_run uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  b public.businesses;
  e public.employees;
  p public.attendance_policies;
  pen public.pension_schemes;
  tax public.tax_tables;
  comp record;
  pc record;
  cl record;
  ln record;
  ar record;
  v_re uuid;
  v_days int;                -- calendar days in the period
  v_workdays int;            -- working days in the period
  v_from date;
  v_to date;
  v_employed int;            -- calendar days employed in the period
  v_unpaid numeric;
  v_absent numeric;
  v_paid_days numeric;
  v_present numeric;
  v_worked_h numeric;
  v_ot_h numeric;
  v_basic numeric;
  v_salary numeric;
  v_hourly numeric;
  v_amount numeric;
  v_rate numeric;
  v_gross numeric;
  v_taxable numeric;
  v_pensionable numeric;
  v_ded numeric;
  v_employer numeric;
  v_pen_emp numeric;
  v_tax numeric;
  v_exc jsonb;
  v_sort int;
  v_has_att boolean;
  v_has_leave boolean;
  v_has_claims boolean;
  v_bank record;
  v_holiday boolean;
  v_n int := 0;
  d date;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to calculate this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is finalized and locked' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = r.business_id;
  v_has_att := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'attendance' and enabled);
  v_has_leave := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'leave' and enabled);
  v_has_claims := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'claims' and enabled);
  select * into pen from public.pension_schemes where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;
  select * into tax from public.tax_tables where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;

  -- Start again: forget the previous calculation (people kept on hold stay on hold).
  create temp table if not exists _held (employee_id uuid) on commit drop;
  delete from _held where true;
  insert into _held select employee_id from public.payroll_run_employees where run_id = r.id and status in ('excluded', 'on_hold');
  create temp table if not exists _manual (employee_id uuid, code text, name text, kind text, amount numeric, is_taxable boolean, is_pensionable boolean) on commit drop;
  delete from _manual where true;
  insert into _manual select employee_id, code, name, kind, amount, is_taxable, is_pensionable
    from public.payroll_run_lines where run_id = r.id and source = 'manual';
  update public.claims set payroll_run_id = null where payroll_run_id = r.id and status = 'approved';
  delete from public.payroll_run_employees where run_id = r.id;

  v_days := r.period_end - r.period_start + 1;
  v_workdays := 0;
  d := r.period_start;
  while d <= r.period_end loop
    if extract(dow from d)::smallint = any(b.working_days) then v_workdays := v_workdays + 1; end if;
    d := d + 1;
  end loop;

  for e in select * from public.employees
            where business_id = r.business_id
              and (join_date is null or join_date <= r.period_end)
              and (exit_date is null or exit_date >= r.period_start)
              and not (status in ('resigned', 'terminated') and exit_date is null)
            order by first_name, last_name loop
    v_exc := '[]'::jsonb;
    v_sort := 0;
    v_from := greatest(r.period_start, coalesce(e.join_date, r.period_start));
    v_to := least(r.period_end, coalesce(e.exit_date, r.period_end));
    v_employed := v_to - v_from + 1;

    select * into comp from public.employee_compensation
     where employee_id = e.id and effective_date <= r.period_end order by effective_date desc limit 1;
    select ba.bank_name, ba.account_name, ba.account_number into v_bank
      from public.employee_bank_accounts ba where ba.employee_id = e.id order by ba.is_primary desc limit 1;

    -- Days not paid: unpaid leave and absences (working days only).
    v_unpaid := 0;
    if v_has_leave then
      select coalesce(sum(private.leave_days(r.business_id, lr.leave_type_id, greatest(lr.start_date, v_from), least(lr.end_date, v_to),
                 case when lr.start_date >= v_from then lr.start_half else 'full' end,
                 case when lr.end_date <= v_to then lr.end_half else 'full' end, e.branch_id)), 0)
        into v_unpaid
        from public.leave_requests lr join public.leave_types lt on lt.id = lr.leave_type_id
       where lr.employee_id = e.id and lr.status = 'approved' and not lt.is_paid
         and lr.start_date <= v_to and lr.end_date >= v_from;
    end if;
    v_absent := 0; v_present := 0; v_worked_h := 0; v_ot_h := 0;
    if v_has_att then
      select count(*) filter (where status = 'absent'),
             count(*) filter (where status in ('present','late')) + 0.5 * count(*) filter (where status = 'half_day'),
             coalesce(sum(worked_minutes), 0) / 60.0, coalesce(sum(overtime_minutes), 0) / 60.0
        into v_absent, v_present, v_worked_h, v_ot_h
        from public.attendance_records where employee_id = e.id and work_date between v_from and v_to;
    end if;

    v_basic := coalesce(comp.basic_salary, 0);
    if comp.basic_salary is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_salary', 'message', 'No salary on their profile', 'severity', 'error');
    end if;
    if v_bank.account_number is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_bank', 'message', 'No bank account on their profile', 'severity', 'warning');
    end if;

    -- Salary for the part of the period they were employed, less unpaid days.
    if coalesce(comp.pay_basis, 'monthly') = 'monthly' then
      v_paid_days := greatest(0, v_employed - (v_unpaid + v_absent) * v_days::numeric / greatest(v_workdays, 1));
      v_salary := round(v_basic * v_paid_days / v_days, 2);
      v_hourly := v_basic / greatest(v_workdays * coalesce(nullif((select full_day_hours from public.attendance_policies where business_id = r.business_id and is_default), 0), 8), 1);
    elsif comp.pay_basis = 'daily' then
      v_paid_days := v_present;
      v_salary := round(v_basic * v_present, 2);
      v_hourly := v_basic / 8;
      if not v_has_att then
        v_exc := v_exc || jsonb_build_object('code', 'daily_no_time', 'message', 'Paid by the day, but Time & shifts is off', 'severity', 'warning');
      end if;
    else
      v_paid_days := v_present;
      v_salary := round(v_basic * v_worked_h, 2);
      v_hourly := v_basic;
    end if;

    insert into public.payroll_run_employees (business_id, run_id, employee_id, employee_code, employee_name, department_name, position_title,
      branch_name, bank_name, bank_account_name, bank_account_number, basic_salary, period_days, paid_days, unpaid_leave_days, absent_days,
      worked_hours, overtime_hours, status)
    values (r.business_id, r.id, e.id, e.employee_code, trim(e.first_name || ' ' || e.last_name),
      (select name from public.departments where id = e.department_id), (select title from public.positions where id = e.position_id),
      (select name from public.branches where id = e.branch_id), v_bank.bank_name, v_bank.account_name, v_bank.account_number,
      v_basic, v_days, round(v_paid_days, 2), v_unpaid, v_absent, round(v_worked_h, 2), round(v_ot_h, 2),
      case when e.id in (select employee_id from _held) then 'on_hold' else 'included' end)
    returning id into v_re;
    v_n := v_n + 1;

    -- Earnings --------------------------------------------------------
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort)
    values (r.business_id, r.id, v_re, e.id, 'BASIC', 'Basic salary', 'earning', round(v_paid_days, 2), v_basic, v_salary, true, true, 'salary', 0);

    for pc in select epc.amount, epc.percent, c.id, c.code, c.name, c.kind, c.calc_type, c.default_amount, c.default_percent,
                     c.is_taxable, c.is_pensionable, c.prorate, c.category, c.sort
                from public.employee_pay_components epc join public.pay_components c on c.id = epc.component_id
               where epc.employee_id = e.id and c.is_active and epc.start_date <= v_to and (epc.end_date is null or epc.end_date >= v_from) loop
      v_amount := case pc.calc_type
        when 'fixed' then coalesce(pc.amount, pc.default_amount) * case when pc.prorate and coalesce(comp.pay_basis, 'monthly') = 'monthly' then v_paid_days / v_days else 1 end
        when 'percent_of_basic' then v_basic * coalesce(pc.percent, pc.default_percent, 0) / 100 * case when pc.prorate then v_paid_days / v_days else 1 end
        when 'per_day_present' then coalesce(pc.amount, pc.default_amount) * v_present
        when 'per_hour_worked' then coalesce(pc.amount, pc.default_amount) * v_worked_h
        else coalesce(pc.amount, pc.default_amount) end;
      v_amount := round(coalesce(v_amount, 0), 2);
      continue when v_amount = 0;
      v_sort := v_sort + 1;
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, component_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
      values (r.business_id, r.id, v_re, e.id, pc.id, pc.code, pc.name, pc.kind, v_amount,
              pc.kind = 'earning' and pc.is_taxable, pc.kind = 'earning' and pc.is_pensionable, 'component', 10 + pc.sort);
    end loop;

    -- Overtime from time records, at the rate for the kind of day.
    if v_has_att then
      p := private.policy_for(r.business_id, e.id);
      for ar in select work_date, overtime_minutes from public.attendance_records
                 where employee_id = e.id and work_date between v_from and v_to and overtime_minutes > 0 loop
        v_holiday := exists (select 1 from public.public_holidays h where h.business_id = r.business_id and h.holiday_date = ar.work_date and not h.is_optional);
        v_rate := case when v_holiday then coalesce(p.overtime_rate_holiday, 1.5)
                       when not (extract(dow from ar.work_date)::smallint = any(b.working_days)) then coalesce(p.overtime_rate_rest_day, 1.5)
                       else coalesce(p.overtime_rate_weekday, 1.25) end;
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'OT', 'Overtime ' || to_char(ar.work_date, 'DD Mon') || ' (x' || trim(to_char(v_rate, 'FM0.00')) || ')', 'earning',
                round(ar.overtime_minutes / 60.0, 2), round(v_hourly * v_rate, 4), round(ar.overtime_minutes / 60.0 * v_hourly * v_rate, 2), true, false, 'overtime', 50);
      end loop;
    end if;

    -- Approved claims paid through payroll, up to this period.
    if v_has_claims then
      for cl in select c.id, c.amount, t.name, c.claim_date from public.claims c join public.claim_types t on t.id = c.claim_type_id
                 where c.employee_id = e.id and c.status = 'approved' and c.payout_method = 'payroll' and c.payroll_run_id is null
                   and coalesce(c.target_period_start, c.claim_date) <= r.period_end loop
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, source_id, sort)
        values (r.business_id, r.id, v_re, e.id, 'CLAIM', cl.name || ' claim ' || to_char(cl.claim_date, 'DD Mon'), 'earning', cl.amount, false, false, 'expense_claim', cl.id, 60);
        update public.claims set payroll_run_id = r.id where id = cl.id;
      end loop;
    end if;

    -- Changes typed in by hand on this run are kept when recalculating.
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
    select r.business_id, r.id, v_re, e.id, m.code, m.name, m.kind, m.amount, m.is_taxable, m.is_pensionable, 'manual', 70
      from _manual m where m.employee_id = e.id;

    select coalesce(sum(amount) filter (where kind = 'earning'), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_taxable), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_pensionable), 0)
      into v_gross, v_taxable, v_pensionable
      from public.payroll_run_lines where run_employee_id = v_re;

    -- Deductions ------------------------------------------------------
    for ln in select id, installment_amount, outstanding, kind from public.loans
               where employee_id = e.id and status = 'active' and start_date <= r.period_end and outstanding > 0 loop
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, source_id, sort)
      values (r.business_id, r.id, v_re, e.id, upper(ln.kind), case when ln.kind = 'advance' then 'Salary advance' else 'Loan repayment' end, 'deduction',
              least(ln.installment_amount, ln.outstanding), 'loan', ln.id, 80);
    end loop;

    v_pen_emp := 0; v_employer := 0;
    if pen.id is not null and (pen.applies_to = 'all' or (pen.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := case pen.wage_base when 'basic' then v_salary when 'gross' then v_gross else v_pensionable end;
      if pen.wage_ceiling is not null then v_amount := least(v_amount, pen.wage_ceiling); end if;
      v_pen_emp := round(v_amount * pen.employee_rate / 100, 2);
      v_employer := round(v_amount * pen.employer_rate / 100, 2);
      if v_pen_emp > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'PENSION', 'Pension (' || trim(to_char(pen.employee_rate, 'FM990.###')) || '%)', 'deduction', pen.employee_rate, v_pen_emp, 'statutory', 90);
      end if;
      if v_employer > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'PENSION_ER', 'Employer pension (' || trim(to_char(pen.employer_rate, 'FM990.###')) || '%)', 'employer_contribution', pen.employer_rate, v_employer, 'statutory', 95);
      end if;
    end if;

    v_tax := 0;
    if tax.id is not null and (tax.applies_to = 'all' or (tax.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := greatest(v_taxable - v_pen_emp, 0);
      v_tax := case when tax.basis = 'annual' then round(private.tax_for(tax.id, v_amount * 12) / 12, 2) else private.tax_for(tax.id, v_amount) end;
      if v_tax > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'TAX', 'Income tax', 'deduction', v_tax, 'statutory', 91);
      end if;
    end if;

    select coalesce(sum(amount), 0) into v_ded from public.payroll_run_lines where run_employee_id = v_re and kind = 'deduction';
    if v_gross - v_ded < 0 then
      v_exc := v_exc || jsonb_build_object('code', 'negative', 'message', 'Deductions are more than pay', 'severity', 'error');
    end if;
    update public.payroll_run_employees set
      gross_pay = v_gross, taxable_pay = greatest(v_taxable - v_pen_emp, 0), pensionable_pay = v_pensionable,
      total_deductions = v_ded, net_pay = v_gross - v_ded, employer_contributions = v_employer, exceptions = v_exc
    where id = v_re;
  end loop;

  update public.payroll_runs set
    status = 'calculated', calculated_at = now(), calculated_by = auth.uid(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_gross = (select coalesce(sum(gross_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_deductions = (select coalesce(sum(total_deductions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_net = (select coalesce(sum(net_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_employer_contributions = (select coalesce(sum(employer_contributions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included')
  where id = r.id;
  -- Claims for people on hold wait for the next run.
  update public.claims c set payroll_run_id = null
   where c.payroll_run_id = r.id and c.employee_id in (select employee_id from _held);
  return jsonb_build_object('people', v_n);
end $$;

-- Hold someone back from a run (or include them again), then recalculate.
create or replace function public.set_payroll_person_status(p_run uuid, p_employee uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  if p_status not in ('included', 'on_hold') then
    raise exception 'Choose include or hold' using errcode = '22023';
  end if;
  update public.payroll_run_employees set status = p_status where run_id = p_run and employee_id = p_employee;
  perform public.calculate_payroll_run(p_run);
end $$;

-- Add a one-off amount for someone on this run (bonus, correction...). Kept when recalculating.
create or replace function public.add_payroll_adjustment(
  p_run uuid, p_employee uuid, p_name text, p_kind text, p_amount numeric, p_taxable boolean default true, p_pensionable boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  v_re uuid;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is finalized and locked' using errcode = '42501';
  end if;
  if p_kind not in ('earning', 'deduction') or coalesce(p_amount, 0) <= 0 or coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name and an amount above zero' using errcode = '22023';
  end if;
  select id into v_re from public.payroll_run_employees where run_id = p_run and employee_id = p_employee;
  if v_re is null then
    raise exception 'That person isn''t on this pay run' using errcode = '22023';
  end if;
  insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
  values (r.business_id, p_run, v_re, p_employee, 'ADJ', trim(left(p_name, 80)), p_kind, round(p_amount, 2),
          p_kind = 'earning' and coalesce(p_taxable, true), p_kind = 'earning' and coalesce(p_pensionable, false), 'manual', 70);
  perform public.calculate_payroll_run(p_run);
end $$;

create or replace function public.remove_payroll_adjustment(p_line uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.payroll_run_lines; r public.payroll_runs;
begin
  select * into l from public.payroll_run_lines where id = p_line and source = 'manual';
  select * into r from public.payroll_runs where id = l.run_id;
  if l.id is null or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  delete from public.payroll_run_lines where id = l.id;
  perform public.calculate_payroll_run(r.id);
end $$;

-- ---------------------------------------------------------------------
-- Finalizing, paying and reversing
-- ---------------------------------------------------------------------
create or replace function public.finalize_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  l record;
  pe record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to finalize a pay run' using errcode = '42501';
  end if;
  if r.status <> 'calculated' then
    raise exception 'Calculate the pay run before finalizing it' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_run_employees where run_id = r.id and status = 'included'
              and exceptions @> '[{"severity":"error"}]'::jsonb) then
    raise exception 'Some people have problems to fix first (shown in red), or put them on hold' using errcode = '22023';
  end if;
  -- Held people come off the run entirely.
  delete from public.payroll_run_employees where run_id = r.id and status <> 'included';

  -- Loans: record the repayments and bring the balances down.
  for l in select source_id, amount from public.payroll_run_lines where run_id = r.id and source = 'loan' loop
    insert into public.loan_repayments (business_id, loan_id, run_id, amount, paid_on, method)
    values (r.business_id, l.source_id, r.id, l.amount, r.pay_date, 'payroll');
    update public.loans set outstanding = greatest(outstanding - l.amount, 0),
                            status = case when outstanding - l.amount <= 0 then 'completed' else status end
     where id = l.source_id;
  end loop;
  update public.claims set status = 'paid', paid_at = now(), paid_reference = r.name
   where payroll_run_id = r.id and status = 'approved';
  update public.timesheets set payroll_run_id = r.id
   where business_id = r.business_id and status = 'approved' and period_start >= r.period_start and period_end <= r.period_end;
  update public.leave_requests set payroll_run_id = r.id
   where business_id = r.business_id and status = 'approved' and start_date <= r.period_end and end_date >= r.period_start
     and leave_type_id in (select id from public.leave_types where business_id = r.business_id and not is_paid);

  update public.payroll_runs set status = 'finalized', finalized_at = now(), finalized_by = auth.uid() where id = r.id;
  update public.payroll_run_employees set payslip_published_at = now() where run_id = r.id;
  for pe in select employee_id from public.payroll_run_employees where run_id = r.id loop
    perform private.notify(r.business_id, private.user_for_employee(r.business_id, pe.employee_id), 'payroll.payslip_ready',
      'Your payslip for ' || to_char(r.period_start, 'FMMonth YYYY') || ' is here', null, '/staff/pay', 'payroll');
  end loop;
end $$;

create or replace function public.mark_payroll_paid(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to mark a pay run as paid' using errcode = '42501';
  end if;
  if r.status <> 'finalized' then
    raise exception 'Only a finalized pay run can be marked as paid' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'paid', paid_at = now() where id = r.id;
end $$;

-- Undo a finalized run: payslips are withdrawn, loans and claims go back.
create or replace function public.reverse_payroll_run(p_run uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  l record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to reverse a pay run' using errcode = '42501';
  end if;
  if r.status not in ('finalized', 'paid') then
    raise exception 'Only a finalized or paid run can be reversed. Delete a draft instead.' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add the reason for reversing' using errcode = '22023';
  end if;
  for l in select loan_id, amount from public.loan_repayments where run_id = r.id loop
    update public.loans set outstanding = least(outstanding + l.amount, principal), status = 'active' where id = l.loan_id;
  end loop;
  delete from public.loan_repayments where run_id = r.id;
  update public.claims set status = 'approved', paid_at = null, paid_reference = null, payroll_run_id = null where payroll_run_id = r.id;
  update public.timesheets set payroll_run_id = null where payroll_run_id = r.id;
  update public.leave_requests set payroll_run_id = null where payroll_run_id = r.id;
  update public.payroll_runs set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason) where id = r.id;
end $$;

-- A draft or calculated run can be thrown away.
create or replace function public.delete_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'delete')) then
    raise exception 'You don''t have permission to delete pay runs' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'Finalized pay runs can''t be deleted; reverse them instead' using errcode = '22023';
  end if;
  update public.claims set payroll_run_id = null where payroll_run_id = r.id;
  delete from public.payroll_runs where id = r.id;
end $$;

-- ---------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------
create or replace function public.submit_claim(
  p_business uuid, p_type uuid, p_date date, p_amount numeric, p_description text default null,
  p_route text default null, p_receipt text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  t public.claim_types;
  v_today date := private.biz_today(p_business);
  v_target date;
  v_late boolean := false;
  v_method text;
  v_id uuid;
  v_name text;
  v_cur text;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business and module_key = 'claims' and enabled) then
    raise exception 'Claims aren''t switched on for your company' using errcode = '42501';
  end if;
  select * into t from public.claim_types where id = p_type and business_id = p_business and is_active;
  if not found then
    raise exception 'Choose a type of claim' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Enter the amount' using errcode = '22023';
  end if;
  if t.max_amount is not null and p_amount > t.max_amount then
    raise exception '% claims can be up to %', t.name, t.max_amount using errcode = '22023';
  end if;
  if p_date > v_today then
    raise exception 'The date can''t be in the future' using errcode = '22023';
  end if;
  if p_date < v_today - 90 then
    raise exception 'Claims must be sent within 90 days' using errcode = '22023';
  end if;
  if t.requires_receipt and p_receipt is null then
    raise exception 'Add a photo of the receipt' using errcode = '22023';
  end if;
  if p_receipt is not null and p_receipt not like p_business::text || '/claims/' || v_emp::text || '/%' then
    raise exception 'That receipt is in the wrong folder' using errcode = '22023';
  end if;
  -- After the cut-off day, the claim is paid with next month's payroll.
  v_target := date_trunc('month', v_today)::date;
  if t.cutoff_day is not null and extract(day from v_today) > t.cutoff_day then
    v_target := (v_target + interval '1 month')::date;
    v_late := true;
  end if;
  v_method := case when exists (select 1 from public.business_modules where business_id = p_business and module_key = 'payroll' and enabled)
                   then t.payout_method else 'separate' end;
  select currency into v_cur from public.businesses where id = p_business;
  insert into public.claims (business_id, employee_id, claim_type_id, claim_date, amount, currency, description, route, receipt_path,
                             payout_method, target_period_start, is_late)
  values (p_business, v_emp, t.id, p_date, round(p_amount, 2), v_cur, nullif(trim(left(p_description, 500)), ''), nullif(trim(left(p_route, 200)), ''),
          p_receipt, v_method, v_target, v_late)
  returning id into v_id;
  select trim(first_name || ' ' || last_name) into v_name from public.employees where id = v_emp;
  perform private.create_request(p_business, 'claim', 'claims', 'claims', v_id, v_emp,
    t.name || ' claim from ' || v_name,
    concat_ws(' · ', to_char(p_date, 'DD Mon'), nullif(trim(p_route), ''), nullif(trim(p_description), '')),
    round(p_amount, 2), jsonb_build_object('claim_type', t.name));
  return v_id;
end $$;

-- Claims paid outside payroll (cash or bank transfer): mark them as paid.
create or replace function public.mark_claims_paid(p_business uuid, p_ids uuid[], p_reference text)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if p_business not in (select private.biz_all('claims', 'edit')) then
    raise exception 'You don''t have permission to pay claims' using errcode = '42501';
  end if;
  update public.claims set status = 'paid', paid_at = now(), paid_reference = nullif(trim(p_reference), '')
   where business_id = p_business and id = any(p_ids) and status = 'approved' and payroll_run_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Tell staff when a claim is answered.
create or replace function private.after_claim_decided() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Claims decided in the Requests list already send "your request was decided", so only notify for direct decisions.
  if new.status in ('approved', 'rejected') and old.status = 'pending'
     and not exists (select 1 from public.approval_requests ar where ar.source_table = 'claims' and ar.source_id = new.id) then
    perform private.notify(new.business_id, private.user_for_employee(new.business_id, new.employee_id), 'claims.decided',
      case when new.status = 'approved' then 'Claim approved' else 'Claim declined' end,
      concat_ws(' · ', (select currency from public.businesses where id = new.business_id) || ' ' || to_char(new.amount, 'FM999,999,990.00'), new.decision_comment),
      '/staff/claims', 'claims');
  end if;
  return new;
end $$;
drop trigger if exists claim_decided_notify on public.claims;
create trigger claim_decided_notify after update of status on public.claims
  for each row execute function private.after_claim_decided();

revoke all on function public.create_payroll_run(uuid, date, date, date, text) from public, anon;
revoke all on function public.calculate_payroll_run(uuid) from public, anon;
revoke all on function public.set_payroll_person_status(uuid, uuid, text) from public, anon;
revoke all on function public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean) from public, anon;
revoke all on function public.remove_payroll_adjustment(uuid) from public, anon;
revoke all on function public.finalize_payroll_run(uuid) from public, anon;
revoke all on function public.mark_payroll_paid(uuid) from public, anon;
revoke all on function public.reverse_payroll_run(uuid, text) from public, anon;
revoke all on function public.delete_payroll_run(uuid) from public, anon;
revoke all on function public.submit_claim(uuid, uuid, date, numeric, text, text, text) from public, anon;
revoke all on function public.mark_claims_paid(uuid, uuid[], text) from public, anon;
grant execute on function public.create_payroll_run(uuid, date, date, date, text) to authenticated;
grant execute on function public.calculate_payroll_run(uuid) to authenticated;
grant execute on function public.set_payroll_person_status(uuid, uuid, text) to authenticated;
grant execute on function public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean) to authenticated;
grant execute on function public.remove_payroll_adjustment(uuid) to authenticated;
grant execute on function public.finalize_payroll_run(uuid) to authenticated;
grant execute on function public.mark_payroll_paid(uuid) to authenticated;
grant execute on function public.reverse_payroll_run(uuid, text) to authenticated;
grant execute on function public.delete_payroll_run(uuid) to authenticated;
grant execute on function public.submit_claim(uuid, uuid, date, numeric, text, text, text) to authenticated;
grant execute on function public.mark_claims_paid(uuid, uuid[], text) to authenticated;

grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260922000001_payroll_and_claims.sql') on conflict do nothing;

-- ===================== 20260922000002_payroll_safe_delete.sql =====================
-- =====================================================================
-- 0013 PAYROLL FIX
--   Supabase refuses DELETE without a WHERE clause (safety setting), so
--   the scratch tables in calculate_payroll_run are cleared with
--   "where true". Already correct for new installs; this updates
--   databases that ran 0012 before the fix.
-- =====================================================================
do $$
declare d text;
begin
  d := pg_get_functiondef('public.calculate_payroll_run(uuid)'::regprocedure);
  d := replace(replace(d, 'delete from _held;', 'delete from _held where true;'), 'delete from _manual;', 'delete from _manual where true;');
  execute d;
end $$;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260922000002_payroll_safe_delete.sql') on conflict do nothing;

-- ===================== 20260923000001_hiring_joiners_permits.sql =====================
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
insert into private.schema_migrations (name) values ('20260923000001_hiring_joiners_permits.sql') on conflict do nothing;

-- ===================== 20260923000002_joiner_checklist_recent_only.sql =====================
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
insert into private.schema_migrations (name) values ('20260923000002_joiner_checklist_recent_only.sql') on conflict do nothing;

-- ===================== 20260924000001_learning_and_reviews.sql =====================
-- =====================================================================
-- 0016 TRAINING, REVIEWS & GOALS, SURVEYS
--   * Assigning courses to people, teams or everyone (new joiners included)
--   * Taking lessons and quizzes, graded here so answers never reach the phone
--   * Paid training requests that go through approvals
--   * Review rounds: self review, manager review, share, acknowledge
--   * Surveys, anonymous if chosen, with results hidden for tiny groups
-- =====================================================================

-- ---------------------------------------------------------------------
-- Training: who a course goes to
-- ---------------------------------------------------------------------
-- Enrol everyone an assignment covers. Returns how many new people were added.
create or replace function private.enroll_for_assignment(p_assignment uuid, p_only_employee uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a public.course_assignments;
  c public.courses;
  e record;
  v_new integer := 0;
  v_id uuid;
begin
  select * into a from public.course_assignments where id = p_assignment;
  select * into c from public.courses where id = a.course_id;
  if c.id is null or c.status <> 'published' then return 0; end if;
  for e in
    select emp.id from public.employees emp
     where emp.business_id = a.business_id
       and emp.status in ('active', 'probation', 'on_leave')
       and (p_only_employee is null or emp.id = p_only_employee)
       and case a.target_type
             when 'everyone' then true
             when 'employee' then emp.id = a.target_id
             when 'department' then emp.department_id = a.target_id
             when 'position' then emp.position_id = a.target_id
             when 'branch' then emp.branch_id = a.target_id
           end
  loop
    v_id := null;
    insert into public.course_enrollments (business_id, course_id, employee_id, assignment_id, due_date, is_mandatory)
    values (a.business_id, a.course_id, e.id, a.id, a.due_date, a.is_mandatory or c.is_mandatory)
    on conflict (course_id, employee_id) do nothing
    returning id into v_id;
    if v_id is not null then
      v_new := v_new + 1;
      perform private.notify(a.business_id, private.user_for_employee(a.business_id, e.id), 'learning.assigned',
        'New course: ' || c.title,
        case when a.due_date is not null then 'Please finish it by ' || to_char(a.due_date, 'DD Mon YYYY') || '.' else 'You can start it any time.' end,
        '/staff/courses/' || c.id, 'learning');
    end if;
  end loop;
  return v_new;
end $$;

create or replace function public.assign_course(
  p_course uuid, p_target_type text, p_target_id uuid default null, p_due date default null, p_mandatory boolean default false)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c public.courses;
  v_id uuid;
begin
  select * into c from public.courses where id = p_course;
  if c.id is null or c.business_id not in (select private.biz_all('learning', 'edit')) then
    raise exception 'You don''t have permission to assign courses' using errcode = '42501';
  end if;
  if c.status <> 'published' then
    raise exception 'Publish the course before assigning it' using errcode = '22023';
  end if;
  if p_target_type not in ('employee', 'department', 'position', 'branch', 'everyone') then
    raise exception 'Choose who the course is for' using errcode = '22023';
  end if;
  if (p_target_type = 'everyone') <> (p_target_id is null) then
    raise exception 'Choose who the course is for' using errcode = '22023';
  end if;
  insert into public.course_assignments (business_id, course_id, target_type, target_id, due_date, is_mandatory)
  values (c.business_id, c.id, p_target_type, p_target_id, p_due, coalesce(p_mandatory, false))
  returning id into v_id;
  return private.enroll_for_assignment(v_id);
end $$;

-- New people get the courses meant for their team, job or everyone.
create or replace function private.enroll_new_employee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  for a in select ca.id from public.course_assignments ca
             join public.courses c on c.id = ca.course_id and c.status = 'published'
            where ca.business_id = new.business_id and ca.target_type <> 'employee'
  loop
    perform private.enroll_for_assignment(a.id, new.id);
  end loop;
  return new;
end $$;
drop trigger if exists enroll_new_employee on public.employees;
create trigger enroll_new_employee after insert on public.employees
  for each row execute function private.enroll_new_employee();

-- Recalculate how far someone is through a course.
create or replace function private.refresh_enrollment(p_enrollment uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  en public.course_enrollments;
  v_total integer;
  v_done integer;
  v_score integer;
begin
  select * into en from public.course_enrollments where id = p_enrollment;
  select count(*) into v_total from public.course_lessons where course_id = en.course_id;
  select count(*) into v_done from public.lesson_progress lp
    join public.course_lessons l on l.id = lp.lesson_id
   where lp.enrollment_id = en.id;
  -- Score = average of the best attempt at each quiz.
  select round(avg(best))::int into v_score from (
    select max(qa.score) as best from public.quiz_attempts qa where qa.enrollment_id = en.id group by qa.lesson_id) q;
  update public.course_enrollments set
    progress_percent = case when v_total = 0 then 0 else least(100, round(100.0 * v_done / v_total))::smallint end,
    status = case when v_total > 0 and v_done >= v_total then 'completed' when v_done > 0 then 'in_progress' else status end,
    started_at = coalesce(started_at, now()),
    completed_at = case when v_total > 0 and v_done >= v_total then coalesce(completed_at, now()) else null end,
    score = v_score
  where id = en.id;
end $$;

-- The learner's own enrolment, or an error.
create or replace function private.my_enrollment(p_enrollment uuid)
returns public.course_enrollments
language plpgsql stable security definer set search_path = '' as $$
declare en public.course_enrollments;
begin
  select * into en from public.course_enrollments where id = p_enrollment;
  if en.id is null or en.employee_id is distinct from private.my_employee_in(en.business_id) then
    raise exception 'That course isn''t assigned to you' using errcode = '42501';
  end if;
  return en;
end $$;

create or replace function public.complete_lesson(p_enrollment uuid, p_lesson uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  en public.course_enrollments := private.my_enrollment(p_enrollment);
  l public.course_lessons;
begin
  select * into l from public.course_lessons where id = p_lesson and course_id = en.course_id;
  if l.id is null then raise exception 'That lesson isn''t part of this course' using errcode = '22023'; end if;
  if l.kind = 'quiz' then raise exception 'Pass the quiz to finish this lesson' using errcode = '22023'; end if;
  insert into public.lesson_progress (business_id, enrollment_id, employee_id, lesson_id)
  values (en.business_id, en.id, en.employee_id, l.id)
  on conflict (enrollment_id, lesson_id) do nothing;
  perform private.refresh_enrollment(en.id);
end $$;

-- Marks a quiz. p_answers = { "<question id>": ["a", "c"] }.
-- Returns the score, whether it passed and which questions were right.
-- The right answers are only shown once the quiz is passed.
create or replace function public.submit_quiz(p_enrollment uuid, p_lesson uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  en public.course_enrollments := private.my_enrollment(p_enrollment);
  l public.course_lessons;
  c public.courses;
  q record;
  v_given text[];
  v_ok boolean;
  v_total integer := 0;
  v_got integer := 0;
  v_score integer;
  v_pass integer;
  v_passed boolean;
  v_results jsonb := '[]'::jsonb;
begin
  select * into l from public.course_lessons where id = p_lesson and course_id = en.course_id and kind = 'quiz';
  if l.id is null then raise exception 'That quiz isn''t part of this course' using errcode = '22023'; end if;
  select * into c from public.courses where id = en.course_id;
  for q in
    select qq.id, qq.points, k.correct_option_ids, k.explanation
      from public.quiz_questions qq
      left join public.quiz_answer_keys k on k.question_id = qq.id
     where qq.lesson_id = l.id order by qq.sort
  loop
    select coalesce(array_agg(x order by x), '{}') into v_given
      from jsonb_array_elements_text(coalesce(p_answers -> q.id::text, '[]'::jsonb)) x;
    v_ok := q.correct_option_ids is not null
            and v_given = (select coalesce(array_agg(y order by y), '{}') from unnest(q.correct_option_ids) y);
    v_total := v_total + q.points;
    if v_ok then v_got := v_got + q.points; end if;
    v_results := v_results || jsonb_build_object('question_id', q.id, 'correct', v_ok,
      'correct_ids', to_jsonb(q.correct_option_ids), 'explanation', q.explanation);
  end loop;
  if v_total = 0 then raise exception 'This quiz has no questions yet' using errcode = '22023'; end if;
  v_score := round(100.0 * v_got / v_total);
  v_pass := coalesce(l.pass_mark, c.pass_mark);
  v_passed := v_score >= v_pass;
  insert into public.quiz_attempts (business_id, enrollment_id, employee_id, lesson_id, answers, score, passed)
  values (en.business_id, en.id, en.employee_id, l.id, coalesce(p_answers, '{}'::jsonb), v_score, v_passed);
  if v_passed then
    insert into public.lesson_progress (business_id, enrollment_id, employee_id, lesson_id)
    values (en.business_id, en.id, en.employee_id, l.id)
    on conflict (enrollment_id, lesson_id) do nothing;
  end if;
  perform private.refresh_enrollment(en.id);
  if not v_passed then
    -- Only say which were wrong, so the quiz still means something next time.
    select coalesce(jsonb_agg(r - 'correct_ids' - 'explanation'), '[]'::jsonb) into v_results from jsonb_array_elements(v_results) r;
  end if;
  return jsonb_build_object('score', v_score, 'pass_mark', v_pass, 'passed', v_passed, 'results', v_results);
end $$;

-- Save a quiz question and its answer key together (the key is kept apart from learners).
create or replace function public.save_quiz_question(
  p_lesson uuid, p_question uuid, p_text text, p_kind text, p_options jsonb, p_correct text[], p_explanation text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.course_lessons;
  v_id uuid := p_question;
  v_sort integer;
begin
  select * into l from public.course_lessons where id = p_lesson and kind = 'quiz';
  if l.id is null or l.business_id not in (select private.biz_all('learning', 'edit')) then
    raise exception 'You don''t have permission to change courses' using errcode = '42501';
  end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'Write the question' using errcode = '22023'; end if;
  if p_kind not in ('single', 'multiple', 'true_false') then raise exception 'Choose a question type' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_options, '[]'::jsonb)) < 2 then raise exception 'Add at least two answers' using errcode = '22023'; end if;
  if coalesce(array_length(p_correct, 1), 0) = 0 then raise exception 'Tick the right answer' using errcode = '22023'; end if;
  if p_kind <> 'multiple' and array_length(p_correct, 1) > 1 then raise exception 'Only one answer can be right for this type' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_correct) x where not exists (select 1 from jsonb_array_elements(p_options) o where o ->> 'id' = x)) then
    raise exception 'The right answer must be one of the options' using errcode = '22023';
  end if;
  if v_id is null then
    select coalesce(max(sort), 0) + 1 into v_sort from public.quiz_questions where lesson_id = l.id;
    insert into public.quiz_questions (business_id, lesson_id, question, kind, options, sort)
    values (l.business_id, l.id, trim(p_text), p_kind, p_options, v_sort) returning id into v_id;
  else
    update public.quiz_questions set question = trim(p_text), kind = p_kind, options = p_options
     where id = v_id and lesson_id = l.id;
    if not found then raise exception 'Question not found' using errcode = '22023'; end if;
  end if;
  insert into public.quiz_answer_keys (question_id, business_id, correct_option_ids, explanation)
  values (v_id, l.business_id, p_correct, nullif(trim(p_explanation), ''))
  on conflict (question_id) do update set correct_option_ids = excluded.correct_option_ids, explanation = excluded.explanation, updated_at = now();
  return v_id;
end $$;

-- Daily: remind people about courses due within 3 days or overdue (at most every 3 days).
create or replace function public.send_learning_reminders()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  en record;
  v_n integer := 0;
begin
  for en in
    select ce.id, ce.business_id, ce.employee_id, ce.due_date, c.id as course_id, c.title
      from public.course_enrollments ce
      join public.courses c on c.id = ce.course_id and c.status = 'published'
      join public.employees e on e.id = ce.employee_id and e.status in ('active', 'probation', 'on_leave')
     where ce.status <> 'completed' and ce.due_date is not null
       and ce.due_date <= private.biz_today(ce.business_id) + 3
       and (ce.last_reminded_at is null or ce.last_reminded_at < now() - interval '3 days')
  loop
    perform private.notify(en.business_id, private.user_for_employee(en.business_id, en.employee_id), 'learning.due',
      case when en.due_date < private.biz_today(en.business_id) then 'Course overdue: ' else 'Course due soon: ' end || en.title,
      'Due ' || to_char(en.due_date, 'DD Mon YYYY') || '.', '/staff/courses/' || en.course_id, 'learning');
    update public.course_enrollments set last_reminded_at = now() where id = en.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Paid training: staff ask, it goes through approvals
-- ---------------------------------------------------------------------
create or replace function public.request_paid_training(
  p_business uuid, p_provider text, p_course text, p_location text, p_start date, p_end date, p_cost numeric, p_notes text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_in(p_business);
  v_id uuid;
  v_cur text;
  v_name text;
begin
  if v_emp is null then
    raise exception 'Your login isn''t linked to a profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_modules where business_id = p_business and module_key = 'learning' and enabled) then
    raise exception 'Training isn''t switched on' using errcode = '22023';
  end if;
  if coalesce(trim(p_provider), '') = '' or coalesce(trim(p_course), '') = '' then
    raise exception 'Say what the course is and who runs it' using errcode = '22023';
  end if;
  if p_cost is null or p_cost < 0 then raise exception 'Enter the cost' using errcode = '22023'; end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    raise exception 'The end date is before the start date' using errcode = '22023';
  end if;
  select currency into v_cur from public.businesses where id = p_business;
  insert into public.training_sponsorships (business_id, employee_id, provider, course_name, location, start_date, end_date, cost, currency, notes)
  values (p_business, v_emp, trim(left(p_provider, 160)), trim(left(p_course, 200)), nullif(trim(left(p_location, 160)), ''),
          p_start, p_end, p_cost, coalesce(v_cur, 'MVR'), nullif(trim(left(p_notes, 2000)), ''))
  returning id into v_id;
  select trim(e.first_name || ' ' || e.last_name) into v_name from public.employees e where e.id = v_emp;
  perform private.create_request(p_business, 'training_sponsorship', 'learning', 'training_sponsorships', v_id, v_emp,
    'Paid training for ' || v_name, trim(p_course) || ' with ' || trim(p_provider), p_cost, '{}'::jsonb);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------
-- Opening a round creates a review for everyone in it and tells them.
create or replace function public.open_review_cycle(p_cycle uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  cy public.review_cycles;
  e record;
  v_n integer := 0;
  v_depts uuid[];
  v_branches uuid[];
  v_id uuid;
begin
  select * into cy from public.review_cycles where id = p_cycle;
  if cy.id is null or cy.business_id not in (select private.biz_all('reviews', 'edit')) then
    raise exception 'You don''t have permission to run review rounds' using errcode = '42501';
  end if;
  if cy.status = 'closed' then raise exception 'This round is closed' using errcode = '22023'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_depts from jsonb_array_elements_text(coalesce(cy.participant_filter -> 'department_ids', '[]'::jsonb)) x;
  select coalesce(array_agg(x::uuid), '{}') into v_branches from jsonb_array_elements_text(coalesce(cy.participant_filter -> 'branch_ids', '[]'::jsonb)) x;
  for e in
    select emp.id, emp.manager_id from public.employees emp
     where emp.business_id = cy.business_id and emp.status in ('active', 'probation', 'on_leave')
       and (cardinality(v_depts) = 0 or emp.department_id = any (v_depts))
       and (cardinality(v_branches) = 0 or emp.branch_id = any (v_branches))
  loop
    v_id := null;
    insert into public.reviews (business_id, cycle_id, employee_id, reviewer_employee_id)
    values (cy.business_id, cy.id, e.id, e.manager_id)
    on conflict (cycle_id, employee_id) do nothing
    returning id into v_id;
    if v_id is not null then
      v_n := v_n + 1;
      perform private.notify(cy.business_id, private.user_for_employee(cy.business_id, e.id), 'review.opened',
        'Time for your review: ' || cy.name,
        case when cy.self_review_due is not null then 'Please fill in your part by ' || to_char(cy.self_review_due, 'DD Mon YYYY') || '.' else 'Please fill in your part.' end,
        '/staff/reviews/' || v_id, 'performance');
    end if;
  end loop;
  update public.review_cycles set status = 'open' where id = cy.id;
  return v_n;
end $$;

-- What the current user can do with a review: 'self', 'manager' or null.
create or replace function private.review_role(r public.reviews)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.my_employee_in(r.business_id);
begin
  if v_me is not null and v_me = r.employee_id then return 'self'; end if;
  if (v_me is not null and v_me = r.reviewer_employee_id)
     or r.business_id in (select private.biz_all('reviews', 'edit'))
     or r.employee_id in (select private.team_scope('reviews', 'edit')) then
    return 'manager';
  end if;
  return null;
end $$;

-- Save answers. p_answers = [{ "question_id": "...", "rating": 4, "answer": "..." }].
-- p_submit = true hands it on: self review → manager, manager review → finished.
create or replace function public.save_review(
  p_review uuid, p_answers jsonb, p_submit boolean default false,
  p_overall numeric default null, p_summary text default null, p_meeting_notes text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.reviews;
  cy public.review_cycles;
  v_role text;
  v_me uuid;
  a jsonb;
  q public.review_questions;
  v_rating smallint;
  v_text text;
  v_missing integer;
  v_user uuid;
begin
  select * into r from public.reviews where id = p_review;
  if r.id is null then raise exception 'Review not found' using errcode = '22023'; end if;
  select * into cy from public.review_cycles where id = r.cycle_id;
  if cy.status <> 'open' then raise exception 'This review round isn''t open' using errcode = '22023'; end if;
  v_role := private.review_role(r);
  if v_role is null then raise exception 'You can''t fill in this review' using errcode = '42501'; end if;
  if v_role = 'self' and r.status <> 'self_review' then
    raise exception 'You''ve already sent your part' using errcode = '22023';
  end if;
  if v_role = 'manager' and r.status not in ('self_review', 'manager_review', 'meeting') then
    raise exception 'This review is already finished' using errcode = '22023';
  end if;
  v_me := private.my_employee_in(r.business_id);
  for a in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    select * into q from public.review_questions where id = (a ->> 'question_id')::uuid and template_id = cy.template_id;
    continue when q.id is null or q.audience not in ('all', v_role);
    v_rating := nullif(a ->> 'rating', '')::smallint;
    if v_rating is not null and (v_rating < 1 or v_rating > 5) then raise exception 'Ratings go from 1 to 5' using errcode = '22023'; end if;
    v_text := nullif(trim(left(a ->> 'answer', 4000)), '');
    -- One row per review, question and side. Managers' answers belong to the review, not the person who typed them.
    delete from public.review_responses where review_id = r.id and question_id = q.id and respondent_type = v_role;
    insert into public.review_responses (business_id, review_id, question_id, respondent_type, respondent_employee_id, rating, answer, submitted_at)
    values (r.business_id, r.id, q.id, v_role, v_me, v_rating, v_text, case when p_submit then now() end);
  end loop;

  if v_role = 'manager' then
    update public.reviews set
      overall_rating = coalesce(p_overall, overall_rating),
      manager_summary = coalesce(nullif(trim(p_summary), ''), manager_summary),
      meeting_notes = coalesce(nullif(trim(p_meeting_notes), ''), meeting_notes)
    where id = r.id;
  end if;

  if p_submit then
    select count(*) into v_missing from public.review_questions q2
     where q2.template_id = cy.template_id and q2.is_required and q2.audience in ('all', v_role)
       and not exists (select 1 from public.review_responses rr
                        where rr.review_id = r.id and rr.question_id = q2.id and rr.respondent_type = v_role
                          and (q2.kind = 'text' or rr.rating is not null)
                          and (q2.kind = 'rating' or rr.answer is not null or q2.kind = 'rating_text'));
    if v_missing > 0 then
      raise exception 'Answer every question before sending (% left)', v_missing using errcode = '22023';
    end if;
    if v_role = 'self' then
      update public.reviews set status = 'manager_review', self_submitted_at = now() where id = r.id;
      v_user := private.user_for_employee(r.business_id, r.reviewer_employee_id);
      if v_user is not null then
        perform private.notify(r.business_id, v_user, 'review.self_done',
          (select trim(e.first_name || ' ' || e.last_name) from public.employees e where e.id = r.employee_id) || ' finished their self review',
          cy.name, '/app/reviews/review/' || r.id, 'performance');
      end if;
      return 'manager_review';
    else
      if coalesce(p_overall, r.overall_rating) is null then
        raise exception 'Give an overall rating' using errcode = '22023';
      end if;
      update public.reviews set status = 'finalized', manager_submitted_at = now(), finalized_at = now() where id = r.id;
      return 'finalized';
    end if;
  end if;
  return r.status;
end $$;

create or replace function public.share_review(p_review uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reviews;
begin
  select * into r from public.reviews where id = p_review;
  if r.id is null or private.review_role(r) is distinct from 'manager' then
    raise exception 'You can''t share this review' using errcode = '42501';
  end if;
  if r.status <> 'finalized' then raise exception 'Finish the review before sharing it' using errcode = '22023'; end if;
  update public.reviews set status = 'shared', shared_at = now() where id = r.id;
  perform private.notify(r.business_id, private.user_for_employee(r.business_id, r.employee_id), 'review.shared',
    'Your review is ready', 'Read it and add your comments.', '/staff/reviews/' || r.id, 'performance');
end $$;

create or replace function public.acknowledge_review(p_review uuid, p_comment text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reviews;
begin
  select * into r from public.reviews where id = p_review;
  if r.id is null or private.review_role(r) is distinct from 'self' then
    raise exception 'That isn''t your review' using errcode = '42501';
  end if;
  if r.status <> 'shared' then raise exception 'This review hasn''t been shared with you yet' using errcode = '22023'; end if;
  update public.reviews set status = 'acknowledged', acknowledged_at = now(),
    employee_comment = nullif(trim(left(p_comment, 4000)), '') where id = r.id;
end $$;

-- ---------------------------------------------------------------------
-- Surveys
-- ---------------------------------------------------------------------
-- Is this person in the survey's audience?
create or replace function private.in_survey_audience(s public.surveys, p_employee uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees e
     where e.id = p_employee and e.business_id = s.business_id
       and (jsonb_array_length(coalesce(s.audience -> 'department_ids', '[]'::jsonb)) = 0
            or e.department_id::text in (select jsonb_array_elements_text(s.audience -> 'department_ids')))
       and (jsonb_array_length(coalesce(s.audience -> 'branch_ids', '[]'::jsonb)) = 0
            or e.branch_id::text in (select jsonb_array_elements_text(s.audience -> 'branch_ids'))))
$$;

-- Tell everyone in the audience when a survey opens.
create or replace function private.after_survey_opened() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if new.status = 'open' and old.status is distinct from 'open' then
    for m in select bm.user_id, bm.employee_id from public.business_members bm
              where bm.business_id = new.business_id and bm.status = 'active' and bm.employee_id is not null
    loop
      if private.in_survey_audience(new, m.employee_id) then
        perform private.notify(new.business_id, m.user_id, 'survey.opened', 'New survey: ' || new.title,
          case when new.is_anonymous then 'It''s anonymous and takes a few minutes.' else 'It takes a few minutes.' end,
          '/staff/surveys/' || new.id, 'performance');
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists after_survey_opened on public.surveys;
create trigger after_survey_opened after update of status on public.surveys
  for each row execute function private.after_survey_opened();

-- Open surveys for me, and whether I've answered.
create or replace function public.my_surveys(p_business uuid)
returns table (id uuid, title text, description text, is_anonymous boolean, closes_at timestamptz, answered boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, s.description, s.is_anonymous, s.closes_at,
         exists (select 1 from public.survey_participation p where p.survey_id = s.id and p.employee_id = private.my_employee_in(p_business))
    from public.surveys s
   where s.business_id = p_business and s.status = 'open'
     and (s.closes_at is null or s.closes_at > now())
     and private.my_employee_in(p_business) is not null
     and private.in_survey_audience(s, private.my_employee_in(p_business))
   order by s.created_at desc
$$;

-- The questions of an open survey, for someone it's meant for.
create or replace function public.my_survey_questions(p_survey uuid)
returns table (id uuid, question text, kind text, options jsonb, is_required boolean)
language sql stable security definer set search_path = '' as $$
  select q.id, q.question, q.kind, q.options, q.is_required
    from public.survey_questions q
    join public.surveys s on s.id = q.survey_id
   where q.survey_id = p_survey and s.status = 'open'
     and (s.closes_at is null or s.closes_at > now())
     and private.my_employee_in(s.business_id) is not null
     and private.in_survey_audience(s, private.my_employee_in(s.business_id))
   order by q.sort
$$;

-- p_answers = { "<question id>": value }. Scale/nps: number, single: "option", multiple: ["a","b"], text: "...".
create or replace function public.submit_survey(p_survey uuid, p_answers jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.surveys;
  v_emp uuid;
  q public.survey_questions;
  v jsonb;
  v_resp uuid;
  v_n numeric;
begin
  select * into s from public.surveys where id = p_survey;
  if s.id is null then raise exception 'Survey not found' using errcode = '22023'; end if;
  v_emp := private.my_employee_in(s.business_id);
  if v_emp is null or not private.in_survey_audience(s, v_emp) then
    raise exception 'This survey isn''t for you' using errcode = '42501';
  end if;
  if s.status <> 'open' or (s.closes_at is not null and s.closes_at <= now()) then
    raise exception 'This survey is closed' using errcode = '22023';
  end if;
  if exists (select 1 from public.survey_participation where survey_id = s.id and employee_id = v_emp) then
    raise exception 'You''ve already answered this survey' using errcode = '22023';
  end if;
  -- Check every answer before saving anything.
  for q in select * from public.survey_questions where survey_id = s.id order by sort loop
    v := p_answers -> q.id::text;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then
      if q.is_required then raise exception 'Answer every question marked as required' using errcode = '22023'; end if;
      continue;
    end if;
    if q.kind in ('scale', 'nps') then
      if jsonb_typeof(v) <> 'number' then raise exception 'Choose a number' using errcode = '22023'; end if;
      v_n := v::text::numeric;
      if (q.kind = 'scale' and (v_n < 1 or v_n > 5)) or (q.kind = 'nps' and (v_n < 0 or v_n > 10)) or v_n <> trunc(v_n) then
        raise exception 'That number is out of range' using errcode = '22023';
      end if;
    elsif q.kind = 'single' then
      if jsonb_typeof(v) <> 'string' or not (q.options ? (v #>> '{}')) then raise exception 'Choose one of the options' using errcode = '22023'; end if;
    elsif q.kind = 'multiple' then
      if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements_text(v) x where not (q.options ? x)) then
        raise exception 'Choose from the options' using errcode = '22023';
      end if;
    elsif q.kind = 'text' then
      if jsonb_typeof(v) <> 'string' then raise exception 'Write an answer' using errcode = '22023'; end if;
    end if;
  end loop;

  insert into public.survey_participation (business_id, survey_id, employee_id) values (s.business_id, s.id, v_emp);
  insert into public.survey_responses (business_id, survey_id, respondent_employee_id)
  values (s.business_id, s.id, case when s.is_anonymous then null else v_emp end)
  returning id into v_resp;
  for q in select * from public.survey_questions where survey_id = s.id loop
    v := p_answers -> q.id::text;
    continue when v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb;
    if q.kind = 'text' then v := to_jsonb(left(v #>> '{}', 4000)); end if;
    insert into public.survey_answers (business_id, response_id, question_id, value) values (s.business_id, v_resp, q.id, v);
  end loop;
end $$;

-- Results per question. For anonymous surveys nothing is shown until enough people answered.
create or replace function public.survey_results(p_survey uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.surveys;
  v_count integer;
  v_invited integer;
  v_out jsonb := '[]'::jsonb;
  q public.survey_questions;
  v_q jsonb;
begin
  select * into s from public.surveys where id = p_survey;
  if s.id is null or s.business_id not in (select private.biz_all('surveys', 'view')) then
    raise exception 'You don''t have permission to see survey results' using errcode = '42501';
  end if;
  select count(*) into v_count from public.survey_responses where survey_id = s.id;
  select count(*) into v_invited from public.employees e
   where e.business_id = s.business_id and e.status in ('active', 'probation', 'on_leave') and private.in_survey_audience(s, e.id);
  if s.is_anonymous and v_count < s.min_responses_to_show then
    return jsonb_build_object('responses', v_count, 'invited', v_invited, 'hidden', true, 'min', s.min_responses_to_show, 'questions', '[]'::jsonb);
  end if;
  for q in select * from public.survey_questions where survey_id = s.id order by sort loop
    if q.kind in ('scale', 'nps') then
      select jsonb_build_object('average', round(avg((a.value #>> '{}')::numeric), 1), 'answered', count(*),
               'counts', coalesce((select jsonb_object_agg(k, n) from (select a2.value #>> '{}' as k, count(*) as n
                                     from public.survey_answers a2 where a2.question_id = q.id group by 1) c), '{}'::jsonb))
        into v_q from public.survey_answers a where a.question_id = q.id;
    elsif q.kind in ('single', 'multiple') then
      select jsonb_build_object('answered', (select count(*) from public.survey_answers where question_id = q.id),
               'counts', coalesce(jsonb_object_agg(k, n), '{}'::jsonb))
        into v_q from (
          select x as k, count(*) as n from public.survey_answers a,
                 lateral jsonb_array_elements_text(case when jsonb_typeof(a.value) = 'array' then a.value else jsonb_build_array(a.value) end) x
           where a.question_id = q.id group by x) c;
    else
      -- Written answers are shuffled so their order can't hint at who wrote them.
      select jsonb_build_object('answered', count(*), 'texts', coalesce(jsonb_agg(a.value #>> '{}' order by md5(a.id::text)), '[]'::jsonb))
        into v_q from public.survey_answers a where a.question_id = q.id;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', q.id, 'question', q.question, 'kind', q.kind, 'options', q.options) || v_q);
  end loop;
  return jsonb_build_object('responses', v_count, 'invited', v_invited, 'hidden', false, 'min', s.min_responses_to_show, 'questions', v_out);
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on function public.assign_course(uuid, text, uuid, date, boolean) from public, anon;
revoke all on function public.complete_lesson(uuid, uuid) from public, anon;
revoke all on function public.submit_quiz(uuid, uuid, jsonb) from public, anon;
revoke all on function public.save_quiz_question(uuid, uuid, text, text, jsonb, text[], text) from public, anon;
revoke all on function public.send_learning_reminders() from public, anon, authenticated;
revoke all on function public.request_paid_training(uuid, text, text, text, date, date, numeric, text) from public, anon;
revoke all on function public.open_review_cycle(uuid) from public, anon;
revoke all on function public.save_review(uuid, jsonb, boolean, numeric, text, text) from public, anon;
revoke all on function public.share_review(uuid) from public, anon;
revoke all on function public.acknowledge_review(uuid, text) from public, anon;
revoke all on function public.my_surveys(uuid) from public, anon;
revoke all on function public.submit_survey(uuid, jsonb) from public, anon;
revoke all on function public.my_survey_questions(uuid) from public, anon;
revoke all on function public.survey_results(uuid) from public, anon;
grant execute on function public.assign_course(uuid, text, uuid, date, boolean) to authenticated;
grant execute on function public.complete_lesson(uuid, uuid) to authenticated;
grant execute on function public.submit_quiz(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_quiz_question(uuid, uuid, text, text, jsonb, text[], text) to authenticated;
grant execute on function public.send_learning_reminders() to service_role;
grant execute on function public.request_paid_training(uuid, text, text, text, date, date, numeric, text) to authenticated;
grant execute on function public.open_review_cycle(uuid) to authenticated;
grant execute on function public.save_review(uuid, jsonb, boolean, numeric, text, text) to authenticated;
grant execute on function public.share_review(uuid) to authenticated;
grant execute on function public.acknowledge_review(uuid, text) to authenticated;
grant execute on function public.my_surveys(uuid) to authenticated;
grant execute on function public.submit_survey(uuid, jsonb) to authenticated;
grant execute on function public.my_survey_questions(uuid) to authenticated;
grant execute on function public.survey_results(uuid) to authenticated;
grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260924000001_learning_and_reviews.sql') on conflict do nothing;

-- ===================== 20260925000001_security_hardening.sql =====================
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
insert into private.schema_migrations (name) values ('20260925000001_security_hardening.sql') on conflict do nothing;

-- ===================== 20260925000002_speed_indexes.sql =====================
-- =====================================================================
-- 0018 SPEED: indexes for lookups the app does on every visit
--   (the staff app's "my courses / reviews / goals / checklists / permits",
--    bank details on payroll, survey results, and finding the approval
--    request behind a claim or leave request).
-- =====================================================================
create index if not exists course_enrollments_employee_idx on public.course_enrollments (employee_id);
create index if not exists quiz_attempts_enrollment_idx on public.quiz_attempts (enrollment_id, lesson_id);
create index if not exists reviews_employee_idx on public.reviews (employee_id);
create index if not exists reviews_reviewer_idx on public.reviews (reviewer_employee_id);
create index if not exists goals_business_level_idx on public.goals (business_id, level);
create index if not exists goals_employee_idx on public.goals (employee_id);
create index if not exists employee_checklists_employee_idx on public.employee_checklists (employee_id);
create index if not exists compliance_items_employee_idx on public.compliance_items (employee_id);
create index if not exists employee_bank_accounts_employee_idx on public.employee_bank_accounts (employee_id);
create index if not exists survey_answers_question_idx on public.survey_answers (question_id);
create index if not exists approval_requests_source_idx on public.approval_requests (source_table, source_id);
create index if not exists training_sponsorships_employee_idx on public.training_sponsorships (employee_id);
create index if not exists applications_vacancy_stage_idx on public.applications (vacancy_id, stage);

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260925000002_speed_indexes.sql') on conflict do nothing;

-- ===================== 20260926000001_platform_admin.sql =====================
-- =====================================================================
-- 0019 PLATFORM ADMIN AND SUBSCRIPTIONS
--   * Plan fields on each company: paid-until date, custom price or discount
--   * Plan status worked out from the dates: trial, active, grace (7 days
--     after the end), suspended (read-only) or cancelled
--   * Suspended companies are read-only: every change is refused by the
--     database, whatever screen it comes from. Viewing and exporting still work.
--   * Payments (recorded by Nuit Works), private admin notes, an admin audit
--     log and a record of reminder emails
--   * Support access shows everything except pay, and never allows changes
--   * Admin-only reports, callable with the server's secret key only
-- =====================================================================

-- ---------------------------------------------------------------------
-- Is this request made with the server's secret key (service role)?
-- Inside functions that run with elevated rights current_user changes,
-- but the role the request came in with stays in the "role" setting.
-- ---------------------------------------------------------------------
create or replace function private.is_service_request() returns boolean
language sql stable as $$
  select coalesce(current_setting('role', true), '') = 'service_role'
      or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
$$;

-- ---------------------------------------------------------------------
-- Plan fields
-- ---------------------------------------------------------------------
alter table public.businesses drop constraint if exists businesses_plan_status_check;
alter table public.businesses add constraint businesses_plan_status_check
  check (plan_status in ('trial', 'active', 'past_due', 'suspended', 'cancelled'));
alter table public.businesses
  add column if not exists paid_until timestamptz,
  add column if not exists custom_monthly_price numeric(12,2) check (custom_monthly_price is null or custom_monthly_price >= 0),
  add column if not exists discount_percent numeric(5,2) check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  add column if not exists price_override_until date,
  add column if not exists plan_note text;

-- Companies can't change their own plan, dates or price; only Nuit Works (server key) can.
create or replace function private.guard_business_plan() returns trigger
language plpgsql as $$
begin
  if private.is_client_context() and not private.is_service_request() and tg_op = 'UPDATE'
     and (new.plan_status is distinct from old.plan_status
          or new.trial_ends_at is distinct from old.trial_ends_at
          or new.paid_until is distinct from old.paid_until
          or new.custom_monthly_price is distinct from old.custom_monthly_price
          or new.discount_percent is distinct from old.discount_percent
          or new.price_override_until is distinct from old.price_override_until
          or new.plan_note is distinct from old.plan_note) then
    raise exception 'Only Harbor can change your plan' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_business_plan on public.businesses;
create trigger guard_business_plan before update on public.businesses
  for each row execute function private.guard_business_plan();

-- ---------------------------------------------------------------------
-- Plan status from the dates
-- ---------------------------------------------------------------------
create or replace function private.plan_state(p_status text, p_trial_ends timestamptz, p_paid_until timestamptz)
returns text
language sql stable as $$
  select case
    when p_status in ('suspended', 'cancelled') then p_status
    when coalesce(case when p_status = 'trial' then p_trial_ends else p_paid_until end, 'infinity'::timestamptz) > now() then
      case when p_status = 'trial' then 'trial' else 'active' end
    when case when p_status = 'trial' then p_trial_ends else p_paid_until end + interval '7 days' > now() then 'grace'
    else 'suspended'
  end
$$;

create or replace function private.business_state(p_business uuid) returns text
language sql stable security definer set search_path = '' as $$
  select private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until) from public.businesses b where b.id = p_business
$$;

create or replace function private.business_read_only(p_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.business_state(p_business) in ('suspended', 'cancelled'), false)
$$;

-- What members see about their company's plan (banners, Workspace → Billing).
create or replace function public.my_plan(p_business uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until),
    'plan_status', b.plan_status,
    'trial_ends_at', b.trial_ends_at,
    'paid_until', b.paid_until,
    'ends_at', case when b.plan_status = 'trial' then b.trial_ends_at else b.paid_until end,
    'custom_monthly_price', b.custom_monthly_price,
    'discount_percent', b.discount_percent,
    'price_override_until', b.price_override_until)
  from public.businesses b
  where b.id = p_business and b.id in (select private.my_business_ids())
$$;
revoke all on function public.my_plan(uuid) from public, anon;
grant execute on function public.my_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Read-only when suspended: refuse changes made by people (not by the
-- server key or scheduled jobs, which have no signed-in user).
-- ---------------------------------------------------------------------
create or replace function private.block_when_read_only() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_bid uuid;
begin
  if auth.uid() is null or private.is_service_request() then return coalesce(new, old); end if;
  v_bid := coalesce((v_row ->> 'business_id')::uuid, case when tg_table_name = 'businesses' then (v_row ->> 'id')::uuid end);
  if v_bid is not null and private.business_read_only(v_bid) then
    raise exception 'This company''s Harbor plan is paused, so changes can''t be saved. You can still view and export your data. Contact Nuit Works to reactivate.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- Tables that stay writable while paused: reading notifications, choosing
-- notification settings, exporting data, and turning support access on.
create or replace function private.read_only_exempt(p_table text) returns boolean
language sql immutable as $$
  select p_table in ('notifications', 'notification_preferences', 'notification_deliveries', 'data_exports',
                     'support_access_grants', 'audit_log', 'onboarding_drafts',
                     'platform_payments', 'platform_admin_notes', 'platform_audit_log', 'platform_billing_reminders')
$$;

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

    -- Paused companies are read-only.
    if (r.relname = 'businesses' or exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'business_id'))
       and not private.read_only_exempt(r.relname)
       and not exists (select 1 from pg_trigger where tgname = 'trg_read_only' and tgrelid = format('public.%I', r.relname)::regclass) then
      execute format('create trigger trg_read_only before insert or update or delete on public.%I for each row execute function private.block_when_read_only()', r.relname);
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

-- Files: no uploads or deletions while paused (downloads still work).
do $$
declare d text;
begin
  d := pg_get_functiondef('private.storage_can(text, text)'::regprocedure);
  d := replace(d,
    '  v_area := parts[2];',
    '  if p_action <> ''view'' and parts[2] <> ''exports'' and private.business_read_only(v_bid) then
    return false;
  end if;

  v_area := parts[2];');
  if d not like '%business_read_only(v_bid)%' then
    raise exception 'storage_can did not match the expected text';
  end if;
  execute d;
end $$;

-- ---------------------------------------------------------------------
-- Support access: read-only, and never pay data
-- ---------------------------------------------------------------------
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
  -- Temporary support access is read-only and leaves out pay.
  select g.business_id, null::uuid, 'all'
    from public.support_access_grants g
   where p_action = 'view' and p_resource not in ('compensation', 'payroll', 'payslips')
     and g.revoked_at is null and g.expires_at > now()
     and exists (select 1 from public.platform_admins p where p.user_id = auth.uid())
     and not exists (select 1 from public.business_members m2 where m2.business_id = g.business_id and m2.user_id = auth.uid())
$$;

-- Companies a platform admin may open as support right now.
create or replace function public.my_support_access()
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
    'support_expires_at', g.expires_at,
    'modules', coalesce((select jsonb_agg(bm.module_key order by bm.module_key)
                           from public.business_modules bm
                          where bm.business_id = b.id and bm.enabled), '[]'::jsonb)
  ) order by b.name), '[]'::jsonb)
  from public.businesses b
  join lateral (select max(g2.expires_at) as expires_at from public.support_access_grants g2
                 where g2.business_id = b.id and g2.revoked_at is null and g2.expires_at > now()) g on g.expires_at is not null
  where exists (select 1 from public.platform_admins p where p.user_id = auth.uid())
    and not exists (select 1 from public.business_members m where m.business_id = b.id and m.user_id = auth.uid())
$$;
revoke all on function public.my_support_access() from public, anon;
grant execute on function public.my_support_access() to authenticated;

-- ---------------------------------------------------------------------
-- Nuit Works tables (only the server key reads and writes these,
-- except that owners can see their own payment history)
-- ---------------------------------------------------------------------
create table if not exists public.platform_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'MVR',
  paid_on date not null,
  method text not null check (method in ('bank_transfer', 'mobile_payment', 'cash', 'other')),
  reference text,
  receipt_path text,
  period_start date,
  period_end date,
  notes text,
  recorded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index if not exists platform_payments_business_idx on public.platform_payments (business_id, paid_on desc);
alter table public.platform_payments enable row level security;
drop policy if exists owner_select on public.platform_payments;
create policy owner_select on public.platform_payments for select to authenticated
  using (private.is_owner(business_id));

create table if not exists public.platform_admin_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
alter table public.platform_admin_notes enable row level security;

create table if not exists public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid,
  admin_email text not null,
  action text not null,
  business_id uuid references public.businesses (id) on delete set null,
  business_name text,
  reason text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_business_idx on public.platform_audit_log (business_id, created_at desc);
create index if not exists platform_audit_created_idx on public.platform_audit_log (created_at desc);
alter table public.platform_audit_log enable row level security;

create table if not exists public.platform_billing_reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null,
  period_end timestamptz,
  sent_at timestamptz not null default now(),
  unique (business_id, kind, period_end)
);
alter table public.platform_billing_reminders enable row level security;

-- Nobody signed in to the app reads or writes these; only the server key (which skips these rules).
drop policy if exists no_app_access on public.platform_admin_notes;
create policy no_app_access on public.platform_admin_notes for all to authenticated using (false) with check (false);
drop policy if exists no_app_access on public.platform_audit_log;
create policy no_app_access on public.platform_audit_log for all to authenticated using (false) with check (false);
drop policy if exists no_app_access on public.platform_billing_reminders;
create policy no_app_access on public.platform_billing_reminders for all to authenticated using (false) with check (false);

-- ---------------------------------------------------------------------
-- Keep the platform_admins table (used by support access) in line with
-- the PLATFORM_ADMIN_EMAILS setting. Server key only.
-- ---------------------------------------------------------------------
create or replace function public.admin_sync_platform_admins(p_emails text[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  delete from public.platform_admins p
   where not exists (select 1 from auth.users u where u.id = p.user_id and lower(u.email) = any (select lower(x) from unnest(p_emails) x));
  insert into public.platform_admins (user_id)
  select u.id from auth.users u
   where lower(u.email) = any (select lower(x) from unnest(p_emails) x) and u.email_confirmed_at is not null
  on conflict (user_id) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Admin reports (server key only). Never returns people's HR data.
-- ---------------------------------------------------------------------
create or replace function public.admin_businesses()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', b.id, 'name', b.name, 'slug', b.slug, 'industry', b.industry, 'country', b.country, 'currency', b.currency,
        'employee_count_range', b.employee_count_range, 'created_at', b.created_at, 'onboarding_completed_at', b.onboarding_completed_at,
        'plan_status', b.plan_status, 'status', private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until),
        'trial_ends_at', b.trial_ends_at, 'paid_until', b.paid_until,
        'custom_monthly_price', b.custom_monthly_price, 'discount_percent', b.discount_percent, 'price_override_until', b.price_override_until,
        'staff_count', (select count(*) from public.employees e where e.business_id = b.id and e.status in ('active', 'probation', 'on_leave', 'suspended')),
        'modules', coalesce((select jsonb_agg(bm.module_key order by bm.module_key) from public.business_modules bm where bm.business_id = b.id and bm.enabled), '[]'::jsonb),
        'owner', (select jsonb_build_object('name', p.full_name, 'email', u.email, 'phone', coalesce(p.phone, b.phone))
                    from public.business_members m join public.roles r on r.id = m.role_id and r.is_owner
                    join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
                   where m.business_id = b.id and m.status = 'active' order by m.created_at limit 1),
        'last_active', (select max(u.last_sign_in_at) from public.business_members m join auth.users u on u.id = m.user_id
                         where m.business_id = b.id and m.status = 'active'),
        'last_payment', (select max(pp.paid_on) from public.platform_payments pp where pp.business_id = b.id),
        'support_until', (select max(g.expires_at) from public.support_access_grants g where g.business_id = b.id and g.revoked_at is null and g.expires_at > now())
      ) as x
      from public.businesses b
    ) t
  );
end $$;

create or replace function public.admin_business_detail(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', now())::date;
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'business', to_jsonb(b) - 'signature_path' - 'stamp_path' || jsonb_build_object('status', private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until)),
      'admins', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'email', u.email, 'phone', p.phone, 'role', r.name,
                                                               'is_owner', r.is_owner, 'last_sign_in', u.last_sign_in_at) order by r.is_owner desc, r.name)
                            from public.business_members m join public.roles r on r.id = m.role_id
                            join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
                           where m.business_id = b.id and m.status = 'active'
                             and (r.is_owner or r.key in ('admin', 'hr_manager', 'payroll_officer'))), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(br.name order by br.name) from public.branches br where br.business_id = b.id), '[]'::jsonb),
      'staff_count', (select count(*) from public.employees e where e.business_id = b.id and e.status in ('active', 'probation', 'on_leave', 'suspended')),
      'logins', (select count(*) from public.business_members m where m.business_id = b.id and m.status = 'active'),
      'modules', coalesce((select jsonb_agg(bm.module_key order by bm.module_key) from public.business_modules bm where bm.business_id = b.id and bm.enabled), '[]'::jsonb),
      'last_active', (select max(u.last_sign_in_at) from public.business_members m join auth.users u on u.id = m.user_id where m.business_id = b.id and m.status = 'active'),
      'payroll_runs', (select count(*) from public.payroll_runs pr where pr.business_id = b.id),
      'requests_this_month', (select count(*) from public.approval_requests ar where ar.business_id = b.id and ar.created_at >= v_month),
      'support_until', (select max(g.expires_at) from public.support_access_grants g where g.business_id = b.id and g.revoked_at is null and g.expires_at > now())
    )
    from public.businesses b where b.id = p_business
  );
end $$;

-- Which owners should get a reminder email today (not sent yet for this period end).
create or replace function public.admin_billing_reminders_due()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('business_id', t.id, 'business_name', t.name, 'kind', t.kind, 'period_end', t.ends_at,
                                                 'plan_status', t.plan_status, 'timezone', t.timezone, 'owner_emails', t.owners)), '[]'::jsonb)
    from (
      select b.id, b.name, b.plan_status, b.timezone, e.ends_at,
             case
               when private.plan_state(b.plan_status, b.trial_ends_at, b.paid_until) = 'suspended' and b.plan_status <> 'suspended' then 'suspended'
               when e.ends_at between now() and now() + interval '1 day' then 'ends_1'
               when e.ends_at between now() + interval '1 day' and now() + interval '7 days' then 'ends_7'
             end as kind,
             (select coalesce(jsonb_agg(u.email), '[]'::jsonb) from public.business_members m join public.roles r on r.id = m.role_id and r.is_owner
                join auth.users u on u.id = m.user_id where m.business_id = b.id and m.status = 'active') as owners
        from public.businesses b
        cross join lateral (select case when b.plan_status = 'trial' then b.trial_ends_at else b.paid_until end as ends_at) e
       where b.plan_status not in ('cancelled') and e.ends_at is not null and b.onboarding_completed_at is not null
    ) t
    where t.kind is not null
      and not exists (select 1 from public.platform_billing_reminders r
                       where r.business_id = t.id and r.kind = t.kind and r.period_end = t.ends_at)
  );
end $$;

-- Nuit Works can switch tools on or off for a company (same rules as the company's own screen).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.set_business_modules(uuid, text[])'::regprocedure);
  d := replace(d,
    'if p_business not in (select private.biz_all(''modules'', ''edit'')) then',
    'if not private.is_service_request() and p_business not in (select private.biz_all(''modules'', ''edit'')) then');
  if d not like '%is_service_request()%' then
    raise exception 'set_business_modules did not match the expected text';
  end if;
  execute d;
end $$;

revoke all on function public.admin_sync_platform_admins(text[]) from public, anon, authenticated;
revoke all on function public.admin_businesses() from public, anon, authenticated;
revoke all on function public.admin_business_detail(uuid) from public, anon, authenticated;
revoke all on function public.admin_billing_reminders_due() from public, anon, authenticated;
grant execute on function public.admin_sync_platform_admins(text[]) to service_role;
grant execute on function public.admin_businesses() to service_role;
grant execute on function public.admin_business_detail(uuid) to service_role;
grant execute on function public.admin_billing_reminders_due() to service_role;
grant execute on all functions in schema private to authenticated, service_role;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260926000001_platform_admin.sql') on conflict do nothing;

-- ===================== 20260926000002_paused_can_contact_support.sql =====================
-- =====================================================================
-- 0020 A paused (read-only) company can still message support.
-- =====================================================================
create or replace function private.read_only_exempt(p_table text) returns boolean
language sql immutable as $$
  select p_table in ('notifications', 'notification_preferences', 'notification_deliveries', 'data_exports',
                     'support_access_grants', 'support_tickets', 'audit_log', 'onboarding_drafts',
                     'platform_payments', 'platform_admin_notes', 'platform_audit_log', 'platform_billing_reminders')
$$;
drop trigger if exists trg_read_only on public.support_tickets;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260926000002_paused_can_contact_support.sql') on conflict do nothing;

-- ===================== 20260926000003_admin_log_keeps_history.sql =====================
-- =====================================================================
-- 0021 Deleting a company keeps Nuit Works' admin log.
--   The admin log's link to the company is cleared when the company is
--   deleted (the company name stays in the entry). The general rule that a
--   record can't move to another company must not block that.
-- =====================================================================
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

    -- The admin log outlives the companies it mentions, so it's left out here.
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'business_id')
       and r.relname <> 'platform_audit_log'
       and not exists (select 1 from pg_trigger where tgname = 'trg_lock_business_id' and tgrelid = format('public.%I', r.relname)::regclass) then
      execute format('create trigger trg_lock_business_id before update on public.%I for each row execute function private.lock_business_id()', r.relname);
    end if;

    -- Paused companies are read-only.
    if (r.relname = 'businesses' or exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.relname and column_name = 'business_id'))
       and not private.read_only_exempt(r.relname)
       and not exists (select 1 from pg_trigger where tgname = 'trg_read_only' and tgrelid = format('public.%I', r.relname)::regclass) then
      execute format('create trigger trg_read_only before insert or update or delete on public.%I for each row execute function private.block_when_read_only()', r.relname);
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

drop trigger if exists trg_lock_business_id on public.platform_audit_log;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260926000003_admin_log_keeps_history.sql') on conflict do nothing;

-- ===================== 20260927000001_admin_accounts.sql =====================
-- =====================================================================
-- 0022 ADMIN: the list of logins (accounts), for the admin area.
--   Server key only. Shows which companies each login belongs to, so a
--   test account can be found and removed.
-- =====================================================================
create or replace function public.admin_accounts()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'name', p.full_name,
        'phone', p.phone,
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'confirmed', u.email_confirmed_at is not null,
        'is_platform_admin', exists (select 1 from public.platform_admins pa where pa.user_id = u.id),
        'memberships', coalesce((
          select jsonb_agg(jsonb_build_object('business_id', b.id, 'business_name', b.name, 'role', r.name, 'is_owner', r.is_owner, 'status', m.status)
                   order by b.name)
            from public.business_members m
            join public.businesses b on b.id = m.business_id
            join public.roles r on r.id = m.role_id
           where m.user_id = u.id), '[]'::jsonb)
      ) as x
      from auth.users u
      left join public.profiles p on p.id = u.id
    ) t
  );
end $$;
revoke all on function public.admin_accounts() from public, anon, authenticated;
grant execute on function public.admin_accounts() to service_role;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260927000001_admin_accounts.sql') on conflict do nothing;

-- ===================== 20260928000001_speed_indexes_and_rls.sql =====================
-- =====================================================================
-- 0023 SPEED: indexes and faster security rules.
--   1. An index for every foreign key that didn't have one (joins, and
--      deleting a person or company, no longer scan whole tables).
--   2. A few indexes for the filters the busiest pages use.
--   3. Security rules that compared rows with auth.uid() now ask for the
--      user once per query instead of once per row. Same rules, same result.
-- =====================================================================

-- 1. Foreign keys (155)
create index if not exists announcements_branch_id_fk_idx on public.announcements (business_id, branch_id);
create index if not exists announcements_department_id_fk_idx on public.announcements (business_id, department_id);
create index if not exists announcements_created_by_fk_idx on public.announcements (created_by);
create index if not exists applications_candidate_id_fk_idx on public.applications (business_id, candidate_id);
create index if not exists applications_hired_employee_id_fk_idx on public.applications (business_id, hired_employee_id);
create index if not exists approval_delegations_delegate_user_id_fk_idx on public.approval_delegations (delegate_user_id);
create index if not exists approval_delegations_delegator_user_id_fk_idx on public.approval_delegations (delegator_user_id);
create index if not exists approval_request_steps_acted_by_fk_idx on public.approval_request_steps (acted_by);
create index if not exists approval_request_steps_approver_role_id_fk_idx on public.approval_request_steps (business_id, approver_role_id);
create index if not exists approval_request_steps_delegated_from_fk_idx on public.approval_request_steps (delegated_from);
create index if not exists approval_requests_employee_id_fk_idx on public.approval_requests (business_id, employee_id);
create index if not exists approval_requests_workflow_id_fk_idx on public.approval_requests (business_id, workflow_id);
create index if not exists approval_requests_requested_by_fk_idx on public.approval_requests (requested_by);
create index if not exists approval_workflow_steps_approver_user_id_fk_idx on public.approval_workflow_steps (approver_user_id);
create index if not exists approval_workflow_steps_approver_role_id_fk_idx on public.approval_workflow_steps (business_id, approver_role_id);
create index if not exists attendance_breaks_employee_id_fk_idx on public.attendance_breaks (business_id, employee_id);
create index if not exists attendance_breaks_record_id_fk_idx on public.attendance_breaks (business_id, record_id);
create index if not exists attendance_corrections_employee_id_fk_idx on public.attendance_corrections (business_id, employee_id);
create index if not exists attendance_corrections_record_id_fk_idx on public.attendance_corrections (business_id, record_id);
create index if not exists attendance_corrections_created_by_fk_idx on public.attendance_corrections (created_by);
create index if not exists attendance_corrections_decided_by_fk_idx on public.attendance_corrections (decided_by);
create index if not exists attendance_records_branch_id_fk_idx on public.attendance_records (business_id, branch_id);
create index if not exists attendance_records_shift_id_fk_idx on public.attendance_records (business_id, shift_id);
create index if not exists attendance_records_timesheet_id_fk_idx on public.attendance_records (business_id, timesheet_id);
create index if not exists audit_log_actor_id_fk_idx on public.audit_log (actor_id);
create index if not exists business_members_role_id_fk_idx on public.business_members (business_id, role_id);
create index if not exists businesses_created_by_fk_idx on public.businesses (created_by);
create index if not exists candidate_attachments_candidate_id_fk_idx on public.candidate_attachments (business_id, candidate_id);
create index if not exists candidate_attachments_uploaded_by_fk_idx on public.candidate_attachments (uploaded_by);
create index if not exists candidate_notes_author_id_fk_idx on public.candidate_notes (author_id);
create index if not exists candidate_notes_application_id_fk_idx on public.candidate_notes (business_id, application_id);
create index if not exists checklist_template_tasks_assignee_user_id_fk_idx on public.checklist_template_tasks (assignee_user_id);
create index if not exists checklist_template_tasks_template_id_fk_idx on public.checklist_template_tasks (business_id, template_id);
create index if not exists checklist_templates_department_id_fk_idx on public.checklist_templates (business_id, department_id);
create index if not exists checklist_templates_position_id_fk_idx on public.checklist_templates (business_id, position_id);
create index if not exists claim_types_account_code_id_fk_idx on public.claim_types (business_id, account_code_id);
create index if not exists claims_claim_type_id_fk_idx on public.claims (business_id, claim_type_id);
create index if not exists claims_payroll_run_id_fk_idx on public.claims (business_id, payroll_run_id);
create index if not exists claims_created_by_fk_idx on public.claims (created_by);
create index if not exists claims_decided_by_fk_idx on public.claims (decided_by);
create index if not exists compliance_items_document_id_fk_idx on public.compliance_items (business_id, document_id);
create index if not exists compliance_items_type_id_fk_idx on public.compliance_items (business_id, type_id);
create index if not exists course_assignments_assigned_by_fk_idx on public.course_assignments (assigned_by);
create index if not exists course_assignments_course_id_fk_idx on public.course_assignments (business_id, course_id);
create index if not exists course_enrollments_assignment_id_fk_idx on public.course_enrollments (business_id, assignment_id);
create index if not exists course_lessons_course_id_fk_idx on public.course_lessons (business_id, course_id);
create index if not exists courses_created_by_fk_idx on public.courses (created_by);
create index if not exists data_exports_requested_by_fk_idx on public.data_exports (requested_by);
create index if not exists departments_branch_id_fk_idx on public.departments (business_id, branch_id);
create index if not exists departments_head_employee_id_fk_idx on public.departments (business_id, head_employee_id);
create index if not exists departments_parent_id_fk_idx on public.departments (business_id, parent_id);
create index if not exists employee_checklist_tasks_checklist_id_fk_idx on public.employee_checklist_tasks (business_id, checklist_id);
create index if not exists employee_checklist_tasks_employee_id_fk_idx on public.employee_checklist_tasks (business_id, employee_id);
create index if not exists employee_checklist_tasks_completed_by_fk_idx on public.employee_checklist_tasks (completed_by);
create index if not exists employee_checklists_template_id_fk_idx on public.employee_checklists (business_id, template_id);
create index if not exists employee_documents_category_id_fk_idx on public.employee_documents (business_id, category_id);
create index if not exists employee_documents_uploaded_by_fk_idx on public.employee_documents (uploaded_by);
create index if not exists employee_emergency_contacts_employee_id_fk_idx on public.employee_emergency_contacts (business_id, employee_id);
create index if not exists employee_pay_components_component_id_fk_idx on public.employee_pay_components (business_id, component_id);
create index if not exists employee_pay_components_employee_id_fk_idx on public.employee_pay_components (business_id, employee_id);
create index if not exists employees_attendance_policy_id_fk_idx on public.employees (business_id, attendance_policy_id);
create index if not exists employees_branch_id_fk_idx on public.employees (business_id, branch_id);
create index if not exists employees_pay_schedule_id_fk_idx on public.employees (business_id, pay_schedule_id);
create index if not exists employees_position_id_fk_idx on public.employees (business_id, position_id);
create index if not exists expense_categories_account_code_id_fk_idx on public.expense_categories (business_id, account_code_id);
create index if not exists expense_claims_category_id_fk_idx on public.expense_claims (business_id, category_id);
create index if not exists expense_claims_employee_id_fk_idx on public.expense_claims (business_id, employee_id);
create index if not exists expense_claims_payroll_run_id_fk_idx on public.expense_claims (business_id, payroll_run_id);
create index if not exists expense_claims_created_by_fk_idx on public.expense_claims (created_by);
create index if not exists expense_claims_decided_by_fk_idx on public.expense_claims (decided_by);
create index if not exists final_settlements_approved_by_fk_idx on public.final_settlements (approved_by);
create index if not exists final_settlements_employee_id_fk_idx on public.final_settlements (business_id, employee_id);
create index if not exists final_settlements_run_id_fk_idx on public.final_settlements (business_id, run_id);
create index if not exists generated_letters_document_id_fk_idx on public.generated_letters (business_id, document_id);
create index if not exists generated_letters_employee_id_fk_idx on public.generated_letters (business_id, employee_id);
create index if not exists generated_letters_template_id_fk_idx on public.generated_letters (business_id, template_id);
create index if not exists generated_letters_generated_by_fk_idx on public.generated_letters (generated_by);
create index if not exists goal_updates_author_id_fk_idx on public.goal_updates (author_id);
create index if not exists goal_updates_goal_id_fk_idx on public.goal_updates (business_id, goal_id);
create index if not exists goals_cycle_id_fk_idx on public.goals (business_id, cycle_id);
create index if not exists goals_department_id_fk_idx on public.goals (business_id, department_id);
create index if not exists goals_parent_goal_id_fk_idx on public.goals (business_id, parent_goal_id);
create index if not exists goals_created_by_fk_idx on public.goals (created_by);
create index if not exists interviews_application_id_fk_idx on public.interviews (business_id, application_id);
create index if not exists invitations_accepted_by_fk_idx on public.invitations (accepted_by);
create index if not exists invitations_employee_id_fk_idx on public.invitations (business_id, employee_id);
create index if not exists invitations_role_id_fk_idx on public.invitations (business_id, role_id);
create index if not exists invitations_invited_by_fk_idx on public.invitations (invited_by);
create index if not exists leave_adjustments_adjusted_by_fk_idx on public.leave_adjustments (adjusted_by);
create index if not exists leave_adjustments_employee_id_fk_idx on public.leave_adjustments (business_id, employee_id);
create index if not exists leave_adjustments_leave_type_id_fk_idx on public.leave_adjustments (business_id, leave_type_id);
create index if not exists leave_balances_leave_type_id_fk_idx on public.leave_balances (business_id, leave_type_id);
create index if not exists leave_requests_leave_type_id_fk_idx on public.leave_requests (business_id, leave_type_id);
create index if not exists leave_requests_payroll_run_id_fk_idx on public.leave_requests (business_id, payroll_run_id);
create index if not exists leave_requests_created_by_fk_idx on public.leave_requests (created_by);
create index if not exists leave_requests_decided_by_fk_idx on public.leave_requests (decided_by);
create index if not exists lesson_progress_employee_id_fk_idx on public.lesson_progress (business_id, employee_id);
create index if not exists lesson_progress_lesson_id_fk_idx on public.lesson_progress (business_id, lesson_id);
create index if not exists letter_requests_employee_id_fk_idx on public.letter_requests (business_id, employee_id);
create index if not exists letter_requests_generated_letter_id_fk_idx on public.letter_requests (business_id, generated_letter_id);
create index if not exists letter_requests_template_id_fk_idx on public.letter_requests (business_id, template_id);
create index if not exists letter_requests_decided_by_fk_idx on public.letter_requests (decided_by);
create index if not exists loan_repayments_loan_id_fk_idx on public.loan_repayments (business_id, loan_id);
create index if not exists loan_repayments_run_id_fk_idx on public.loan_repayments (business_id, run_id);
create index if not exists loans_approved_by_fk_idx on public.loans (approved_by);
create index if not exists loans_employee_id_fk_idx on public.loans (business_id, employee_id);
create index if not exists notification_preferences_user_id_fk_idx on public.notification_preferences (user_id);
create index if not exists offers_application_id_fk_idx on public.offers (business_id, application_id);
create index if not exists offers_position_id_fk_idx on public.offers (business_id, position_id);
create index if not exists onboarding_drafts__fk_idx on public.onboarding_drafts (business_id);
create index if not exists pay_components_account_code_id_fk_idx on public.pay_components (business_id, account_code_id);
create index if not exists payroll_run_employees_employee_id_fk_idx on public.payroll_run_employees (business_id, employee_id);
create index if not exists payroll_run_lines_component_id_fk_idx on public.payroll_run_lines (business_id, component_id);
create index if not exists payroll_run_lines_employee_id_fk_idx on public.payroll_run_lines (business_id, employee_id);
create index if not exists payroll_run_lines_run_employee_id_fk_idx on public.payroll_run_lines (business_id, run_employee_id);
create index if not exists payroll_runs_pay_schedule_id_fk_idx on public.payroll_runs (business_id, pay_schedule_id);
create index if not exists payroll_runs_calculated_by_fk_idx on public.payroll_runs (calculated_by);
create index if not exists payroll_runs_created_by_fk_idx on public.payroll_runs (created_by);
create index if not exists payroll_runs_finalized_by_fk_idx on public.payroll_runs (finalized_by);
create index if not exists payroll_runs_reversed_by_fk_idx on public.payroll_runs (reversed_by);
create index if not exists positions_department_id_fk_idx on public.positions (business_id, department_id);
create index if not exists profiles_last_business_id_fk_idx on public.profiles (last_business_id);
create index if not exists public_holidays_branch_id_fk_idx on public.public_holidays (business_id, branch_id);
create index if not exists quiz_attempts_employee_id_fk_idx on public.quiz_attempts (business_id, employee_id);
create index if not exists quiz_attempts_lesson_id_fk_idx on public.quiz_attempts (business_id, lesson_id);
create index if not exists quiz_questions_lesson_id_fk_idx on public.quiz_questions (business_id, lesson_id);
create index if not exists review_cycles_template_id_fk_idx on public.review_cycles (business_id, template_id);
create index if not exists review_peers_peer_employee_id_fk_idx on public.review_peers (business_id, peer_employee_id);
create index if not exists review_questions_template_id_fk_idx on public.review_questions (business_id, template_id);
create index if not exists review_responses_question_id_fk_idx on public.review_responses (business_id, question_id);
create index if not exists review_responses_respondent_employee_id_fk_idx on public.review_responses (business_id, respondent_employee_id);
create index if not exists roster_entries_branch_id_fk_idx on public.roster_entries (business_id, branch_id);
create index if not exists roster_entries_shift_id_fk_idx on public.roster_entries (business_id, shift_id);
create index if not exists shifts_branch_id_fk_idx on public.shifts (business_id, branch_id);
create index if not exists support_access_grants_granted_by_fk_idx on public.support_access_grants (granted_by);
create index if not exists support_tickets_created_by_fk_idx on public.support_tickets (created_by);
create index if not exists survey_participation_employee_id_fk_idx on public.survey_participation (business_id, employee_id);
create index if not exists survey_questions_survey_id_fk_idx on public.survey_questions (business_id, survey_id);
create index if not exists survey_responses_respondent_employee_id_fk_idx on public.survey_responses (business_id, respondent_employee_id);
create index if not exists survey_responses_survey_id_fk_idx on public.survey_responses (business_id, survey_id);
create index if not exists surveys_created_by_fk_idx on public.surveys (created_by);
create index if not exists tax_brackets_tax_table_id_fk_idx on public.tax_brackets (business_id, tax_table_id);
create index if not exists timesheets_approved_by_fk_idx on public.timesheets (approved_by);
create index if not exists timesheets_payroll_run_id_fk_idx on public.timesheets (business_id, payroll_run_id);
create index if not exists training_sponsorships_approved_by_fk_idx on public.training_sponsorships (approved_by);
create index if not exists training_sponsorships_created_by_fk_idx on public.training_sponsorships (created_by);
create index if not exists transport_claims_employee_id_fk_idx on public.transport_claims (business_id, employee_id);
create index if not exists transport_claims_payroll_run_id_fk_idx on public.transport_claims (business_id, payroll_run_id);
create index if not exists transport_claims_created_by_fk_idx on public.transport_claims (created_by);
create index if not exists transport_claims_decided_by_fk_idx on public.transport_claims (decided_by);
create index if not exists vacancies_branch_id_fk_idx on public.vacancies (business_id, branch_id);
create index if not exists vacancies_department_id_fk_idx on public.vacancies (business_id, department_id);
create index if not exists vacancies_position_id_fk_idx on public.vacancies (business_id, position_id);
create index if not exists vacancies_created_by_fk_idx on public.vacancies (created_by);
create index if not exists vacancies_hiring_manager_user_id_fk_idx on public.vacancies (hiring_manager_user_id);

-- 2. Filters used by the home page, time off, hiring, news and learning
create index if not exists leave_requests_status_idx on public.leave_requests (business_id, status, start_date);
create index if not exists vacancies_status_idx on public.vacancies (business_id, status);
create index if not exists announcements_published_idx on public.announcements (business_id, published_at desc);
create index if not exists course_enrollments_due_idx on public.course_enrollments (business_id, due_date) where status <> 'completed';
create index if not exists employee_documents_expiry_idx on public.employee_documents (business_id, expiry_date);
create index if not exists employee_checklists_kind_idx on public.employee_checklists (business_id, kind, status);
create index if not exists attendance_corrections_status_idx on public.attendance_corrections (business_id, status);
create index if not exists employees_probation_idx on public.employees (business_id, probation_end_date) where probation_end_date is not null;

-- 3. Security rules (20)
alter policy tenant_delete on public.approval_delegations
  using (((delegator_user_id = (select auth.uid())) OR (business_id IN ( SELECT private.biz_all('approvals'::text, 'edit'::text) AS biz_all))));

alter policy tenant_insert on public.approval_delegations
  with check (((business_id IN ( SELECT private.my_business_ids() AS my_business_ids)) AND ((delegator_user_id = (select auth.uid())) OR (business_id IN ( SELECT private.biz_all('approvals'::text, 'edit'::text) AS biz_all))) AND private.is_active_member(business_id, delegate_user_id) AND private.is_active_member(business_id, delegator_user_id)));

alter policy tenant_select on public.approval_delegations
  using (((delegator_user_id = (select auth.uid())) OR (delegate_user_id = (select auth.uid())) OR (business_id IN ( SELECT private.biz_all('approvals'::text, 'view'::text) AS biz_all))));

alter policy tenant_update on public.approval_delegations
  using (((delegator_user_id = (select auth.uid())) OR (business_id IN ( SELECT private.biz_all('approvals'::text, 'edit'::text) AS biz_all))))
  with check (((delegator_user_id = (select auth.uid())) OR (business_id IN ( SELECT private.biz_all('approvals'::text, 'edit'::text) AS biz_all))));

alter policy tenant_select on public.approval_requests
  using (((requested_by = (select auth.uid())) OR (business_id IN ( SELECT private.biz_all('approvals'::text, 'view'::text) AS biz_all)) OR (employee_id IN ( SELECT private.emp_scope('approvals'::text, 'view'::text) AS emp_scope)) OR (id IN ( SELECT private.my_approval_request_ids() AS my_approval_request_ids))));

alter policy audit_select on public.audit_log
  using ((((business_id IS NULL) AND (actor_id = (select auth.uid()))) OR ((business_id IN ( SELECT private.biz_all('audit'::text, 'view'::text) AS biz_all)) AND ((resource IS NULL) OR (resource <> ALL (ARRAY['compensation'::text, 'payroll'::text, 'payslips'::text])))) OR ((resource IS NOT NULL) AND (business_id IN ( SELECT private.my_business_ids() AS my_business_ids)) AND private.can_emp(resource, 'view'::text, business_id, subject_employee_id))));

alter policy tenant_select on public.business_members
  using (((user_id = (select auth.uid())) OR (business_id IN ( SELECT private.biz_with('users'::text, 'view'::text) AS biz_with))));

alter policy tenant_select on public.employee_checklist_tasks
  using (((business_id IN ( SELECT private.biz_all('onboarding'::text, 'view'::text) AS biz_all)) OR (employee_id IN ( SELECT private.emp_scope('onboarding'::text, 'view'::text) AS emp_scope)) OR ((assignee_user_id = (select auth.uid())) AND (business_id IN ( SELECT private.my_business_ids() AS my_business_ids)))));

alter policy tenant_update on public.employee_checklist_tasks
  using (((business_id IN ( SELECT private.biz_all('onboarding'::text, 'edit'::text) AS biz_all)) OR (employee_id IN ( SELECT private.team_scope('onboarding'::text, 'edit'::text) AS team_scope)) OR ((assignee_user_id = (select auth.uid())) AND (business_id IN ( SELECT private.my_business_ids() AS my_business_ids)))))
  with check (((business_id IN ( SELECT private.biz_all('onboarding'::text, 'edit'::text) AS biz_all)) OR (employee_id IN ( SELECT private.team_scope('onboarding'::text, 'edit'::text) AS team_scope)) OR ((assignee_user_id = (select auth.uid())) AND (business_id IN ( SELECT private.my_business_ids() AS my_business_ids)))));

alter policy tenant_insert on public.goal_updates
  with check (((author_id = (select auth.uid())) AND (goal_id IN ( SELECT g.id
   FROM goals g
  WHERE ((g.business_id IN ( SELECT private.biz_all('goals'::text, 'edit'::text) AS biz_all)) OR (g.employee_id IN ( SELECT private.emp_scope('goals'::text, 'edit'::text) AS emp_scope)))))));

alter policy own_prefs on public.notification_preferences
  using (((user_id = (select auth.uid())) AND (business_id IN ( SELECT private.my_business_ids() AS my_business_ids))))
  with check (((user_id = (select auth.uid())) AND (business_id IN ( SELECT private.my_business_ids() AS my_business_ids))));

alter policy own_delete on public.notifications
  using ((user_id = (select auth.uid())));

alter policy own_select on public.notifications
  using (((user_id = (select auth.uid())) AND (business_id IN ( SELECT private.my_business_ids() AS my_business_ids))));

alter policy own_update on public.notifications
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy own_draft on public.onboarding_drafts
  using ((user_id = (select auth.uid())))
  with check (((user_id = (select auth.uid())) AND ((business_id IS NULL) OR (business_id IN ( SELECT private.my_business_ids() AS my_business_ids)))));

alter policy platform_admins_self on public.platform_admins
  using ((user_id = (select auth.uid())));

alter policy profiles_select on public.profiles
  using (((id = (select auth.uid())) OR (id IN ( SELECT private.co_member_user_ids() AS co_member_user_ids))));

alter policy profiles_update on public.profiles
  using ((id = (select auth.uid())))
  with check ((id = (select auth.uid())));

alter policy tenant_insert on public.support_tickets
  with check (((business_id IN ( SELECT private.my_business_ids() AS my_business_ids)) AND (created_by = (select auth.uid()))));

alter policy tenant_select on public.support_tickets
  using (((created_by = (select auth.uid())) OR (business_id IN ( SELECT private.biz_all('support'::text, 'view'::text) AS biz_all))));

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260928000001_speed_indexes_and_rls.sql') on conflict do nothing;

-- ===================== 20260929000001_pictures_and_celebrations.sql =====================
-- =====================================================================
-- 0024 PICTURES AND CELEBRATIONS
--   1. Profile pictures: a storage bucket for small square pictures
--      (uploaded by the app's server after checking permission; each
--      file has a random name).
--   2. Celebrations on Home: birthdays this week (day and month only,
--      never the year), work anniversaries and new joiners, visible to
--      everyone in the company. Staff can hide their birthday; admins
--      can switch the card off.
--   3. The request inbox also returns the person's picture.
-- =====================================================================

-- 1. Pictures ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- 2. Celebrations --------------------------------------------------------
alter table public.employees add column if not exists hide_birthday boolean not null default false;
alter table public.businesses add column if not exists celebrations_enabled boolean not null default true;

-- Everyone in the company sees these, so this returns only names, pictures,
-- the day and month of birthdays (never the year or full date of birth),
-- the number of years for anniversaries, and join dates of new joiners.
create or replace function public.celebrations(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_on boolean;
begin
  if p_business is null or p_business not in (select private.my_business_ids()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select b.celebrations_enabled, private.biz_today(b.id) into v_on, v_today from public.businesses b where b.id = p_business;
  if not coalesce(v_on, false) then
    return jsonb_build_object('enabled', false);
  end if;

  return jsonb_build_object(
    'enabled', true,
    'birthdays', coalesce((
      select jsonb_agg(x order by x ->> 'on') from (
        select jsonb_build_object(
                 'employee_id', e.id,
                 'name', trim(coalesce(nullif(e.preferred_name, ''), e.first_name) || ' ' || e.last_name),
                 'photo_path', e.photo_path,
                 'day', extract(day from e.date_of_birth)::int,
                 'month', extract(month from e.date_of_birth)::int,
                 'on', d.day) as x
          from public.employees e
          cross join lateral (
            select g::date as day from generate_series(v_today, v_today + 6, interval '1 day') g
             where extract(month from g) = extract(month from e.date_of_birth)
               and (extract(day from g) = extract(day from e.date_of_birth)
                    -- 29 February birthdays are celebrated on 28 February in other years
                    or (extract(month from e.date_of_birth) = 2 and extract(day from e.date_of_birth) = 29
                        and extract(day from g) = 28
                        and extract(day from (make_date(extract(year from g)::int, 3, 1) - 1)) = 28))
             limit 1) d
         where e.business_id = p_business
           and e.status in ('active', 'probation', 'on_leave')
           and e.date_of_birth is not null
           and not e.hide_birthday) t), '[]'::jsonb),
    'anniversaries', coalesce((
      select jsonb_agg(x order by x ->> 'on') from (
        select jsonb_build_object(
                 'employee_id', e.id,
                 'name', trim(coalesce(nullif(e.preferred_name, ''), e.first_name) || ' ' || e.last_name),
                 'photo_path', e.photo_path,
                 'years', extract(year from d.day)::int - extract(year from e.join_date)::int,
                 'on', d.day) as x
          from public.employees e
          cross join lateral (
            select g::date as day from generate_series(v_today, v_today + 6, interval '1 day') g
             where extract(month from g) = extract(month from e.join_date)
               and extract(day from g) = extract(day from e.join_date)
             limit 1) d
         where e.business_id = p_business
           and e.status in ('active', 'probation', 'on_leave')
           and e.join_date is not null
           and extract(year from d.day) > extract(year from e.join_date)) t), '[]'::jsonb),
    'joiners', coalesce((
      select jsonb_agg(x order by x ->> 'join_date' desc) from (
        select jsonb_build_object(
                 'employee_id', e.id,
                 'name', trim(coalesce(nullif(e.preferred_name, ''), e.first_name) || ' ' || e.last_name),
                 'photo_path', e.photo_path,
                 'join_date', e.join_date,
                 'position', p.title) as x
          from public.employees e
          left join public.positions p on p.business_id = e.business_id and p.id = e.position_id
         where e.business_id = p_business
           and e.status in ('active', 'probation', 'on_leave')
           and e.join_date between v_today - 14 and v_today) t), '[]'::jsonb)
  );
end $$;
revoke all on function public.celebrations(uuid) from public, anon;
grant execute on function public.celebrations(uuid) to authenticated;

-- Staff choose whether their birthday is shown to colleagues.
create or replace function public.set_my_birthday_hidden(p_business uuid, p_hidden boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid;
begin
  select m.employee_id into v_emp from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active';
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  update public.employees set hide_birthday = coalesce(p_hidden, false) where id = v_emp and business_id = p_business;
end $$;
revoke all on function public.set_my_birthday_hidden(uuid, boolean) from public, anon;
grant execute on function public.set_my_birthday_hidden(uuid, boolean) to authenticated;

-- Your own picture on your own staff profile. Only a file in your own
-- folder (stored by the app's server after checking it) can be used.
create or replace function public.set_my_photo(p_business uuid, p_path text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid;
begin
  if p_path is not null and p_path !~ ('^users/' || auth.uid()::text || '/[0-9a-f-]{36}\.(webp|jpg|png)$') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select m.employee_id into v_emp from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active';
  if v_emp is null then return; end if;
  update public.employees set photo_path = p_path where id = v_emp and business_id = p_business;
end $$;
revoke all on function public.set_my_photo(uuid, text) from public, anon;
grant execute on function public.set_my_photo(uuid, text) to authenticated;

-- 3. Request inbox with the person's picture ---------------------------------
drop function if exists public.my_request_inbox(uuid);
create function public.my_request_inbox(p_business uuid)
returns table (
  id uuid, request_type text, module_key text, title text, summary text, amount numeric, submitted_at timestamptz,
  employee_id uuid, employee_name text, requested_by_name text, step_order smallint, total_steps int, via text,
  employee_photo text)
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
              else 'admin' end,
         coalesce(e.photo_path, p.avatar_path)
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
revoke all on function public.my_request_inbox(uuid) from public, anon;
grant execute on function public.my_request_inbox(uuid) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260929000001_pictures_and_celebrations.sql') on conflict do nothing;

-- ===================== 20260929000002_employee_leave_balances.sql =====================
-- =====================================================================
-- 0025 One person's time off balances, for their profile in the office
--   view. Same permission as seeing their time off (all, team or own),
--   and brings the balances up to date first, like the Balances tab.
-- =====================================================================
create or replace function public.employee_leave_balances(p_business uuid, p_employee uuid, p_year int default null)
returns table (leave_type_id uuid, name text, color text, accrual_method text, balance numeric, taken numeric, pending numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_year int := coalesce(p_year, extract(year from private.biz_today(p_business))::int);
  lt record;
begin
  if not private.can_emp('leave', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s time off' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.business_id = p_business) then
    return;
  end if;
  for lt in select id from public.leave_types where business_id = p_business and is_active loop
    perform private.ensure_balance(p_business, p_employee, lt.id, v_year);
  end loop;
  return query
    select t.id, t.name, t.color, t.accrual_method, b.balance, b.taken, b.pending
      from public.leave_types t
      join public.leave_balances b on b.leave_type_id = t.id and b.employee_id = p_employee and b.period_year = v_year
     where t.business_id = p_business and t.is_active
     order by t.sort, t.name;
end $$;
revoke all on function public.employee_leave_balances(uuid, uuid, int) from public, anon;
grant execute on function public.employee_leave_balances(uuid, uuid, int) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260929000002_employee_leave_balances.sql') on conflict do nothing;

-- ===================== 20260929000003_pictures_by_profile_editors.sql =====================
-- =====================================================================
-- 0026 Profile pictures are added by people who can edit staff profiles
--   (owners, admins, HR), not by staff themselves. Setting your own
--   picture on your staff profile now needs that permission too.
-- =====================================================================
create or replace function public.set_my_photo(p_business uuid, p_path text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid;
begin
  if p_business not in (select private.biz_with('employees', 'edit')) then
    raise exception 'Pictures are added by your HR team' using errcode = '42501';
  end if;
  if p_path is not null and p_path !~ ('^users/' || auth.uid()::text || '/[0-9a-f-]{36}\.(webp|jpg|png)$') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select m.employee_id into v_emp from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active';
  if v_emp is null then return; end if;
  update public.employees set photo_path = p_path where id = v_emp and business_id = p_business;
end $$;
revoke all on function public.set_my_photo(uuid, text) from public, anon;
grant execute on function public.set_my_photo(uuid, text) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260929000003_pictures_by_profile_editors.sql') on conflict do nothing;

-- ===================== 20260929000004_directory_pictures.sql =====================
-- =====================================================================
-- 0027 The staff app's colleague directory also returns each person's
--   picture. Still no personal details.
-- =====================================================================
drop function if exists public.staff_directory(uuid);
create function public.staff_directory(p_business uuid)
returns table (id uuid, first_name text, last_name text, preferred_name text, job_title text, department text, location text, work_email text, photo_path text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.first_name, e.last_name, e.preferred_name, p.title, d.name, b.name, e.work_email, e.photo_path
    from public.employees e
    left join public.positions p on p.id = e.position_id
    left join public.departments d on d.id = e.department_id
    left join public.branches b on b.id = e.branch_id
   where e.business_id = p_business
     and p_business in (select private.my_business_ids())
     and e.status in ('active', 'probation', 'on_leave')
   order by e.first_name, e.last_name
$$;
revoke all on function public.staff_directory(uuid) from public, anon;
grant execute on function public.staff_directory(uuid) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260929000004_directory_pictures.sql') on conflict do nothing;

-- ===================== 20260930000001_attendance_engine.sql =====================
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
insert into private.schema_migrations (name) values ('20260930000001_attendance_engine.sql') on conflict do nothing;

-- ===================== 20260930000002_payroll_overtime_rules.sql =====================
-- =====================================================================
-- 0029 PAYROLL OVERTIME follows the attendance rules: only overtime that
--   is approved (when approval is required) is paid, at the rate for the
--   kind of day it was worked on (normal day, rest day, public holiday),
--   and no more than the monthly cap. Everything else is unchanged.
-- =====================================================================
create or replace function public.calculate_payroll_run(p_run uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  b public.businesses;
  e public.employees;
  p public.attendance_policies;
  pen public.pension_schemes;
  tax public.tax_tables;
  comp record;
  pc record;
  cl record;
  ln record;
  ar record;
  v_re uuid;
  v_days int;                -- calendar days in the period
  v_workdays int;            -- working days in the period
  v_from date;
  v_to date;
  v_employed int;            -- calendar days employed in the period
  v_unpaid numeric;
  v_absent numeric;
  v_paid_days numeric;
  v_present numeric;
  v_worked_h numeric;
  v_ot_h numeric;
  v_basic numeric;
  v_salary numeric;
  v_hourly numeric;
  v_amount numeric;
  v_rate numeric;
  v_gross numeric;
  v_taxable numeric;
  v_pensionable numeric;
  v_ded numeric;
  v_employer numeric;
  v_pen_emp numeric;
  v_tax numeric;
  v_exc jsonb;
  v_sort int;
  v_has_att boolean;
  v_has_leave boolean;
  v_has_claims boolean;
  v_bank record;
  v_holiday boolean;
  v_n int := 0;
  v_ot_cap int;
  v_ot_used int;
  v_ot_take int;
  d date;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to calculate this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is finalized and locked' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = r.business_id;
  v_has_att := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'attendance' and enabled);
  v_has_leave := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'leave' and enabled);
  v_has_claims := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'claims' and enabled);
  select * into pen from public.pension_schemes where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;
  select * into tax from public.tax_tables where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;

  -- Start again: forget the previous calculation (people kept on hold stay on hold).
  create temp table if not exists _held (employee_id uuid) on commit drop;
  delete from _held where true;
  insert into _held select employee_id from public.payroll_run_employees where run_id = r.id and status in ('excluded', 'on_hold');
  create temp table if not exists _manual (employee_id uuid, code text, name text, kind text, amount numeric, is_taxable boolean, is_pensionable boolean) on commit drop;
  delete from _manual where true;
  insert into _manual select employee_id, code, name, kind, amount, is_taxable, is_pensionable
    from public.payroll_run_lines where run_id = r.id and source = 'manual';
  update public.claims set payroll_run_id = null where payroll_run_id = r.id and status = 'approved';
  delete from public.payroll_run_employees where run_id = r.id;

  v_days := r.period_end - r.period_start + 1;
  v_workdays := 0;
  d := r.period_start;
  while d <= r.period_end loop
    if extract(dow from d)::smallint = any(b.working_days) then v_workdays := v_workdays + 1; end if;
    d := d + 1;
  end loop;

  for e in select * from public.employees
            where business_id = r.business_id
              and (join_date is null or join_date <= r.period_end)
              and (exit_date is null or exit_date >= r.period_start)
              and not (status in ('resigned', 'terminated') and exit_date is null)
            order by first_name, last_name loop
    v_exc := '[]'::jsonb;
    v_sort := 0;
    v_from := greatest(r.period_start, coalesce(e.join_date, r.period_start));
    v_to := least(r.period_end, coalesce(e.exit_date, r.period_end));
    v_employed := v_to - v_from + 1;

    select * into comp from public.employee_compensation
     where employee_id = e.id and effective_date <= r.period_end order by effective_date desc limit 1;
    select ba.bank_name, ba.account_name, ba.account_number into v_bank
      from public.employee_bank_accounts ba where ba.employee_id = e.id order by ba.is_primary desc limit 1;

    -- Days not paid: unpaid leave and absences (working days only).
    v_unpaid := 0;
    if v_has_leave then
      select coalesce(sum(private.leave_days(r.business_id, lr.leave_type_id, greatest(lr.start_date, v_from), least(lr.end_date, v_to),
                 case when lr.start_date >= v_from then lr.start_half else 'full' end,
                 case when lr.end_date <= v_to then lr.end_half else 'full' end, e.branch_id)), 0)
        into v_unpaid
        from public.leave_requests lr join public.leave_types lt on lt.id = lr.leave_type_id
       where lr.employee_id = e.id and lr.status = 'approved' and not lt.is_paid
         and lr.start_date <= v_to and lr.end_date >= v_from;
    end if;
    v_absent := 0; v_present := 0; v_worked_h := 0; v_ot_h := 0;
    if v_has_att then
      select count(*) filter (where status = 'absent'),
             count(*) filter (where status in ('present','late')) + 0.5 * count(*) filter (where status = 'half_day'),
             coalesce(sum(worked_minutes), 0) / 60.0,
             -- Overtime that can be paid: approved when the rules need approval, and within the monthly cap.
             least(coalesce(sum(overtime_minutes) filter (where ot_decision = 'approved' or not coalesce((private.policy_for(r.business_id, e.id)).overtime_requires_approval, false)), 0),
                   coalesce(((private.policy_for(r.business_id, e.id)).overtime_monthly_cap_hours * 60)::int, 2147483647)) / 60.0
        into v_absent, v_present, v_worked_h, v_ot_h
        from public.attendance_records where employee_id = e.id and work_date between v_from and v_to;
    end if;

    v_basic := coalesce(comp.basic_salary, 0);
    if comp.basic_salary is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_salary', 'message', 'No salary on their profile', 'severity', 'error');
    end if;
    if v_bank.account_number is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_bank', 'message', 'No bank account on their profile', 'severity', 'warning');
    end if;

    -- Salary for the part of the period they were employed, less unpaid days.
    if coalesce(comp.pay_basis, 'monthly') = 'monthly' then
      v_paid_days := greatest(0, v_employed - (v_unpaid + v_absent) * v_days::numeric / greatest(v_workdays, 1));
      v_salary := round(v_basic * v_paid_days / v_days, 2);
      v_hourly := v_basic / greatest(v_workdays * coalesce(nullif((select full_day_hours from public.attendance_policies where business_id = r.business_id and is_default), 0), 8), 1);
    elsif comp.pay_basis = 'daily' then
      v_paid_days := v_present;
      v_salary := round(v_basic * v_present, 2);
      v_hourly := v_basic / 8;
      if not v_has_att then
        v_exc := v_exc || jsonb_build_object('code', 'daily_no_time', 'message', 'Paid by the day, but Time & shifts is off', 'severity', 'warning');
      end if;
    else
      v_paid_days := v_present;
      v_salary := round(v_basic * v_worked_h, 2);
      v_hourly := v_basic;
    end if;

    insert into public.payroll_run_employees (business_id, run_id, employee_id, employee_code, employee_name, department_name, position_title,
      branch_name, bank_name, bank_account_name, bank_account_number, basic_salary, period_days, paid_days, unpaid_leave_days, absent_days,
      worked_hours, overtime_hours, status)
    values (r.business_id, r.id, e.id, e.employee_code, trim(e.first_name || ' ' || e.last_name),
      (select name from public.departments where id = e.department_id), (select title from public.positions where id = e.position_id),
      (select name from public.branches where id = e.branch_id), v_bank.bank_name, v_bank.account_name, v_bank.account_number,
      v_basic, v_days, round(v_paid_days, 2), v_unpaid, v_absent, round(v_worked_h, 2), round(v_ot_h, 2),
      case when e.id in (select employee_id from _held) then 'on_hold' else 'included' end)
    returning id into v_re;
    v_n := v_n + 1;

    -- Earnings --------------------------------------------------------
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort)
    values (r.business_id, r.id, v_re, e.id, 'BASIC', 'Basic salary', 'earning', round(v_paid_days, 2), v_basic, v_salary, true, true, 'salary', 0);

    for pc in select epc.amount, epc.percent, c.id, c.code, c.name, c.kind, c.calc_type, c.default_amount, c.default_percent,
                     c.is_taxable, c.is_pensionable, c.prorate, c.category, c.sort
                from public.employee_pay_components epc join public.pay_components c on c.id = epc.component_id
               where epc.employee_id = e.id and c.is_active and epc.start_date <= v_to and (epc.end_date is null or epc.end_date >= v_from) loop
      v_amount := case pc.calc_type
        when 'fixed' then coalesce(pc.amount, pc.default_amount) * case when pc.prorate and coalesce(comp.pay_basis, 'monthly') = 'monthly' then v_paid_days / v_days else 1 end
        when 'percent_of_basic' then v_basic * coalesce(pc.percent, pc.default_percent, 0) / 100 * case when pc.prorate then v_paid_days / v_days else 1 end
        when 'per_day_present' then coalesce(pc.amount, pc.default_amount) * v_present
        when 'per_hour_worked' then coalesce(pc.amount, pc.default_amount) * v_worked_h
        else coalesce(pc.amount, pc.default_amount) end;
      v_amount := round(coalesce(v_amount, 0), 2);
      continue when v_amount = 0;
      v_sort := v_sort + 1;
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, component_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
      values (r.business_id, r.id, v_re, e.id, pc.id, pc.code, pc.name, pc.kind, v_amount,
              pc.kind = 'earning' and pc.is_taxable, pc.kind = 'earning' and pc.is_pensionable, 'component', 10 + pc.sort);
    end loop;

    -- Overtime from time records, at the rate for the kind of day.
    if v_has_att then
      p := private.policy_for(r.business_id, e.id);
      v_ot_cap := coalesce((p.overtime_monthly_cap_hours * 60)::int, 2147483647);
      v_ot_used := 0;
      for ar in select work_date, overtime_minutes, overtime_type from public.attendance_records
                 where employee_id = e.id and work_date between v_from and v_to and overtime_minutes > 0
                   and (ot_decision = 'approved' or not coalesce(p.overtime_requires_approval, false))
                 order by work_date loop
        -- Up to the monthly cap, in date order.
        v_ot_take := least(ar.overtime_minutes, greatest(0, v_ot_cap - v_ot_used));
        v_ot_used := v_ot_used + v_ot_take;
        continue when v_ot_take = 0;
        v_holiday := exists (select 1 from public.public_holidays h where h.business_id = r.business_id and h.holiday_date = ar.work_date and not h.is_optional);
        v_rate := case ar.overtime_type
                    when 'holiday' then coalesce(p.overtime_rate_holiday, 1.5)
                    when 'rest_day' then coalesce(p.overtime_rate_rest_day, 1.5)
                    when 'normal' then coalesce(p.overtime_rate_weekday, 1.25)
                    else case when v_holiday then coalesce(p.overtime_rate_holiday, 1.5)
                       when not (extract(dow from ar.work_date)::smallint = any(b.working_days)) then coalesce(p.overtime_rate_rest_day, 1.5)
                       else coalesce(p.overtime_rate_weekday, 1.25) end end;
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'OT', 'Overtime ' || to_char(ar.work_date, 'DD Mon') || ' (x' || trim(to_char(v_rate, 'FM0.00')) || ')', 'earning',
                round(v_ot_take / 60.0, 2), round(v_hourly * v_rate, 4), round(v_ot_take / 60.0 * v_hourly * v_rate, 2), true, false, 'overtime', 50);
      end loop;
    end if;

    -- Approved claims paid through payroll, up to this period.
    if v_has_claims then
      for cl in select c.id, c.amount, t.name, c.claim_date from public.claims c join public.claim_types t on t.id = c.claim_type_id
                 where c.employee_id = e.id and c.status = 'approved' and c.payout_method = 'payroll' and c.payroll_run_id is null
                   and coalesce(c.target_period_start, c.claim_date) <= r.period_end loop
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, source_id, sort)
        values (r.business_id, r.id, v_re, e.id, 'CLAIM', cl.name || ' claim ' || to_char(cl.claim_date, 'DD Mon'), 'earning', cl.amount, false, false, 'expense_claim', cl.id, 60);
        update public.claims set payroll_run_id = r.id where id = cl.id;
      end loop;
    end if;

    -- Changes typed in by hand on this run are kept when recalculating.
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
    select r.business_id, r.id, v_re, e.id, m.code, m.name, m.kind, m.amount, m.is_taxable, m.is_pensionable, 'manual', 70
      from _manual m where m.employee_id = e.id;

    select coalesce(sum(amount) filter (where kind = 'earning'), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_taxable), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_pensionable), 0)
      into v_gross, v_taxable, v_pensionable
      from public.payroll_run_lines where run_employee_id = v_re;

    -- Deductions ------------------------------------------------------
    for ln in select id, installment_amount, outstanding, kind from public.loans
               where employee_id = e.id and status = 'active' and start_date <= r.period_end and outstanding > 0 loop
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, source_id, sort)
      values (r.business_id, r.id, v_re, e.id, upper(ln.kind), case when ln.kind = 'advance' then 'Salary advance' else 'Loan repayment' end, 'deduction',
              least(ln.installment_amount, ln.outstanding), 'loan', ln.id, 80);
    end loop;

    v_pen_emp := 0; v_employer := 0;
    if pen.id is not null and (pen.applies_to = 'all' or (pen.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := case pen.wage_base when 'basic' then v_salary when 'gross' then v_gross else v_pensionable end;
      if pen.wage_ceiling is not null then v_amount := least(v_amount, pen.wage_ceiling); end if;
      v_pen_emp := round(v_amount * pen.employee_rate / 100, 2);
      v_employer := round(v_amount * pen.employer_rate / 100, 2);
      if v_pen_emp > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'PENSION', 'Pension (' || trim(to_char(pen.employee_rate, 'FM990.###')) || '%)', 'deduction', pen.employee_rate, v_pen_emp, 'statutory', 90);
      end if;
      if v_employer > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'PENSION_ER', 'Employer pension (' || trim(to_char(pen.employer_rate, 'FM990.###')) || '%)', 'employer_contribution', pen.employer_rate, v_employer, 'statutory', 95);
      end if;
    end if;

    v_tax := 0;
    if tax.id is not null and (tax.applies_to = 'all' or (tax.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := greatest(v_taxable - v_pen_emp, 0);
      v_tax := case when tax.basis = 'annual' then round(private.tax_for(tax.id, v_amount * 12) / 12, 2) else private.tax_for(tax.id, v_amount) end;
      if v_tax > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'TAX', 'Income tax', 'deduction', v_tax, 'statutory', 91);
      end if;
    end if;

    select coalesce(sum(amount), 0) into v_ded from public.payroll_run_lines where run_employee_id = v_re and kind = 'deduction';
    if v_gross - v_ded < 0 then
      v_exc := v_exc || jsonb_build_object('code', 'negative', 'message', 'Deductions are more than pay', 'severity', 'error');
    end if;
    update public.payroll_run_employees set
      gross_pay = v_gross, taxable_pay = greatest(v_taxable - v_pen_emp, 0), pensionable_pay = v_pensionable,
      total_deductions = v_ded, net_pay = v_gross - v_ded, employer_contributions = v_employer, exceptions = v_exc
    where id = v_re;
  end loop;

  update public.payroll_runs set
    status = 'calculated', calculated_at = now(), calculated_by = auth.uid(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_gross = (select coalesce(sum(gross_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_deductions = (select coalesce(sum(total_deductions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_net = (select coalesce(sum(net_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_employer_contributions = (select coalesce(sum(employer_contributions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included')
  where id = r.id;
  -- Claims for people on hold wait for the next run.
  update public.claims c set payroll_run_id = null
   where c.payroll_run_id = r.id and c.employee_id in (select employee_id from _held);
  return jsonb_build_object('people', v_n);
end $$;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260930000002_payroll_overtime_rules.sql') on conflict do nothing;

-- ===================== 20260930000003_refresh_one_person.sql =====================
-- =====================================================================
-- 0030 Bring one person's month up to date (their profile), without
--   working out everyone else's.
-- =====================================================================
drop function if exists public.refresh_attendance_month(uuid, date);
create function public.refresh_attendance_month(p_business uuid, p_month date, p_employee uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
begin
  if p_employee is null then
    if p_business not in (select private.biz_with('attendance', 'view')) then
      raise exception 'You don''t have permission to see attendance' using errcode = '42501';
    end if;
  elsif not private.can_emp('attendance', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s attendance' using errcode = '42501';
  end if;
  return private.compute_attendance_month(p_business, p_month, p_employee);
end $$;
revoke all on function public.refresh_attendance_month(uuid, date, uuid) from public, anon;
grant execute on function public.refresh_attendance_month(uuid, date, uuid) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260930000003_refresh_one_person.sql') on conflict do nothing;

-- ===================== 20260930000004_recalc_after_rule_change.sql =====================
-- =====================================================================
-- 0031 After the attendance rules or schedules change, work days out
--   again from a date on (days in finalized payroll periods stay as
--   they were).
-- =====================================================================
create or replace function public.recalc_attendance_since(p_business uuid, p_from date)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n int := 0;
begin
  if p_business not in (select private.biz_all('attendance', 'edit')) then
    raise exception 'You don''t have permission to change attendance rules' using errcode = '42501';
  end if;
  for r in select a.id from public.attendance_records a
            where a.business_id = p_business and a.work_date >= p_from and a.clock_in_at is not null
              and not private.attendance_locked(a.business_id, a.work_date) loop
    perform private.recalc_attendance(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.recalc_attendance_since(uuid, date) from public, anon;
grant execute on function public.recalc_attendance_since(uuid, date) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20260930000004_recalc_after_rule_change.sql') on conflict do nothing;

-- ===================== 20261001000001_time_off_rules.sql =====================
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
insert into private.schema_migrations (name) values ('20261001000001_time_off_rules.sql') on conflict do nothing;

-- ===================== 20261002000001_pay_items.sql =====================
-- =====================================================================
-- 0033 PAY ITEMS: allowances and deductions that work themselves out.
--   * Each item has a calculation method (fixed, per day attended,
--     prorated by attendance, % of basic, per occurrence, or a formula),
--     dates it applies between, and who gets it (everyone, or chosen
--     departments, jobs, locations or people, with their own amounts).
--   * Rules, checked top to bottom (first match wins), or a rule formula.
--   * Formulas are stored as a checked tree and calculated here by
--     private.pay_eval: numbers, the pay variables, + - * /, comparisons,
--     IF, AND, OR, MIN, MAX and ROUND. Nothing is ever run as code.
--   * Payroll and the test panel use the same calculation, and every
--     payroll line keeps a plain explanation of how it was worked out.
--   * Basic salary now only takes off unpaid leave. Unapproved absences
--     are taken off by an "Unapproved absence deduction" item each
--     company gets, which can be changed or switched off.
--   * Salaries: change a group at once, or import from a file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pay item settings
-- ---------------------------------------------------------------------
alter table public.pay_components
  add column if not exists description text,
  add column if not exists method text not null default 'fixed'
    check (method in ('fixed', 'per_day', 'prorated', 'percent', 'per_occurrence', 'formula')),
  add column if not exists prorate_basis text not null default 'working' check (prorate_basis in ('calendar', 'working')),
  add column if not exists occurrence_var text,
  add column if not exists occurrence_after integer not null default 0 check (occurrence_after >= 0),
  add column if not exists formula text,
  add column if not exists formula_ast jsonb,
  add column if not exists rules_mode text not null default 'none' check (rules_mode in ('none', 'builder', 'formula')),
  add column if not exists rules jsonb not null default '[]'::jsonb,
  add column if not exists rules_formula text,
  add column if not exists rules_ast jsonb,
  add column if not exists applies_to text not null default 'all' check (applies_to in ('all', 'selected')),
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists template_key text,
  add column if not exists updated_by uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.pay_components drop constraint if exists pay_components_effective_check;
alter table public.pay_components add constraint pay_components_effective_check
  check (effective_to is null or effective_from is null or effective_to >= effective_from);
create index if not exists pay_components_updated_by_fk_idx on public.pay_components (updated_by);

-- Existing items keep what they did. Items given to people one by one stay that way.
update public.pay_components set
  method = case calc_type when 'percent_of_basic' then 'percent' when 'per_day_present' then 'per_day' else 'fixed' end,
  applies_to = 'selected';

-- Who an item is for, when it isn't everyone. People with their own amount always get it.
create table public.pay_component_targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  component_id uuid not null,
  target_type text not null check (target_type in ('department', 'position', 'branch', 'employee')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (component_id, target_type, target_id),
  foreign key (business_id, component_id) references public.pay_components (business_id, id) on delete cascade
);
create index pay_component_targets_component_idx on public.pay_component_targets (business_id, component_id);
call private.std_rls('pay_component_targets', 'payroll');

-- How each payroll line was worked out, in plain words.
alter table public.payroll_run_lines add column if not exists explanation text;

-- Every change to an item and who gets it is kept with who, when, before and after.
create trigger audit_pay_components after insert or update or delete on public.pay_components
  for each row execute function private.audit_row('payroll', '');
create trigger audit_pay_component_targets after insert or update or delete on public.pay_component_targets
  for each row execute function private.audit_row('payroll', '');

-- ---------------------------------------------------------------------
-- 2. The formula calculator
-- ---------------------------------------------------------------------
create or replace function private.pay_variable_names()
returns text[]
language sql immutable as $$
  select array['basic_salary', 'amount', 'days_in_month', 'working_days', 'days_present', 'unapproved_absences',
               'approved_absences', 'half_days', 'late_count', 'early_leaves', 'consecutive_unapproved_absences',
               'overtime_hours', 'unpaid_leave_days', 'years_of_service']
$$;

-- Calculates a formula tree. Comparisons and AND/OR give 1 (true) or 0 (false).
-- Dividing by zero gives 0, so one empty month can't stop a pay run.
create or replace function private.pay_eval(n jsonb, v jsonb, d int default 0)
returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  op text;
  a numeric;
  b numeric;
  r numeric;
  i int;
  len int;
begin
  if d > 60 then
    raise exception 'The formula is nested too deeply' using errcode = '22023';
  end if;
  if n is null or jsonb_typeof(n) is distinct from 'array' or jsonb_array_length(n) < 2 then
    raise exception 'The formula isn''t valid' using errcode = '22023';
  end if;
  op := n ->> 0;
  len := jsonb_array_length(n);
  case op
    when 'num' then
      if jsonb_typeof(n -> 1) <> 'number' then raise exception 'The formula isn''t valid' using errcode = '22023'; end if;
      return (n ->> 1)::numeric;
    when 'var' then
      if not ((n ->> 1) = any(private.pay_variable_names())) or not (v ? (n ->> 1)) then
        raise exception '"%" isn''t a variable', n ->> 1 using errcode = '22023';
      end if;
      return coalesce((v ->> (n ->> 1))::numeric, 0);
    when 'neg' then
      return -private.pay_eval(n -> 1, v, d + 1);
    when '+', '-', '*', '/', '>', '>=', '<', '<=', '=', '!=' then
      if len <> 3 then raise exception 'The formula isn''t valid' using errcode = '22023'; end if;
      a := private.pay_eval(n -> 1, v, d + 1);
      b := private.pay_eval(n -> 2, v, d + 1);
      return case op
        when '+' then a + b
        when '-' then a - b
        when '*' then a * b
        when '/' then case when b = 0 then 0 else a / b end
        when '>' then (a > b)::int
        when '>=' then (a >= b)::int
        when '<' then (a < b)::int
        when '<=' then (a <= b)::int
        when '=' then (a = b)::int
        else (a <> b)::int end;
    when 'IF' then
      if len <> 4 then raise exception 'IF needs 3 values' using errcode = '22023'; end if;
      if private.pay_eval(n -> 1, v, d + 1) <> 0 then
        return private.pay_eval(n -> 2, v, d + 1);
      end if;
      return private.pay_eval(n -> 3, v, d + 1);
    when 'AND', 'OR' then
      if len < 3 then raise exception '% needs at least 2 values', op using errcode = '22023'; end if;
      for i in 1 .. len - 1 loop
        a := private.pay_eval(n -> i, v, d + 1);
        if op = 'AND' and a = 0 then return 0; end if;
        if op = 'OR' and a <> 0 then return 1; end if;
      end loop;
      return case when op = 'AND' then 1 else 0 end;
    when 'MIN', 'MAX' then
      if len < 3 then raise exception '% needs at least 2 values', op using errcode = '22023'; end if;
      for i in 1 .. len - 1 loop
        a := private.pay_eval(n -> i, v, d + 1);
        r := case when r is null then a when op = 'MIN' then least(r, a) else greatest(r, a) end;
      end loop;
      return r;
    when 'ROUND' then
      if len not in (2, 3) then raise exception 'ROUND needs 1 or 2 values' using errcode = '22023'; end if;
      a := private.pay_eval(n -> 1, v, d + 1);
      b := case when len = 3 then private.pay_eval(n -> 2, v, d + 1) else 0 end;
      return round(a, least(greatest(round(b), 0), 6)::int);
    else
      raise exception 'The formula uses something that isn''t allowed' using errcode = '22023';
  end case;
end $$;

-- Rules from the builder: [{label, join, clauses: [{var, op, value}], outcome: {type, value}}]
create or replace function private.pay_rules_check(p_rules jsonb)
returns void
language plpgsql immutable set search_path = '' as $$
declare
  r jsonb;
  c jsonb;
begin
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'Rules aren''t valid' using errcode = '22023'; end if;
  if jsonb_array_length(p_rules) > 20 then raise exception 'Use up to 20 rules' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rules) loop
    if coalesce(r ->> 'join', '') not in ('and', 'or') or jsonb_typeof(r -> 'clauses') <> 'array' or jsonb_array_length(r -> 'clauses') = 0 then
      raise exception 'Each rule needs at least one condition' using errcode = '22023';
    end if;
    if coalesce(r #>> '{outcome,type}', '') not in ('full', 'percent', 'nothing', 'subtract', 'fixed') then
      raise exception 'Choose what each rule does' using errcode = '22023';
    end if;
    if r #>> '{outcome,type}' in ('percent', 'subtract', 'fixed') and jsonb_typeof(r #> '{outcome,value}') <> 'number' then
      raise exception 'Enter the amount or percentage for rule "%"', r ->> 'label' using errcode = '22023';
    end if;
    for c in select * from jsonb_array_elements(r -> 'clauses') loop
      if not ((c ->> 'var') = any(private.pay_variable_names())) or coalesce(c ->> 'op', '') not in ('>=', '>', '<=', '<', '=', '!=')
         or jsonb_typeof(c -> 'value') <> 'number' then
        raise exception 'A condition in rule "%" isn''t complete', r ->> 'label' using errcode = '22023';
      end if;
    end loop;
  end loop;
end $$;

create or replace function private.pay_rule_matches(p_rule jsonb, v jsonb)
returns boolean
language sql immutable set search_path = '' as $$
  select case when p_rule ->> 'join' = 'or' then bool_or(ok) else bool_and(ok) end
    from (
      select case c ->> 'op'
               when '>=' then x >= val when '>' then x > val when '<=' then x <= val
               when '<' then x < val when '=' then x = val else x <> val end as ok
        from jsonb_array_elements(p_rule -> 'clauses') c,
             lateral (select coalesce((v ->> (c ->> 'var'))::numeric, 0) as x, (c ->> 'value')::numeric as val) y) t
$$;

-- Checks an item before it's saved.
create or replace function private.pay_item_check(c public.pay_components)
returns void
language plpgsql stable set search_path = '' as $$
declare
  v_sample jsonb := (select jsonb_object_agg(k, 1) from unnest(private.pay_variable_names()) k);
begin
  if c.method = 'formula' then
    if c.formula_ast is null then raise exception 'Type the formula' using errcode = '22023'; end if;
    perform private.pay_eval(c.formula_ast, v_sample);
  end if;
  if c.method = 'per_occurrence' and not (coalesce(c.occurrence_var, '') = any(private.pay_variable_names())) then
    raise exception 'Choose what is counted' using errcode = '22023';
  end if;
  if c.method = 'percent' and c.default_percent is null then
    raise exception 'Enter the percentage of basic salary' using errcode = '22023';
  end if;
  if c.rules_mode = 'builder' then
    perform private.pay_rules_check(c.rules);
  elsif c.rules_mode = 'formula' then
    if c.rules_ast is null then raise exception 'Type the rule formula' using errcode = '22023'; end if;
    perform private.pay_eval(c.rules_ast, v_sample);
  end if;
end $$;

create or replace function private.pay_component_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.pay_item_check(new);
  -- The older field some screens still read.
  new.calc_type := case new.method when 'percent' then 'percent_of_basic' when 'per_day' then 'per_day_present' when 'fixed' then 'fixed' else 'manual' end;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger pay_component_guard before insert or update on public.pay_components
  for each row execute function private.pay_component_guard();

-- ---------------------------------------------------------------------
-- 3. Each person's numbers for a pay period
-- ---------------------------------------------------------------------
create or replace function private.pay_vars(p_business uuid, p_employee uuid, p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
  v_from date;
  v_to date;
  v_basic numeric := 0;
  v_basis text := 'monthly';
  v_working int := 0;
  v_working_employed int := 0;
  v_has_att boolean;
  v_has_leave boolean;
  v_unpaid numeric := 0;
  -- Plain typed variables (not a record), so the numbers have the same types whichever way they're worked out.
  v_present numeric := 0;
  v_half int := 0;
  v_absent int := 0;
  v_on_leave int := 0;
  v_late int := 0;
  v_early int := 0;
  v_ot numeric := 0;
  v_run int := 0;
  v_cap int;
  d date;
begin
  select * into e from public.employees where id = p_employee and business_id = p_business;
  v_from := greatest(p_start, coalesce(e.join_date, p_start));
  v_to := least(p_end, coalesce(e.exit_date, p_end));
  select c.basic_salary, c.pay_basis into v_basic, v_basis from public.employee_compensation c
   where c.employee_id = p_employee and c.effective_date <= p_end order by c.effective_date desc limit 1;
  v_has_att := exists (select 1 from public.business_modules where business_id = p_business and module_key = 'attendance' and enabled);
  v_has_leave := exists (select 1 from public.business_modules where business_id = p_business and module_key = 'leave' and enabled);

  -- Working days in the whole period (so a month's allowance is measured against the full month).
  d := p_start;
  while d <= p_end loop
    if (select dp.kind from private.day_plan(p_business, p_employee, d) dp) = 'working' then
      v_working := v_working + 1;
      if d between v_from and v_to then v_working_employed := v_working_employed + 1; end if;
    end if;
    d := d + 1;
  end loop;

  if v_has_leave and v_from <= v_to then
    select coalesce(sum(private.leave_days(p_business, lr.leave_type_id, greatest(lr.start_date, v_from), least(lr.end_date, v_to),
               case when lr.start_date >= v_from then lr.start_half else 'full' end,
               case when lr.end_date <= v_to then lr.end_half else 'full' end, e.branch_id)), 0)
      into v_unpaid
      from public.leave_requests lr join public.leave_types lt on lt.id = lr.leave_type_id
     where lr.employee_id = p_employee and lr.status = 'approved' and not lt.is_paid
       and lr.start_date <= v_to and lr.end_date >= v_from;
  end if;

  if v_has_att and v_from <= v_to then
    v_cap := coalesce(((private.policy_for(p_business, p_employee)).overtime_monthly_cap_hours * 60)::int, 2147483647);
    select count(*) filter (where x.status in ('present', 'late', 'early_leave') and x.kind = 'working') as present,
           count(*) filter (where x.status = 'half_day') as half,
           count(*) filter (where x.status = 'absent') as absent,
           count(*) filter (where x.status = 'on_leave') as on_leave,
           count(*) filter (where x.late_minutes > 0) as late_n,
           count(*) filter (where x.status = 'early_leave') as early_n,
           least(coalesce(sum(x.overtime_minutes) filter (where x.overtime_state = 'approved'), 0), v_cap) as ot
      into v_present, v_half, v_absent, v_on_leave, v_late, v_early, v_ot
      from private.attendance_days(p_business, v_from, v_to, p_employee) x;
    select coalesce(max(n), 0) into v_run from (
      select count(*) as n from (
        select status, row_number() over (order by day) - row_number() over (partition by status = 'absent' order by day) as grp
          from private.attendance_days(p_business, v_from, v_to, p_employee)
         where status is not null and status not in ('rest_day', 'holiday')) y
       where status = 'absent' group by grp) z;
  else
    -- Without Time & shifts, everyone counts as present on their working days (less unpaid leave).
    v_present := greatest(v_working_employed - v_unpaid, 0);
  end if;

  return jsonb_build_object(
    'basic_salary', coalesce(v_basic, 0),
    'days_in_month', p_end - p_start + 1,
    'working_days', v_working,
    'days_present', coalesce(v_present, 0) + 0.5 * coalesce(v_half, 0),
    'unapproved_absences', coalesce(v_absent, 0),
    'approved_absences', coalesce(v_on_leave, 0),
    'half_days', coalesce(v_half, 0),
    'late_count', coalesce(v_late, 0),
    'early_leaves', coalesce(v_early, 0),
    'consecutive_unapproved_absences', coalesce(v_run, 0),
    'overtime_hours', round(coalesce(v_ot, 0) / 60.0, 2),
    'unpaid_leave_days', v_unpaid,
    'years_of_service', case when e.join_date is null or e.join_date > p_end then 0 else extract(year from age(p_end, e.join_date))::int end,
    'amount', 0,
    -- Not formula variables; used to explain results.
    '_days_employed', greatest(v_to - v_from + 1, 0),
    '_pay_basis', coalesce(v_basis, 'monthly'),
    '_has_salary', v_basic is not null);
end $$;

create or replace function private.pay_money(p_amount numeric, p_currency text)
returns text
language sql immutable as $$
  select coalesce(p_currency, 'MVR') || ' ' || to_char(round(coalesce(p_amount, 0), 2), 'FM999,999,999,990.00')
$$;

create or replace function private.pay_num(p numeric)
returns text
language sql immutable as $$
  select rtrim(rtrim(to_char(round(coalesce(p, 0), 2), 'FM999,999,999,990.00'), '0'), '.')
$$;

-- ---------------------------------------------------------------------
-- 4. One item for one person: who gets it, how much, and why
-- ---------------------------------------------------------------------
create or replace function private.pay_item_applies(c public.pay_components, p_employee uuid, p_start date, p_end date, p_targets jsonb default null)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
begin
  if not c.is_active or (c.effective_from is not null and c.effective_from > p_end) or (c.effective_to is not null and c.effective_to < p_start) then
    return false;
  end if;
  if c.applies_to = 'all' then return true; end if;
  if c.id is not null and exists (select 1 from public.employee_pay_components o where o.component_id = c.id and o.employee_id = p_employee
                                    and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)) then
    return true;
  end if;
  select * into e from public.employees where id = p_employee;
  if p_targets is not null then
    return exists (select 1 from jsonb_array_elements(p_targets) t
                    where (t ->> 'target_type' = 'employee' and (t ->> 'target_id')::uuid = e.id)
                       or (t ->> 'target_type' = 'department' and (t ->> 'target_id')::uuid = e.department_id)
                       or (t ->> 'target_type' = 'position' and (t ->> 'target_id')::uuid = e.position_id)
                       or (t ->> 'target_type' = 'branch' and (t ->> 'target_id')::uuid = e.branch_id));
  end if;
  return exists (select 1 from public.pay_component_targets t where t.component_id = c.id and (
                   (t.target_type = 'employee' and t.target_id = e.id) or (t.target_type = 'department' and t.target_id = e.department_id)
                   or (t.target_type = 'position' and t.target_id = e.position_id) or (t.target_type = 'branch' and t.target_id = e.branch_id)));
end $$;

create or replace function private.pay_item_result(c public.pay_components, p_employee uuid, p_start date, p_end date, p_vars jsonb, p_currency text)
returns table (amount numeric, explanation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  ov record;
  v_amount numeric;
  v_pct numeric;
  v_basis numeric;
  v_count numeric;
  v_n numeric;
  r numeric;
  v_out numeric;
  v_expl text;
  v_rule jsonb;
  v_vars jsonb;
  v_unit text;
  m text;
begin
  select o.amount, o.percent into ov from public.employee_pay_components o
   where o.component_id = c.id and o.employee_id = p_employee and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)
   order by o.start_date desc limit 1;
  v_amount := coalesce(ov.amount, c.default_amount, 0);
  v_pct := coalesce(ov.percent, c.default_percent, 0);
  v_vars := p_vars || jsonb_build_object('amount', v_amount);

  case c.method
    when 'fixed' then
      r := v_amount;
      v_expl := private.pay_money(v_amount, p_currency) || ' a month';
    when 'per_day' then
      r := v_amount * (p_vars ->> 'days_present')::numeric;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num((p_vars ->> 'days_present')::numeric) || ' days present = ' || private.pay_money(r, p_currency);
    when 'prorated' then
      if c.prorate_basis = 'working' then
        v_basis := (p_vars ->> 'working_days')::numeric;
        v_count := (p_vars ->> 'days_present')::numeric;
        v_unit := ' working days';
      else
        -- Calendar days: every day they were employed counts, less the days they should have been at work and weren't.
        v_basis := (p_vars ->> 'days_in_month')::numeric;
        v_count := greatest(0, (p_vars ->> '_days_employed')::numeric - (p_vars ->> 'unapproved_absences')::numeric
                               - (p_vars ->> 'unpaid_leave_days')::numeric - 0.5 * (p_vars ->> 'half_days')::numeric);
        v_unit := ' days in the month';
      end if;
      r := case when v_basis > 0 then v_amount * v_count / v_basis else 0 end;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_count) || ' of ' || private.pay_num(v_basis) || v_unit
                || ' = ' || private.pay_money(r, p_currency);
    when 'percent' then
      r := (p_vars ->> 'basic_salary')::numeric * v_pct / 100;
      v_expl := private.pay_num(v_pct) || '% of basic salary ' || private.pay_money((p_vars ->> 'basic_salary')::numeric, p_currency)
                || ' = ' || private.pay_money(r, p_currency);
    when 'per_occurrence' then
      v_count := coalesce((p_vars ->> c.occurrence_var)::numeric, 0);
      v_n := greatest(0, v_count - c.occurrence_after);
      r := v_amount * v_n;
      v_unit := case c.occurrence_var
                  when 'late_count' then case when v_count = 1 then 'late' else 'lates' end
                  when 'early_leaves' then case when v_count = 1 then 'early leave' else 'early leaves' end
                  when 'unapproved_absences' then case when v_count = 1 then 'unapproved absence' else 'unapproved absences' end
                  when 'half_days' then case when v_count = 1 then 'half day' else 'half days' end
                  else replace(c.occurrence_var, '_', ' ') end;
      v_expl := private.pay_num(v_count) || ' ' || v_unit
                || case when c.occurrence_after > 0 then ', the first ' || c.occurrence_after || ' free, so ' || private.pay_num(v_n) || ' counted' else '' end
                || ': ' || private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_n) || ' = ' || private.pay_money(r, p_currency);
    else
      r := private.pay_eval(c.formula_ast, v_vars);
      v_expl := c.formula || ' = ' || private.pay_money(r, p_currency);
  end case;
  r := round(greatest(coalesce(r, 0), 0), 2);
  v_out := r;

  if c.rules_mode = 'builder' and jsonb_array_length(c.rules) > 0 then
    v_vars := p_vars || jsonb_build_object('amount', r);
    select x into v_rule from jsonb_array_elements(c.rules) with ordinality t(x, i)
     where private.pay_rule_matches(x, v_vars) order by i limit 1;
    if v_rule is null then
      v_expl := v_expl || '. No rule matched, so it''s paid in full';
    else
      m := v_rule #>> '{outcome,type}';
      v_out := case m
        when 'percent' then r * (v_rule #>> '{outcome,value}')::numeric / 100
        when 'nothing' then 0
        when 'subtract' then greatest(r - (v_rule #>> '{outcome,value}')::numeric, 0)
        when 'fixed' then (v_rule #>> '{outcome,value}')::numeric
        else r end;
      v_expl := v_expl || '. Rule ''' || coalesce(nullif(v_rule ->> 'label', ''), 'rule') || ''' applied: ' || case m
        when 'percent' then private.pay_num((v_rule #>> '{outcome,value}')::numeric) || '% = ' || private.pay_money(v_out, p_currency)
        when 'nothing' then 'nothing paid'
        when 'subtract' then private.pay_money(r, p_currency) || ' − ' || private.pay_money((v_rule #>> '{outcome,value}')::numeric, p_currency) || ' = ' || private.pay_money(v_out, p_currency)
        when 'fixed' then 'set to ' || private.pay_money(v_out, p_currency)
        else 'paid in full' end;
    end if;
  elsif c.rules_mode = 'formula' and c.rules_ast is not null then
    v_out := private.pay_eval(c.rules_ast, p_vars || jsonb_build_object('amount', r));
    v_expl := v_expl || '. Rule formula ' || c.rules_formula || ' gives ' || private.pay_money(greatest(v_out, 0), p_currency);
  end if;

  amount := round(greatest(coalesce(v_out, 0), 0), 2);
  explanation := v_expl;
  return next;
end $$;

-- ---------------------------------------------------------------------
-- 5. Test panel: every item for one person and month (optionally with an unsaved draft)
-- ---------------------------------------------------------------------
create or replace function public.pay_items_preview(p_business uuid, p_employee uuid, p_month date, p_draft jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_vars jsonb;
  v_currency text;
  c public.pay_components;
  v_draft public.pay_components;
  v_items jsonb := '[]'::jsonb;
  v_amt numeric;
  v_ex text;
  v_applies boolean;
  v_targets jsonb;
begin
  if p_business not in (select private.biz_all('payroll', 'view')) or not private.can_emp('compensation', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s pay' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee and business_id = p_business) then
    raise exception 'Choose a person' using errcode = '22023';
  end if;
  select currency into v_currency from public.businesses where id = p_business;
  v_vars := private.pay_vars(p_business, p_employee, v_start, v_end);

  if p_draft is not null then
    select * into v_draft from public.pay_components where id = (p_draft ->> 'id')::uuid and business_id = p_business;
    v_draft := jsonb_populate_record(coalesce(v_draft, null::public.pay_components), (p_draft - 'targets') || jsonb_build_object('business_id', p_business));
    v_draft.is_active := true;
    perform private.pay_item_check(v_draft);
  end if;

  for c in select * from public.pay_components pc where pc.business_id = p_business and pc.is_active
            and (v_draft.id is null or pc.id <> v_draft.id)
           union all select v_draft.* where p_draft is not null
           order by kind desc, sort, name loop
    v_targets := case when p_draft is not null and c.id is not distinct from v_draft.id then p_draft -> 'targets' end;
    v_applies := private.pay_item_applies(c, p_employee, v_start, v_end, v_targets);
    v_amt := null;
    v_ex := null;
    if v_applies then
      select x.amount, x.explanation into v_amt, v_ex from private.pay_item_result(c, p_employee, v_start, v_end, v_vars, v_currency) x;
    end if;
    v_items := v_items || jsonb_build_object(
      'id', c.id, 'name', c.name, 'kind', c.kind, 'draft', p_draft is not null and c.id is not distinct from v_draft.id,
      'applies', v_applies,
      'why_not', case when v_applies then null
                      when (c.effective_from is not null and c.effective_from > v_end) or (c.effective_to is not null and c.effective_to < v_start) then 'Not in effect that month'
                      else 'Not for this person' end,
      'amount', v_amt, 'explanation', v_ex);
  end loop;
  return jsonb_build_object('vars', v_vars, 'currency', v_currency, 'start', v_start, 'end', v_end, 'items', v_items);
end $$;
revoke all on function public.pay_items_preview(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.pay_items_preview(uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Unapproved absences come off pay through an item each company has
-- ---------------------------------------------------------------------
create or replace function private.ensure_absence_item(p_business uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pay_components (business_id, code, name, kind, category, method, default_amount, formula, formula_ast,
                                     is_taxable, is_pensionable, applies_to, template_key, description, sort)
  values (p_business, 'ABSENCE', 'Unapproved absence deduction', 'deduction', 'absence', 'formula', 0,
          'ROUND(basic_salary / working_days * unapproved_absences, 2)',
          '["ROUND", ["*", ["/", ["var", "basic_salary"], ["var", "working_days"]], ["var", "unapproved_absences"]], ["num", 2]]'::jsonb,
          false, false, 'all', 'absence_deduction', 'A day''s basic salary for each unapproved absence.', 900)
  on conflict (business_id, code) do nothing;
end $$;

create or replace function private.on_payroll_enabled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.module_key = 'payroll' and new.enabled then
    perform private.ensure_absence_item(new.business_id);
  end if;
  return new;
end $$;
create trigger payroll_enabled_absence_item after insert or update of enabled on public.business_modules
  for each row execute function private.on_payroll_enabled();

select private.ensure_absence_item(business_id) from public.business_modules where module_key = 'payroll' and enabled;

-- ---------------------------------------------------------------------
-- 7. Payroll uses the items (and explains each line)
-- ---------------------------------------------------------------------
create or replace function public.calculate_payroll_run(p_run uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  b public.businesses;
  e public.employees;
  p public.attendance_policies;
  pen public.pension_schemes;
  tax public.tax_tables;
  comp record;
  pc public.pay_components;
  cl record;
  ln record;
  ar record;
  res record;
  v_vars jsonb;
  v_re uuid;
  v_days int;
  v_workdays int;
  v_from date;
  v_to date;
  v_employed int;
  v_unpaid numeric;
  v_paid_days numeric;
  v_present numeric;
  v_worked_h numeric;
  v_ot_h numeric;
  v_basic numeric;
  v_salary numeric;
  v_hourly numeric;
  v_amount numeric;
  v_rate numeric;
  v_gross numeric;
  v_taxable numeric;
  v_pensionable numeric;
  v_ded numeric;
  v_employer numeric;
  v_pen_emp numeric;
  v_tax numeric;
  v_exc jsonb;
  v_has_att boolean;
  v_has_claims boolean;
  v_bank record;
  v_holiday boolean;
  v_n int := 0;
  v_ot_cap int;
  v_ot_used int;
  v_ot_take int;
  d date;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to calculate this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is finalized and locked' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = r.business_id;
  v_has_att := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'attendance' and enabled);
  v_has_claims := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'claims' and enabled);
  select * into pen from public.pension_schemes where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;
  select * into tax from public.tax_tables where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;

  -- Start again: forget the previous calculation (people kept on hold stay on hold).
  create temp table if not exists _held (employee_id uuid) on commit drop;
  delete from _held where true;
  insert into _held select employee_id from public.payroll_run_employees where run_id = r.id and status in ('excluded', 'on_hold');
  create temp table if not exists _manual (employee_id uuid, code text, name text, kind text, amount numeric, is_taxable boolean, is_pensionable boolean) on commit drop;
  delete from _manual where true;
  insert into _manual select employee_id, code, name, kind, amount, is_taxable, is_pensionable
    from public.payroll_run_lines where run_id = r.id and source = 'manual';
  update public.claims set payroll_run_id = null where payroll_run_id = r.id and status = 'approved';
  delete from public.payroll_run_employees where run_id = r.id;

  v_days := r.period_end - r.period_start + 1;
  v_workdays := 0;
  d := r.period_start;
  while d <= r.period_end loop
    if extract(dow from d)::smallint = any(b.working_days) then v_workdays := v_workdays + 1; end if;
    d := d + 1;
  end loop;

  for e in select * from public.employees
            where business_id = r.business_id
              and (join_date is null or join_date <= r.period_end)
              and (exit_date is null or exit_date >= r.period_start)
              and not (status in ('resigned', 'terminated') and exit_date is null)
            order by first_name, last_name loop
    v_exc := '[]'::jsonb;
    v_from := greatest(r.period_start, coalesce(e.join_date, r.period_start));
    v_to := least(r.period_end, coalesce(e.exit_date, r.period_end));
    v_employed := v_to - v_from + 1;

    select * into comp from public.employee_compensation
     where employee_id = e.id and effective_date <= r.period_end order by effective_date desc limit 1;
    select ba.bank_name, ba.account_name, ba.account_number into v_bank
      from public.employee_bank_accounts ba where ba.employee_id = e.id order by ba.is_primary desc limit 1;

    -- The month's numbers, shared with the allowances and deductions.
    v_vars := private.pay_vars(r.business_id, e.id, r.period_start, r.period_end);
    v_unpaid := (v_vars ->> 'unpaid_leave_days')::numeric;
    v_present := (v_vars ->> 'days_present')::numeric;
    v_worked_h := 0; v_ot_h := (v_vars ->> 'overtime_hours')::numeric;
    if v_has_att then
      select coalesce(sum(worked_minutes), 0) / 60.0 into v_worked_h
        from public.attendance_records where employee_id = e.id and work_date between v_from and v_to;
    end if;

    v_basic := coalesce(comp.basic_salary, 0);
    if comp.basic_salary is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_salary', 'message', 'No salary on their profile', 'severity', 'error');
    end if;
    if v_bank.account_number is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_bank', 'message', 'No bank account on their profile', 'severity', 'warning');
    end if;

    -- Salary for the part of the period they were employed, less unpaid leave.
    -- (Unapproved absences come off through the absence deduction item.)
    if coalesce(comp.pay_basis, 'monthly') = 'monthly' then
      v_paid_days := greatest(0, v_employed - v_unpaid * v_days::numeric / greatest(v_workdays, 1));
      v_salary := round(v_basic * v_paid_days / v_days, 2);
      v_hourly := v_basic / greatest(v_workdays * coalesce(nullif((select full_day_hours from public.attendance_policies where business_id = r.business_id and is_default), 0), 8), 1);
    elsif comp.pay_basis = 'daily' then
      v_paid_days := v_present;
      v_salary := round(v_basic * v_present, 2);
      v_hourly := v_basic / 8;
      if not v_has_att then
        v_exc := v_exc || jsonb_build_object('code', 'daily_no_time', 'message', 'Paid by the day, but Time & shifts is off', 'severity', 'warning');
      end if;
    else
      v_paid_days := v_present;
      v_salary := round(v_basic * v_worked_h, 2);
      v_hourly := v_basic;
    end if;

    insert into public.payroll_run_employees (business_id, run_id, employee_id, employee_code, employee_name, department_name, position_title,
      branch_name, bank_name, bank_account_name, bank_account_number, basic_salary, period_days, paid_days, unpaid_leave_days, absent_days,
      worked_hours, overtime_hours, status)
    values (r.business_id, r.id, e.id, e.employee_code, trim(e.first_name || ' ' || e.last_name),
      (select name from public.departments where id = e.department_id), (select title from public.positions where id = e.position_id),
      (select name from public.branches where id = e.branch_id), v_bank.bank_name, v_bank.account_name, v_bank.account_number,
      v_basic, v_days, round(v_paid_days, 2), v_unpaid, (v_vars ->> 'unapproved_absences')::numeric, round(v_worked_h, 2), round(v_ot_h, 2),
      case when e.id in (select employee_id from _held) then 'on_hold' else 'included' end)
    returning id into v_re;
    v_n := v_n + 1;

    -- Earnings --------------------------------------------------------
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort, explanation)
    values (r.business_id, r.id, v_re, e.id, 'BASIC', 'Basic salary', 'earning', round(v_paid_days, 2), v_basic, v_salary, true, true, 'salary', 0,
            case when coalesce(comp.pay_basis, 'monthly') = 'monthly' and v_salary <> v_basic
                 then private.pay_money(v_basic, b.currency) || ' × ' || private.pay_num(v_paid_days) || ' of ' || v_days || ' days paid' end);

    -- Allowances and deductions: every item that applies to them this period.
    for pc in select * from public.pay_components where business_id = r.business_id and is_active order by kind desc, sort, name loop
      continue when not private.pay_item_applies(pc, e.id, r.period_start, r.period_end);
      select * into res from private.pay_item_result(pc, e.id, r.period_start, r.period_end, v_vars, b.currency);
      continue when coalesce(res.amount, 0) = 0;
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, component_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort, explanation)
      values (r.business_id, r.id, v_re, e.id, pc.id, pc.code, pc.name, pc.kind, res.amount,
              pc.kind = 'earning' and pc.is_taxable, pc.kind = 'earning' and pc.is_pensionable, 'component',
              case when pc.kind = 'earning' then 10 else 75 end + least(pc.sort, 900) / 100, res.explanation);
    end loop;

    -- Overtime from time records, at the rate for the kind of day.
    if v_has_att then
      p := private.policy_for(r.business_id, e.id);
      v_ot_cap := coalesce((p.overtime_monthly_cap_hours * 60)::int, 2147483647);
      v_ot_used := 0;
      for ar in select work_date, overtime_minutes, overtime_type from public.attendance_records
                 where employee_id = e.id and work_date between v_from and v_to and overtime_minutes > 0
                   and (ot_decision = 'approved' or not coalesce(p.overtime_requires_approval, false))
                 order by work_date loop
        v_ot_take := least(ar.overtime_minutes, greatest(0, v_ot_cap - v_ot_used));
        v_ot_used := v_ot_used + v_ot_take;
        continue when v_ot_take = 0;
        v_holiday := exists (select 1 from public.public_holidays h where h.business_id = r.business_id and h.holiday_date = ar.work_date and not h.is_optional);
        v_rate := case ar.overtime_type
                    when 'holiday' then coalesce(p.overtime_rate_holiday, 1.5)
                    when 'rest_day' then coalesce(p.overtime_rate_rest_day, 1.5)
                    when 'normal' then coalesce(p.overtime_rate_weekday, 1.25)
                    else case when v_holiday then coalesce(p.overtime_rate_holiday, 1.5)
                       when not (extract(dow from ar.work_date)::smallint = any(b.working_days)) then coalesce(p.overtime_rate_rest_day, 1.5)
                       else coalesce(p.overtime_rate_weekday, 1.25) end end;
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'OT', 'Overtime ' || to_char(ar.work_date, 'DD Mon') || ' (x' || trim(to_char(v_rate, 'FM0.00')) || ')', 'earning',
                round(v_ot_take / 60.0, 2), round(v_hourly * v_rate, 4), round(v_ot_take / 60.0 * v_hourly * v_rate, 2), true, false, 'overtime', 50);
      end loop;
    end if;

    -- Approved claims paid through payroll, up to this period (claims stay separate from allowances).
    if v_has_claims then
      for cl in select c.id, c.amount, t.name, c.claim_date from public.claims c join public.claim_types t on t.id = c.claim_type_id
                 where c.employee_id = e.id and c.status = 'approved' and c.payout_method = 'payroll' and c.payroll_run_id is null
                   and coalesce(c.target_period_start, c.claim_date) <= r.period_end loop
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, source_id, sort)
        values (r.business_id, r.id, v_re, e.id, 'CLAIM', cl.name || ' claim ' || to_char(cl.claim_date, 'DD Mon'), 'earning', cl.amount, false, false, 'expense_claim', cl.id, 60);
        update public.claims set payroll_run_id = r.id where id = cl.id;
      end loop;
    end if;

    -- Changes typed in by hand on this run are kept when recalculating.
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort)
    select r.business_id, r.id, v_re, e.id, m.code, m.name, m.kind, m.amount, m.is_taxable, m.is_pensionable, 'manual', 70
      from _manual m where m.employee_id = e.id;

    select coalesce(sum(amount) filter (where kind = 'earning'), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_taxable), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_pensionable), 0)
      into v_gross, v_taxable, v_pensionable
      from public.payroll_run_lines where run_employee_id = v_re;

    -- Deductions ------------------------------------------------------
    for ln in select id, installment_amount, outstanding, kind from public.loans
               where employee_id = e.id and status = 'active' and start_date <= r.period_end and outstanding > 0 loop
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, source_id, sort)
      values (r.business_id, r.id, v_re, e.id, upper(ln.kind), case when ln.kind = 'advance' then 'Salary advance' else 'Loan repayment' end, 'deduction',
              least(ln.installment_amount, ln.outstanding), 'loan', ln.id, 80);
    end loop;

    v_pen_emp := 0; v_employer := 0;
    if pen.id is not null and (pen.applies_to = 'all' or (pen.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := case pen.wage_base when 'basic' then v_salary when 'gross' then v_gross else v_pensionable end;
      if pen.wage_ceiling is not null then v_amount := least(v_amount, pen.wage_ceiling); end if;
      v_pen_emp := round(v_amount * pen.employee_rate / 100, 2);
      v_employer := round(v_amount * pen.employer_rate / 100, 2);
      if v_pen_emp > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'PENSION', 'Pension (' || trim(to_char(pen.employee_rate, 'FM990.###')) || '%)', 'deduction', pen.employee_rate, v_pen_emp, 'statutory', 90);
      end if;
      if v_employer > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'PENSION_ER', 'Employer pension (' || trim(to_char(pen.employer_rate, 'FM990.###')) || '%)', 'employer_contribution', pen.employer_rate, v_employer, 'statutory', 95);
      end if;
    end if;

    v_tax := 0;
    if tax.id is not null and (tax.applies_to = 'all' or (tax.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := greatest(v_taxable - v_pen_emp, 0);
      v_tax := case when tax.basis = 'annual' then round(private.tax_for(tax.id, v_amount * 12) / 12, 2) else private.tax_for(tax.id, v_amount) end;
      if v_tax > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, sort)
        values (r.business_id, r.id, v_re, e.id, 'TAX', 'Income tax', 'deduction', v_tax, 'statutory', 91);
      end if;
    end if;

    select coalesce(sum(amount), 0) into v_ded from public.payroll_run_lines where run_employee_id = v_re and kind = 'deduction';
    if v_gross - v_ded < 0 then
      v_exc := v_exc || jsonb_build_object('code', 'negative', 'message', 'Deductions are more than pay', 'severity', 'error');
    end if;
    update public.payroll_run_employees set
      gross_pay = v_gross, taxable_pay = greatest(v_taxable - v_pen_emp, 0), pensionable_pay = v_pensionable,
      total_deductions = v_ded, net_pay = v_gross - v_ded, employer_contributions = v_employer, exceptions = v_exc
    where id = v_re;
  end loop;

  update public.payroll_runs set
    status = 'calculated', calculated_at = now(), calculated_by = auth.uid(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_gross = (select coalesce(sum(gross_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_deductions = (select coalesce(sum(total_deductions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_net = (select coalesce(sum(net_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_employer_contributions = (select coalesce(sum(employer_contributions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included')
  where id = r.id;
  update public.claims c set payroll_run_id = null
   where c.payroll_run_id = r.id and c.employee_id in (select employee_id from _held);
  return jsonb_build_object('people', v_n);
end $$;

-- ---------------------------------------------------------------------
-- 8. Salaries: change a group at once, or import from a file
-- ---------------------------------------------------------------------
-- p_mode: 'percent' (raise by a percentage), 'add' (add an amount), 'set' (set to an amount).
create or replace function public.bulk_change_salaries(
  p_business uuid, p_employees uuid[], p_mode text, p_value numeric, p_effective date, p_reason text, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_new numeric;
  v_rows jsonb := '[]'::jsonb;
  v_n int := 0;
begin
  if p_business not in (select private.biz_all('compensation', 'edit')) or p_business not in (select private.biz_all('compensation', 'create')) then
    raise exception 'You don''t have permission to change salaries' using errcode = '42501';
  end if;
  if p_mode not in ('percent', 'add', 'set') or p_value is null then
    raise exception 'Choose how to change the salaries' using errcode = '22023';
  end if;
  if p_mode = 'percent' and (p_value <= -100 or p_value > 1000) then
    raise exception 'Use a percentage between -99 and 1000' using errcode = '22023';
  end if;
  if p_effective is null then
    raise exception 'Choose the date the new salaries start' using errcode = '22023';
  end if;
  if coalesce(array_length(p_employees, 1), 0) = 0 then
    raise exception 'Choose at least one person' using errcode = '22023';
  end if;
  for e in select em.id, trim(em.first_name || ' ' || em.last_name) as name, em.employee_code,
                  (select c from public.employee_compensation c where c.employee_id = em.id and c.effective_date <= p_effective
                    order by c.effective_date desc limit 1) as cur
             from public.employees em where em.business_id = p_business and em.id = any(p_employees) order by em.first_name loop
    if (e.cur).basic_salary is null and p_mode <> 'set' then
      v_rows := v_rows || jsonb_build_object('employee_id', e.id, 'name', e.name, 'code', e.employee_code, 'old', null, 'new', null,
                                             'skipped', 'No salary yet, so there''s nothing to raise');
      continue;
    end if;
    v_new := round(case p_mode when 'percent' then (e.cur).basic_salary * (1 + p_value / 100)
                               when 'add' then (e.cur).basic_salary + p_value else p_value end, 2);
    if v_new < 0 then
      v_rows := v_rows || jsonb_build_object('employee_id', e.id, 'name', e.name, 'code', e.employee_code, 'old', (e.cur).basic_salary, 'new', v_new,
                                             'skipped', 'The new salary would be below zero');
      continue;
    end if;
    v_rows := v_rows || jsonb_build_object('employee_id', e.id, 'name', e.name, 'code', e.employee_code, 'old', (e.cur).basic_salary, 'new', v_new);
    if not p_dry_run then
      insert into public.employee_compensation (business_id, employee_id, effective_date, basic_salary, currency, pay_basis, reason)
      values (p_business, e.id, p_effective, v_new, coalesce((e.cur).currency, (select currency from public.businesses where id = p_business)),
              coalesce((e.cur).pay_basis, 'monthly'), nullif(trim(p_reason), ''))
      on conflict (employee_id, effective_date) do update set basic_salary = excluded.basic_salary, reason = excluded.reason;
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('changed', v_n, 'rows', v_rows);
end $$;
revoke all on function public.bulk_change_salaries(uuid, uuid[], text, numeric, date, text, boolean) from public, anon;
grant execute on function public.bulk_change_salaries(uuid, uuid[], text, numeric, date, text, boolean) to authenticated;

-- Rows: [{row, code, salary, date, basis?, reason?}]. Checks everything first; saves only when asked and nothing is wrong.
create or replace function public.import_salaries(p_business uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  v_emp uuid;
  v_errors jsonb := '[]'::jsonb;
  v_ok jsonb := '[]'::jsonb;
  v_salary numeric;
  v_date date;
  v_basis text;
  v_row int;
  v_currency text;
begin
  if p_business not in (select private.biz_all('compensation', 'create')) or p_business not in (select private.biz_all('compensation', 'edit')) then
    raise exception 'You don''t have permission to change salaries' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import up to 5,000 rows at a time' using errcode = '22023';
  end if;
  select currency into v_currency from public.businesses where id = p_business;
  for x in select * from jsonb_array_elements(p_rows) loop
    v_row := coalesce((x ->> 'row')::int, 0);
    select id into v_emp from public.employees where business_id = p_business and lower(employee_code) = lower(trim(x ->> 'code'));
    if v_emp is null then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('No one has the staff number "%s"', coalesce(x ->> 'code', '')));
      continue;
    end if;
    begin
      v_salary := replace(trim(x ->> 'salary'), ',', '')::numeric;
    exception when others then
      v_salary := null;
    end;
    if v_salary is null or v_salary < 0 then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('"%s" isn''t a salary amount', coalesce(x ->> 'salary', '')));
      continue;
    end if;
    begin
      v_date := (x ->> 'date')::date;
    exception when others then
      v_date := null;
    end;
    if v_date is null then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('"%s" isn''t a date (use YYYY-MM-DD)', coalesce(x ->> 'date', '')));
      continue;
    end if;
    v_basis := lower(coalesce(nullif(trim(x ->> 'basis'), ''), 'monthly'));
    if v_basis not in ('monthly', 'daily', 'hourly') then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', format('"%s" should be monthly, daily or hourly', x ->> 'basis'));
      continue;
    end if;
    v_ok := v_ok || jsonb_build_object('employee_id', v_emp, 'salary', v_salary, 'date', v_date, 'basis', v_basis, 'reason', nullif(trim(x ->> 'reason'), ''));
  end loop;
  if not p_dry_run and jsonb_array_length(v_errors) = 0 then
    insert into public.employee_compensation (business_id, employee_id, effective_date, basic_salary, currency, pay_basis, reason)
    select p_business, (o ->> 'employee_id')::uuid, (o ->> 'date')::date, (o ->> 'salary')::numeric, v_currency, o ->> 'basis', coalesce(o ->> 'reason', 'Imported')
      from jsonb_array_elements(v_ok) o
    on conflict (employee_id, effective_date) do update set basic_salary = excluded.basic_salary, pay_basis = excluded.pay_basis, reason = excluded.reason;
  end if;
  return jsonb_build_object('valid', jsonb_array_length(v_ok), 'errors', v_errors,
                            'imported', case when not p_dry_run and jsonb_array_length(v_errors) = 0 then jsonb_array_length(v_ok) else 0 end);
end $$;
revoke all on function public.import_salaries(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_salaries(uuid, jsonb, boolean) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20261002000001_pay_items.sql') on conflict do nothing;

-- ===================== 20261002000002_pay_vars_types.sql =====================
-- =====================================================================
-- 0034 Fix: a person with no days employed in a pay period (for example
--   someone who joins after it) made the monthly numbers fail for the
--   next person worked out, which could stop a pay run. The numbers now
--   use plain typed variables, so both ways of working them out match.
-- =====================================================================
create or replace function private.pay_vars(p_business uuid, p_employee uuid, p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
  v_from date;
  v_to date;
  v_basic numeric := 0;
  v_basis text := 'monthly';
  v_working int := 0;
  v_working_employed int := 0;
  v_has_att boolean;
  v_has_leave boolean;
  v_unpaid numeric := 0;
  -- Plain typed variables (not a record), so the numbers have the same types whichever way they're worked out.
  v_present numeric := 0;
  v_half int := 0;
  v_absent int := 0;
  v_on_leave int := 0;
  v_late int := 0;
  v_early int := 0;
  v_ot numeric := 0;
  v_run int := 0;
  v_cap int;
  d date;
begin
  select * into e from public.employees where id = p_employee and business_id = p_business;
  v_from := greatest(p_start, coalesce(e.join_date, p_start));
  v_to := least(p_end, coalesce(e.exit_date, p_end));
  select c.basic_salary, c.pay_basis into v_basic, v_basis from public.employee_compensation c
   where c.employee_id = p_employee and c.effective_date <= p_end order by c.effective_date desc limit 1;
  v_has_att := exists (select 1 from public.business_modules where business_id = p_business and module_key = 'attendance' and enabled);
  v_has_leave := exists (select 1 from public.business_modules where business_id = p_business and module_key = 'leave' and enabled);

  -- Working days in the whole period (so a month's allowance is measured against the full month).
  d := p_start;
  while d <= p_end loop
    if (select dp.kind from private.day_plan(p_business, p_employee, d) dp) = 'working' then
      v_working := v_working + 1;
      if d between v_from and v_to then v_working_employed := v_working_employed + 1; end if;
    end if;
    d := d + 1;
  end loop;

  if v_has_leave and v_from <= v_to then
    select coalesce(sum(private.leave_days(p_business, lr.leave_type_id, greatest(lr.start_date, v_from), least(lr.end_date, v_to),
               case when lr.start_date >= v_from then lr.start_half else 'full' end,
               case when lr.end_date <= v_to then lr.end_half else 'full' end, e.branch_id)), 0)
      into v_unpaid
      from public.leave_requests lr join public.leave_types lt on lt.id = lr.leave_type_id
     where lr.employee_id = p_employee and lr.status = 'approved' and not lt.is_paid
       and lr.start_date <= v_to and lr.end_date >= v_from;
  end if;

  if v_has_att and v_from <= v_to then
    v_cap := coalesce(((private.policy_for(p_business, p_employee)).overtime_monthly_cap_hours * 60)::int, 2147483647);
    select count(*) filter (where x.status in ('present', 'late', 'early_leave') and x.kind = 'working') as present,
           count(*) filter (where x.status = 'half_day') as half,
           count(*) filter (where x.status = 'absent') as absent,
           count(*) filter (where x.status = 'on_leave') as on_leave,
           count(*) filter (where x.late_minutes > 0) as late_n,
           count(*) filter (where x.status = 'early_leave') as early_n,
           least(coalesce(sum(x.overtime_minutes) filter (where x.overtime_state = 'approved'), 0), v_cap) as ot
      into v_present, v_half, v_absent, v_on_leave, v_late, v_early, v_ot
      from private.attendance_days(p_business, v_from, v_to, p_employee) x;
    select coalesce(max(n), 0) into v_run from (
      select count(*) as n from (
        select status, row_number() over (order by day) - row_number() over (partition by status = 'absent' order by day) as grp
          from private.attendance_days(p_business, v_from, v_to, p_employee)
         where status is not null and status not in ('rest_day', 'holiday')) y
       where status = 'absent' group by grp) z;
  else
    -- Without Time & shifts, everyone counts as present on their working days (less unpaid leave).
    v_present := greatest(v_working_employed - v_unpaid, 0);
  end if;

  return jsonb_build_object(
    'basic_salary', coalesce(v_basic, 0),
    'days_in_month', p_end - p_start + 1,
    'working_days', v_working,
    'days_present', coalesce(v_present, 0) + 0.5 * coalesce(v_half, 0),
    'unapproved_absences', coalesce(v_absent, 0),
    'approved_absences', coalesce(v_on_leave, 0),
    'half_days', coalesce(v_half, 0),
    'late_count', coalesce(v_late, 0),
    'early_leaves', coalesce(v_early, 0),
    'consecutive_unapproved_absences', coalesce(v_run, 0),
    'overtime_hours', round(coalesce(v_ot, 0) / 60.0, 2),
    'unpaid_leave_days', v_unpaid,
    'years_of_service', case when e.join_date is null or e.join_date > p_end then 0 else extract(year from age(p_end, e.join_date))::int end,
    'amount', 0,
    -- Not formula variables; used to explain results.
    '_days_employed', greatest(v_to - v_from + 1, 0),
    '_pay_basis', coalesce(v_basis, 'monthly'),
    '_has_salary', v_basic is not null);
end $$;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20261002000002_pay_vars_types.sql') on conflict do nothing;

-- ===================== 20261002000003_pay_items_employment.sql =====================
-- =====================================================================
-- 0035 Pay items: nobody gets an item for a period they didn't work for
--   the company at all (the test panel says so), and "per occurrence"
--   explanations read plainly when nothing is charged.
-- =====================================================================
create or replace function private.pay_item_applies(c public.pay_components, p_employee uuid, p_start date, p_end date, p_targets jsonb default null)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
begin
  if not c.is_active or (c.effective_from is not null and c.effective_from > p_end) or (c.effective_to is not null and c.effective_to < p_start) then
    return false;
  end if;
  -- Nobody gets anything for a period they didn't work for us at all.
  select * into e from public.employees where id = p_employee;
  if (e.join_date is not null and e.join_date > p_end) or (e.exit_date is not null and e.exit_date < p_start) then
    return false;
  end if;
  if c.applies_to = 'all' then return true; end if;
  if c.id is not null and exists (select 1 from public.employee_pay_components o where o.component_id = c.id and o.employee_id = p_employee
                                    and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)) then
    return true;
  end if;
  if p_targets is not null then
    return exists (select 1 from jsonb_array_elements(p_targets) t
                    where (t ->> 'target_type' = 'employee' and (t ->> 'target_id')::uuid = e.id)
                       or (t ->> 'target_type' = 'department' and (t ->> 'target_id')::uuid = e.department_id)
                       or (t ->> 'target_type' = 'position' and (t ->> 'target_id')::uuid = e.position_id)
                       or (t ->> 'target_type' = 'branch' and (t ->> 'target_id')::uuid = e.branch_id));
  end if;
  return exists (select 1 from public.pay_component_targets t where t.component_id = c.id and (
                   (t.target_type = 'employee' and t.target_id = e.id) or (t.target_type = 'department' and t.target_id = e.department_id)
                   or (t.target_type = 'position' and t.target_id = e.position_id) or (t.target_type = 'branch' and t.target_id = e.branch_id)));
end $$;

create or replace function private.pay_item_result(c public.pay_components, p_employee uuid, p_start date, p_end date, p_vars jsonb, p_currency text)
returns table (amount numeric, explanation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  ov record;
  v_amount numeric;
  v_pct numeric;
  v_basis numeric;
  v_count numeric;
  v_n numeric;
  r numeric;
  v_out numeric;
  v_expl text;
  v_rule jsonb;
  v_vars jsonb;
  v_unit text;
  m text;
begin
  select o.amount, o.percent into ov from public.employee_pay_components o
   where o.component_id = c.id and o.employee_id = p_employee and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)
   order by o.start_date desc limit 1;
  v_amount := coalesce(ov.amount, c.default_amount, 0);
  v_pct := coalesce(ov.percent, c.default_percent, 0);
  v_vars := p_vars || jsonb_build_object('amount', v_amount);

  case c.method
    when 'fixed' then
      r := v_amount;
      v_expl := private.pay_money(v_amount, p_currency) || ' a month';
    when 'per_day' then
      r := v_amount * (p_vars ->> 'days_present')::numeric;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num((p_vars ->> 'days_present')::numeric) || ' days present = ' || private.pay_money(r, p_currency);
    when 'prorated' then
      if c.prorate_basis = 'working' then
        v_basis := (p_vars ->> 'working_days')::numeric;
        v_count := (p_vars ->> 'days_present')::numeric;
        v_unit := ' working days';
      else
        -- Calendar days: every day they were employed counts, less the days they should have been at work and weren't.
        v_basis := (p_vars ->> 'days_in_month')::numeric;
        v_count := greatest(0, (p_vars ->> '_days_employed')::numeric - (p_vars ->> 'unapproved_absences')::numeric
                               - (p_vars ->> 'unpaid_leave_days')::numeric - 0.5 * (p_vars ->> 'half_days')::numeric);
        v_unit := ' days in the month';
      end if;
      r := case when v_basis > 0 then v_amount * v_count / v_basis else 0 end;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_count) || ' of ' || private.pay_num(v_basis) || v_unit
                || ' = ' || private.pay_money(r, p_currency);
    when 'percent' then
      r := (p_vars ->> 'basic_salary')::numeric * v_pct / 100;
      v_expl := private.pay_num(v_pct) || '% of basic salary ' || private.pay_money((p_vars ->> 'basic_salary')::numeric, p_currency)
                || ' = ' || private.pay_money(r, p_currency);
    when 'per_occurrence' then
      v_count := coalesce((p_vars ->> c.occurrence_var)::numeric, 0);
      v_n := greatest(0, v_count - c.occurrence_after);
      r := v_amount * v_n;
      v_unit := case c.occurrence_var
                  when 'late_count' then case when v_count = 1 then 'late' else 'lates' end
                  when 'early_leaves' then case when v_count = 1 then 'early leave' else 'early leaves' end
                  when 'unapproved_absences' then case when v_count = 1 then 'unapproved absence' else 'unapproved absences' end
                  when 'half_days' then case when v_count = 1 then 'half day' else 'half days' end
                  else replace(c.occurrence_var, '_', ' ') end;
      v_expl := private.pay_num(v_count) || ' ' || v_unit
                || case when v_n = 0 and c.occurrence_after > 0 then ', within the first ' || c.occurrence_after || ' that are free, so nothing is '
                                                                     || case when c.kind = 'deduction' then 'taken off' else 'paid' end
                        when v_n = 0 then ', so nothing is ' || case when c.kind = 'deduction' then 'taken off' else 'paid' end
                        else case when c.occurrence_after > 0 then ', the first ' || c.occurrence_after || ' free, so ' || private.pay_num(v_n) || ' counted' else '' end
                             || ': ' || private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_n) || ' = ' || private.pay_money(r, p_currency) end;
    else
      r := private.pay_eval(c.formula_ast, v_vars);
      v_expl := c.formula || ' = ' || private.pay_money(r, p_currency);
  end case;
  r := round(greatest(coalesce(r, 0), 0), 2);
  v_out := r;

  if c.rules_mode = 'builder' and jsonb_array_length(c.rules) > 0 then
    v_vars := p_vars || jsonb_build_object('amount', r);
    select x into v_rule from jsonb_array_elements(c.rules) with ordinality t(x, i)
     where private.pay_rule_matches(x, v_vars) order by i limit 1;
    if v_rule is null then
      v_expl := v_expl || '. No rule matched, so it''s paid in full';
    else
      m := v_rule #>> '{outcome,type}';
      v_out := case m
        when 'percent' then r * (v_rule #>> '{outcome,value}')::numeric / 100
        when 'nothing' then 0
        when 'subtract' then greatest(r - (v_rule #>> '{outcome,value}')::numeric, 0)
        when 'fixed' then (v_rule #>> '{outcome,value}')::numeric
        else r end;
      v_expl := v_expl || '. Rule ''' || coalesce(nullif(v_rule ->> 'label', ''), 'rule') || ''' applied: ' || case m
        when 'percent' then private.pay_num((v_rule #>> '{outcome,value}')::numeric) || '% = ' || private.pay_money(v_out, p_currency)
        when 'nothing' then 'nothing paid'
        when 'subtract' then private.pay_money(r, p_currency) || ' − ' || private.pay_money((v_rule #>> '{outcome,value}')::numeric, p_currency) || ' = ' || private.pay_money(v_out, p_currency)
        when 'fixed' then 'set to ' || private.pay_money(v_out, p_currency)
        else 'paid in full' end;
    end if;
  elsif c.rules_mode = 'formula' and c.rules_ast is not null then
    v_out := private.pay_eval(c.rules_ast, p_vars || jsonb_build_object('amount', r));
    v_expl := v_expl || '. Rule formula ' || c.rules_formula || ' gives ' || private.pay_money(greatest(v_out, 0), p_currency);
  end if;

  amount := round(greatest(coalesce(v_out, 0), 0), 2);
  explanation := v_expl;
  return next;
end $$;

create or replace function public.pay_items_preview(p_business uuid, p_employee uuid, p_month date, p_draft jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_vars jsonb;
  v_currency text;
  c public.pay_components;
  v_draft public.pay_components;
  v_items jsonb := '[]'::jsonb;
  v_amt numeric;
  v_ex text;
  v_applies boolean;
  v_targets jsonb;
begin
  if p_business not in (select private.biz_all('payroll', 'view')) or not private.can_emp('compensation', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s pay' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee and business_id = p_business) then
    raise exception 'Choose a person' using errcode = '22023';
  end if;
  select currency into v_currency from public.businesses where id = p_business;
  v_vars := private.pay_vars(p_business, p_employee, v_start, v_end);

  if p_draft is not null then
    select * into v_draft from public.pay_components where id = (p_draft ->> 'id')::uuid and business_id = p_business;
    v_draft := jsonb_populate_record(coalesce(v_draft, null::public.pay_components), (p_draft - 'targets') || jsonb_build_object('business_id', p_business));
    v_draft.is_active := true;
    perform private.pay_item_check(v_draft);
  end if;

  for c in select * from public.pay_components pc where pc.business_id = p_business and pc.is_active
            and (v_draft.id is null or pc.id <> v_draft.id)
           union all select v_draft.* where p_draft is not null
           order by kind desc, sort, name loop
    v_targets := case when p_draft is not null and c.id is not distinct from v_draft.id then p_draft -> 'targets' end;
    v_applies := private.pay_item_applies(c, p_employee, v_start, v_end, v_targets);
    v_amt := null;
    v_ex := null;
    if v_applies then
      select x.amount, x.explanation into v_amt, v_ex from private.pay_item_result(c, p_employee, v_start, v_end, v_vars, v_currency) x;
    end if;
    v_items := v_items || jsonb_build_object(
      'id', c.id, 'name', c.name, 'kind', c.kind, 'draft', p_draft is not null and c.id is not distinct from v_draft.id,
      'applies', v_applies,
      'why_not', case when v_applies then null
                      when exists (select 1 from public.employees x where x.id = p_employee
                                    and ((x.join_date is not null and x.join_date > v_end) or (x.exit_date is not null and x.exit_date < v_start))) then 'Not working for you that month'
                      when (c.effective_from is not null and c.effective_from > v_end) or (c.effective_to is not null and c.effective_to < v_start) then 'Not in effect that month'
                      else 'Not for this person' end,
      'amount', v_amt, 'explanation', v_ex);
  end loop;
  return jsonb_build_object('vars', v_vars, 'currency', v_currency, 'start', v_start, 'end', v_end, 'items', v_items);
end $$;
revoke all on function public.pay_items_preview(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.pay_items_preview(uuid, uuid, date, jsonb) to authenticated;
revoke all on function public.pay_items_preview(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.pay_items_preview(uuid, uuid, date, jsonb) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20261002000003_pay_items_employment.sql') on conflict do nothing;

-- ===================== 20261002000004_formula_explanations.sql =====================
-- =====================================================================
-- 0036 Formula explanations show the numbers they used, for example
--   "... = MVR 1,557.69 (basic_salary MVR 13,500.00, working_days 26,
--   unapproved_absences 3)".
-- =====================================================================
-- Every variable a formula uses, in the order they first appear.
create or replace function private.pay_ast_vars(n jsonb)
returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_child text;
  i int;
begin
  if n is null or jsonb_typeof(n) <> 'array' then return v_out; end if;
  if n ->> 0 = 'var' then return array[n ->> 1]; end if;
  if n ->> 0 = 'num' then return v_out; end if;
  for i in 1 .. jsonb_array_length(n) - 1 loop
    foreach v_child in array private.pay_ast_vars(n -> i) loop
      if not (v_child = any(v_out)) then v_out := v_out || v_child; end if;
    end loop;
  end loop;
  return v_out;
end $$;

-- " (basic_salary MVR 13,500.00, working_days 26)"
create or replace function private.pay_formula_values(n jsonb, v jsonb, p_currency text)
returns text
language sql immutable set search_path = '' as $$
  select coalesce(' (' || string_agg(k || ' ' || case when k in ('basic_salary', 'amount') then private.pay_money((v ->> k)::numeric, p_currency)
                                                   else private.pay_num((v ->> k)::numeric) end, ', ' order by ord) || ')', '')
    from unnest(private.pay_ast_vars(n)) with ordinality as t(k, ord)
$$;

create or replace function private.pay_item_result(c public.pay_components, p_employee uuid, p_start date, p_end date, p_vars jsonb, p_currency text)
returns table (amount numeric, explanation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  ov record;
  v_amount numeric;
  v_pct numeric;
  v_basis numeric;
  v_count numeric;
  v_n numeric;
  r numeric;
  v_out numeric;
  v_expl text;
  v_rule jsonb;
  v_vars jsonb;
  v_unit text;
  m text;
begin
  select o.amount, o.percent into ov from public.employee_pay_components o
   where o.component_id = c.id and o.employee_id = p_employee and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)
   order by o.start_date desc limit 1;
  v_amount := coalesce(ov.amount, c.default_amount, 0);
  v_pct := coalesce(ov.percent, c.default_percent, 0);
  v_vars := p_vars || jsonb_build_object('amount', v_amount);

  case c.method
    when 'fixed' then
      r := v_amount;
      v_expl := private.pay_money(v_amount, p_currency) || ' a month';
    when 'per_day' then
      r := v_amount * (p_vars ->> 'days_present')::numeric;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num((p_vars ->> 'days_present')::numeric) || ' days present = ' || private.pay_money(r, p_currency);
    when 'prorated' then
      if c.prorate_basis = 'working' then
        v_basis := (p_vars ->> 'working_days')::numeric;
        v_count := (p_vars ->> 'days_present')::numeric;
        v_unit := ' working days';
      else
        -- Calendar days: every day they were employed counts, less the days they should have been at work and weren't.
        v_basis := (p_vars ->> 'days_in_month')::numeric;
        v_count := greatest(0, (p_vars ->> '_days_employed')::numeric - (p_vars ->> 'unapproved_absences')::numeric
                               - (p_vars ->> 'unpaid_leave_days')::numeric - 0.5 * (p_vars ->> 'half_days')::numeric);
        v_unit := ' days in the month';
      end if;
      r := case when v_basis > 0 then v_amount * v_count / v_basis else 0 end;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_count) || ' of ' || private.pay_num(v_basis) || v_unit
                || ' = ' || private.pay_money(r, p_currency);
    when 'percent' then
      r := (p_vars ->> 'basic_salary')::numeric * v_pct / 100;
      v_expl := private.pay_num(v_pct) || '% of basic salary ' || private.pay_money((p_vars ->> 'basic_salary')::numeric, p_currency)
                || ' = ' || private.pay_money(r, p_currency);
    when 'per_occurrence' then
      v_count := coalesce((p_vars ->> c.occurrence_var)::numeric, 0);
      v_n := greatest(0, v_count - c.occurrence_after);
      r := v_amount * v_n;
      v_unit := case c.occurrence_var
                  when 'late_count' then case when v_count = 1 then 'late' else 'lates' end
                  when 'early_leaves' then case when v_count = 1 then 'early leave' else 'early leaves' end
                  when 'unapproved_absences' then case when v_count = 1 then 'unapproved absence' else 'unapproved absences' end
                  when 'half_days' then case when v_count = 1 then 'half day' else 'half days' end
                  else replace(c.occurrence_var, '_', ' ') end;
      v_expl := private.pay_num(v_count) || ' ' || v_unit
                || case when v_n = 0 and c.occurrence_after > 0 then ', within the first ' || c.occurrence_after || ' that are free, so nothing is '
                                                                     || case when c.kind = 'deduction' then 'taken off' else 'paid' end
                        when v_n = 0 then ', so nothing is ' || case when c.kind = 'deduction' then 'taken off' else 'paid' end
                        else case when c.occurrence_after > 0 then ', the first ' || c.occurrence_after || ' free, so ' || private.pay_num(v_n) || ' counted' else '' end
                             || ': ' || private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_n) || ' = ' || private.pay_money(r, p_currency) end;
    else
      r := private.pay_eval(c.formula_ast, v_vars);
      v_expl := c.formula || ' = ' || private.pay_money(r, p_currency) || private.pay_formula_values(c.formula_ast, v_vars, p_currency);
  end case;
  r := round(greatest(coalesce(r, 0), 0), 2);
  v_out := r;

  if c.rules_mode = 'builder' and jsonb_array_length(c.rules) > 0 then
    v_vars := p_vars || jsonb_build_object('amount', r);
    select x into v_rule from jsonb_array_elements(c.rules) with ordinality t(x, i)
     where private.pay_rule_matches(x, v_vars) order by i limit 1;
    if v_rule is null then
      v_expl := v_expl || '. No rule matched, so it''s paid in full';
    else
      m := v_rule #>> '{outcome,type}';
      v_out := case m
        when 'percent' then r * (v_rule #>> '{outcome,value}')::numeric / 100
        when 'nothing' then 0
        when 'subtract' then greatest(r - (v_rule #>> '{outcome,value}')::numeric, 0)
        when 'fixed' then (v_rule #>> '{outcome,value}')::numeric
        else r end;
      v_expl := v_expl || '. Rule ''' || coalesce(nullif(v_rule ->> 'label', ''), 'rule') || ''' applied: ' || case m
        when 'percent' then private.pay_num((v_rule #>> '{outcome,value}')::numeric) || '% = ' || private.pay_money(v_out, p_currency)
        when 'nothing' then 'nothing paid'
        when 'subtract' then private.pay_money(r, p_currency) || ' − ' || private.pay_money((v_rule #>> '{outcome,value}')::numeric, p_currency) || ' = ' || private.pay_money(v_out, p_currency)
        when 'fixed' then 'set to ' || private.pay_money(v_out, p_currency)
        else 'paid in full' end;
    end if;
  elsif c.rules_mode = 'formula' and c.rules_ast is not null then
    v_out := private.pay_eval(c.rules_ast, p_vars || jsonb_build_object('amount', r));
    v_expl := v_expl || '. Rule formula ' || c.rules_formula || ' gives ' || private.pay_money(greatest(v_out, 0), p_currency)
              || private.pay_formula_values(c.rules_ast, p_vars || jsonb_build_object('amount', r), p_currency);
  end if;

  amount := round(greatest(coalesce(v_out, 0), 0), 2);
  explanation := v_expl;
  return next;
end $$;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20261002000004_formula_explanations.sql') on conflict do nothing;

-- ===================== 20261003000001_payroll_runs.sql =====================
-- =====================================================================
-- 0037 PAYROLL RUNS, completed
--   * A run is for a pay schedule (monthly, semi-monthly, bi-weekly or
--     weekly) and only includes the people on that schedule. Ad-hoc runs
--     pay one-off amounts such as bonuses and nothing else.
--   * Monthly amounts (salary, fixed and percentage allowances) are
--     shared out over shorter pay periods, and tax on a monthly table is
--     worked out on the monthly equivalent.
--   * Steps: calculate (as often as needed) → approve → finalize (locks,
--     publishes payslips) → paid. Approving can be undone before
--     finalizing. Only the owner can reverse a finalized run, with a reason.
--   * Adjustments by hand need a reason and are kept in the history.
--   * More things to check on each person: no time records, missing
--     clock-outs, requests still waiting, and big changes from last month.
-- =====================================================================

alter table public.payroll_runs
  add column if not exists run_type text not null default 'regular' check (run_type in ('regular', 'adhoc')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null,
  add column if not exists payslips_emailed_at timestamptz;
create index if not exists payroll_runs_approved_by_fk_idx on public.payroll_runs (approved_by);
alter table public.payroll_runs drop constraint if exists payroll_runs_status_check;
alter table public.payroll_runs add constraint payroll_runs_status_check
  check (status in ('draft', 'calculated', 'approved', 'finalized', 'paid', 'reversed'));

-- How much of a monthly amount one pay period gets.
create or replace function private.pay_period_factor(p_frequency text)
returns numeric
language sql immutable as $$
  select case p_frequency when 'semi_monthly' then 0.5 when 'biweekly' then 12.0 / 26 when 'weekly' then 12.0 / 52 else 1 end
$$;

-- ---------------------------------------------------------------------
-- Creating runs
-- ---------------------------------------------------------------------
drop function if exists public.create_payroll_run(uuid, date, date, date, text);
create function public.create_payroll_run(
  p_business uuid, p_start date, p_end date, p_pay_date date, p_name text default null,
  p_schedule uuid default null, p_type text default 'regular')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_sched public.pay_schedules;
begin
  if p_business not in (select private.biz_all('payroll', 'create')) then
    raise exception 'You don''t have permission to run payroll' using errcode = '42501';
  end if;
  if p_type not in ('regular', 'adhoc') then
    raise exception 'Choose a regular or an ad-hoc run' using errcode = '22023';
  end if;
  if p_end < p_start or p_end - p_start > 62 then
    raise exception 'Choose a pay period of up to two months' using errcode = '22023';
  end if;
  if p_schedule is not null then
    select * into v_sched from public.pay_schedules where id = p_schedule and business_id = p_business and is_active;
    if v_sched.id is null then raise exception 'Choose a pay schedule' using errcode = '22023'; end if;
  else
    select * into v_sched from public.pay_schedules where business_id = p_business and is_default;
  end if;
  if p_type = 'regular' and exists (
      select 1 from public.payroll_runs where business_id = p_business and status <> 'reversed' and run_type = 'regular'
         and pay_schedule_id is not distinct from v_sched.id and period_start <= p_end and period_end >= p_start) then
    raise exception 'There''s already a pay run for some of those dates on this pay schedule' using errcode = '22023';
  end if;
  insert into public.payroll_runs (business_id, pay_schedule_id, name, period_start, period_end, pay_date, run_type)
  values (p_business, v_sched.id,
          coalesce(nullif(trim(p_name), ''),
                   case when p_type = 'adhoc' then 'Bonus ' || to_char(p_pay_date, 'FMMonth YYYY')
                        when coalesce(v_sched.frequency, 'monthly') = 'monthly' then to_char(p_start, 'FMMonth YYYY') || ' payroll'
                        else to_char(p_start, 'DD Mon') || ' to ' || to_char(p_end, 'DD Mon YYYY') || ' payroll' end),
          p_start, p_end, p_pay_date, p_type)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_payroll_run(uuid, date, date, date, text, uuid, text) from public, anon;
grant execute on function public.create_payroll_run(uuid, date, date, date, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Calculating
-- ---------------------------------------------------------------------
create or replace function public.calculate_payroll_run(p_run uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  b public.businesses;
  e public.employees;
  p public.attendance_policies;
  pen public.pension_schemes;
  tax public.tax_tables;
  v_sched public.pay_schedules;
  comp record;
  pc public.pay_components;
  cl record;
  ln record;
  ar record;
  res record;
  v_vars jsonb;
  v_re uuid;
  v_days int;
  v_workdays int;
  v_from date;
  v_to date;
  v_employed int;
  v_unpaid numeric;
  v_paid_days numeric;
  v_present numeric;
  v_worked_h numeric;
  v_ot_h numeric;
  v_basic numeric;
  v_salary numeric;
  v_hourly numeric;
  v_amount numeric;
  v_rate numeric;
  v_gross numeric;
  v_taxable numeric;
  v_pensionable numeric;
  v_ded numeric;
  v_employer numeric;
  v_pen_emp numeric;
  v_tax numeric;
  v_exc jsonb;
  v_has_att boolean;
  v_has_claims boolean;
  v_bank record;
  v_holiday boolean;
  v_n int := 0;
  v_ot_cap int;
  v_ot_used int;
  v_ot_take int;
  v_factor numeric;
  v_adhoc boolean;
  v_expl text;
  v_count int;
  v_prev numeric;
  d date;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to calculate this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is locked (approved or finalized). Undo the approval to change it.' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = r.business_id;
  select * into v_sched from public.pay_schedules where id = r.pay_schedule_id;
  v_adhoc := r.run_type = 'adhoc';
  v_factor := case when v_adhoc then 1 else private.pay_period_factor(coalesce(v_sched.frequency, 'monthly')) end;
  v_has_att := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'attendance' and enabled);
  v_has_claims := exists (select 1 from public.business_modules where business_id = r.business_id and module_key = 'claims' and enabled);
  select * into pen from public.pension_schemes where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;
  select * into tax from public.tax_tables where business_id = r.business_id and is_active and effective_from <= r.period_end order by effective_from desc limit 1;

  -- Start again: forget the previous calculation (people kept on hold stay on hold, amounts added by hand stay).
  create temp table if not exists _held (employee_id uuid) on commit drop;
  delete from _held where true;
  insert into _held select employee_id from public.payroll_run_employees where run_id = r.id and status in ('excluded', 'on_hold');
  create temp table if not exists _manual (employee_id uuid, code text, name text, kind text, amount numeric, is_taxable boolean, is_pensionable boolean, explanation text) on commit drop;
  delete from _manual where true;
  insert into _manual select employee_id, code, name, kind, amount, is_taxable, is_pensionable, explanation
    from public.payroll_run_lines where run_id = r.id and source = 'manual';
  update public.claims set payroll_run_id = null where payroll_run_id = r.id and status = 'approved';
  delete from public.payroll_run_employees where run_id = r.id;

  v_days := r.period_end - r.period_start + 1;
  v_workdays := 0;
  d := r.period_start;
  while d <= r.period_end loop
    if extract(dow from d)::smallint = any(b.working_days) then v_workdays := v_workdays + 1; end if;
    d := d + 1;
  end loop;

  for e in select * from public.employees em
            where em.business_id = r.business_id
              and (em.join_date is null or em.join_date <= r.period_end)
              and (em.exit_date is null or em.exit_date >= r.period_start)
              and not (em.status in ('resigned', 'terminated') and em.exit_date is null)
              -- Only the people paid on this run's schedule (people without one are on the default schedule).
              and (v_adhoc or r.pay_schedule_id is null or em.pay_schedule_id = r.pay_schedule_id
                   or (em.pay_schedule_id is null and coalesce(v_sched.is_default, false)))
            order by em.first_name, em.last_name loop
    v_exc := '[]'::jsonb;
    v_from := greatest(r.period_start, coalesce(e.join_date, r.period_start));
    v_to := least(r.period_end, coalesce(e.exit_date, r.period_end));
    v_employed := v_to - v_from + 1;

    select * into comp from public.employee_compensation
     where employee_id = e.id and effective_date <= r.period_end order by effective_date desc limit 1;
    select ba.bank_name, ba.account_name, ba.account_number into v_bank
      from public.employee_bank_accounts ba where ba.employee_id = e.id order by ba.is_primary desc limit 1;

    v_vars := private.pay_vars(r.business_id, e.id, r.period_start, r.period_end);
    v_unpaid := (v_vars ->> 'unpaid_leave_days')::numeric;
    v_present := (v_vars ->> 'days_present')::numeric;
    v_worked_h := 0;
    v_ot_h := (v_vars ->> 'overtime_hours')::numeric;
    if v_has_att then
      select coalesce(sum(worked_minutes), 0) / 60.0 into v_worked_h
        from public.attendance_records where employee_id = e.id and work_date between v_from and v_to;
    end if;

    v_basic := coalesce(comp.basic_salary, 0);
    if v_bank.account_number is null then
      v_exc := v_exc || jsonb_build_object('code', 'no_bank', 'message', 'No bank account on their profile', 'severity', 'warning');
    end if;
    if not v_adhoc then
      if comp.basic_salary is null then
        v_exc := v_exc || jsonb_build_object('code', 'no_salary', 'message', 'No salary on their profile', 'severity', 'error');
      end if;
      if v_has_att then
        -- No time records at all in the period: every working day would be an unapproved absence.
        if (v_vars ->> 'unapproved_absences')::numeric > 0
           and not exists (select 1 from public.attendance_records a where a.employee_id = e.id and a.work_date between v_from and v_to and a.clock_in_at is not null) then
          v_exc := v_exc || jsonb_build_object('code', 'no_attendance', 'severity', 'warning',
            'message', 'No time records this period, so ' || (v_vars ->> 'unapproved_absences') || ' working days count as unapproved absences');
        end if;
        select count(*) into v_count from public.attendance_records a
         where a.employee_id = e.id and a.work_date between v_from and v_to and a.clock_in_at is not null and a.clock_out_at is null;
        if v_count > 0 then
          v_exc := v_exc || jsonb_build_object('code', 'no_clock_out', 'severity', 'warning',
            'message', v_count || case when v_count = 1 then ' day has' else ' days have' end || ' no clock-out');
        end if;
        select count(*) into v_count from public.attendance_records a
         where a.employee_id = e.id and a.work_date between v_from and v_to and a.overtime_minutes > 0 and a.ot_decision is null
           and coalesce((private.policy_for(r.business_id, e.id)).overtime_requires_approval, false);
        if v_count > 0 then
          v_exc := v_exc || jsonb_build_object('code', 'overtime_waiting', 'severity', 'warning',
            'message', v_count || case when v_count = 1 then ' day' else ' days' end || ' of overtime still waiting for approval (not paid until approved)');
        end if;
      end if;
      -- Requests still waiting that could change this pay: time off in the period, claims, time fixes.
      select count(*) into v_count from public.approval_requests apr
       where apr.employee_id = e.id and apr.status = 'pending'
         and (apr.source_table <> 'leave_requests'
              or exists (select 1 from public.leave_requests lr where lr.id = apr.source_id and lr.start_date <= v_to and lr.end_date >= v_from));
      if v_count > 0 then
        v_exc := v_exc || jsonb_build_object('code', 'pending_requests', 'severity', 'warning',
          'message', v_count || case when v_count = 1 then ' request is' else ' requests are' end || ' still waiting for a decision');
      end if;
    end if;

    -- Salary for the part of the period they were employed, less unpaid leave.
    -- Monthly salaries are shared out over shorter pay periods.
    if v_adhoc then
      v_paid_days := 0;
      v_salary := 0;
      v_hourly := 0;
    elsif coalesce(comp.pay_basis, 'monthly') = 'monthly' then
      v_paid_days := greatest(0, v_employed - v_unpaid * v_days::numeric / greatest(v_workdays, 1));
      v_salary := round(v_basic * v_factor * v_paid_days / v_days, 2);
      v_hourly := v_basic / greatest(round(v_workdays / v_factor) * coalesce(nullif((select full_day_hours from public.attendance_policies where business_id = r.business_id and is_default), 0), 8), 1);
    elsif comp.pay_basis = 'daily' then
      v_paid_days := v_present;
      v_salary := round(v_basic * v_present, 2);
      v_hourly := v_basic / 8;
      if not v_has_att then
        v_exc := v_exc || jsonb_build_object('code', 'daily_no_time', 'message', 'Paid by the day, but Time & shifts is off', 'severity', 'warning');
      end if;
    else
      v_paid_days := v_present;
      v_salary := round(v_basic * v_worked_h, 2);
      v_hourly := v_basic;
    end if;

    insert into public.payroll_run_employees (business_id, run_id, employee_id, employee_code, employee_name, department_name, position_title,
      branch_name, bank_name, bank_account_name, bank_account_number, basic_salary, period_days, paid_days, unpaid_leave_days, absent_days,
      worked_hours, overtime_hours, status)
    values (r.business_id, r.id, e.id, e.employee_code, trim(e.first_name || ' ' || e.last_name),
      (select name from public.departments where id = e.department_id), (select title from public.positions where id = e.position_id),
      (select name from public.branches where id = e.branch_id), v_bank.bank_name, v_bank.account_name, v_bank.account_number,
      v_basic, v_days, round(v_paid_days, 2), case when v_adhoc then 0 else v_unpaid end,
      case when v_adhoc then 0 else (v_vars ->> 'unapproved_absences')::numeric end, round(v_worked_h, 2), round(v_ot_h, 2),
      case when e.id in (select employee_id from _held) then 'on_hold' else 'included' end)
    returning id into v_re;
    v_n := v_n + 1;

    if not v_adhoc then
      -- Earnings ------------------------------------------------------
      v_expl := null;
      if coalesce(comp.pay_basis, 'monthly') = 'monthly' then
        if v_factor <> 1 then
          v_expl := private.pay_money(v_basic, b.currency) || ' a month × ' || private.pay_num(v_factor) || ' for this pay period'
                    || case when round(v_paid_days, 2) < v_days then ' × ' || private.pay_num(v_paid_days) || ' of ' || v_days || ' days paid' else '' end;
        elsif v_salary <> v_basic then
          v_expl := private.pay_money(v_basic, b.currency) || ' × ' || private.pay_num(v_paid_days) || ' of ' || v_days || ' days paid'
                    || case when v_employed < v_days then ' (employed ' || v_employed || ' days)' else '' end
                    || case when v_unpaid > 0 then ', less ' || private.pay_num(v_unpaid) || ' working days of unpaid leave' else '' end;
        end if;
      elsif comp.pay_basis = 'daily' then
        v_expl := private.pay_money(v_basic, b.currency) || ' a day × ' || private.pay_num(v_present) || ' days present';
      else
        v_expl := private.pay_money(v_basic, b.currency) || ' an hour × ' || private.pay_num(v_worked_h) || ' hours worked';
      end if;
      insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort, explanation)
      values (r.business_id, r.id, v_re, e.id, 'BASIC', 'Basic salary', 'earning', round(v_paid_days, 2), v_basic, v_salary, true, true, 'salary', 0, v_expl);

      -- Allowances and deductions: every item that applies to them this period.
      for pc in select * from public.pay_components where business_id = r.business_id and is_active order by kind desc, sort, name loop
        continue when not private.pay_item_applies(pc, e.id, r.period_start, r.period_end);
        select * into res from private.pay_item_result(pc, e.id, r.period_start, r.period_end, v_vars, b.currency);
        v_amount := res.amount;
        v_expl := res.explanation;
        -- Monthly amounts are shared out over shorter pay periods.
        if v_factor <> 1 and pc.method in ('fixed', 'percent', 'prorated') then
          v_amount := round(v_amount * v_factor, 2);
          v_expl := v_expl || '. × ' || private.pay_num(v_factor) || ' for this pay period = ' || private.pay_money(v_amount, b.currency);
        end if;
        continue when coalesce(v_amount, 0) = 0;
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, component_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, pc.id, pc.code, pc.name, pc.kind, v_amount,
                pc.kind = 'earning' and pc.is_taxable, pc.kind = 'earning' and pc.is_pensionable, 'component',
                case when pc.kind = 'earning' then 10 else 75 end + least(pc.sort, 900) / 100, v_expl);
      end loop;

      -- Overtime from time records, at the rate for the kind of day.
      if v_has_att then
        p := private.policy_for(r.business_id, e.id);
        v_ot_cap := coalesce((p.overtime_monthly_cap_hours * 60)::int, 2147483647);
        v_ot_used := 0;
        for ar in select work_date, overtime_minutes, overtime_type from public.attendance_records
                   where employee_id = e.id and work_date between v_from and v_to and overtime_minutes > 0
                     and (ot_decision = 'approved' or not coalesce(p.overtime_requires_approval, false))
                   order by work_date loop
          v_ot_take := least(ar.overtime_minutes, greatest(0, v_ot_cap - v_ot_used));
          v_ot_used := v_ot_used + v_ot_take;
          continue when v_ot_take = 0;
          v_holiday := exists (select 1 from public.public_holidays h where h.business_id = r.business_id and h.holiday_date = ar.work_date and not h.is_optional);
          v_rate := case ar.overtime_type
                      when 'holiday' then coalesce(p.overtime_rate_holiday, 1.5)
                      when 'rest_day' then coalesce(p.overtime_rate_rest_day, 1.5)
                      when 'normal' then coalesce(p.overtime_rate_weekday, 1.25)
                      else case when v_holiday then coalesce(p.overtime_rate_holiday, 1.5)
                         when not (extract(dow from ar.work_date)::smallint = any(b.working_days)) then coalesce(p.overtime_rate_rest_day, 1.5)
                         else coalesce(p.overtime_rate_weekday, 1.25) end end;
          insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, quantity, rate, amount, is_taxable, is_pensionable, source, sort, explanation)
          values (r.business_id, r.id, v_re, e.id, 'OT', 'Overtime ' || to_char(ar.work_date, 'DD Mon') || ' (x' || trim(to_char(v_rate, 'FM0.00')) || ')', 'earning',
                  round(v_ot_take / 60.0, 2), round(v_hourly * v_rate, 4), round(v_ot_take / 60.0 * v_hourly * v_rate, 2), true, false, 'overtime', 50,
                  private.pay_num(round(v_ot_take / 60.0, 2)) || ' hours × ' || private.pay_money(v_hourly, b.currency) || ' an hour × ' || trim(to_char(v_rate, 'FM0.00'))
                  || case ar.overtime_type when 'holiday' then ' (public holiday)' when 'rest_day' then ' (rest day)' else ' (normal day)' end);
        end loop;
      end if;

      -- Approved claims paid through payroll, up to this period (claims stay separate from allowances).
      if v_has_claims then
        for cl in select c.id, c.amount, t.name, c.claim_date from public.claims c join public.claim_types t on t.id = c.claim_type_id
                   where c.employee_id = e.id and c.status = 'approved' and c.payout_method = 'payroll' and c.payroll_run_id is null
                     and coalesce(c.target_period_start, c.claim_date) <= r.period_end loop
          insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, source_id, sort, explanation)
          values (r.business_id, r.id, v_re, e.id, 'CLAIM', cl.name || ' claim ' || to_char(cl.claim_date, 'DD Mon'), 'earning', cl.amount, false, false, 'expense_claim', cl.id, 60,
                  'Approved claim, paid back with pay (not taxed)');
          update public.claims set payroll_run_id = r.id where id = cl.id;
        end loop;
      end if;
    end if;

    -- Amounts added by hand on this run (with their reasons) are kept when recalculating.
    insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort, explanation)
    select r.business_id, r.id, v_re, e.id, m.code, m.name, m.kind, m.amount, m.is_taxable, m.is_pensionable, 'manual', 70, m.explanation
      from _manual m where m.employee_id = e.id;

    select coalesce(sum(amount) filter (where kind = 'earning'), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_taxable), 0),
           coalesce(sum(amount) filter (where kind = 'earning' and is_pensionable), 0)
      into v_gross, v_taxable, v_pensionable
      from public.payroll_run_lines where run_employee_id = v_re;

    -- Deductions ------------------------------------------------------
    if not v_adhoc then
      for ln in select id, installment_amount, outstanding, kind from public.loans
                 where employee_id = e.id and status = 'active' and start_date <= r.period_end and outstanding > 0 loop
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, source_id, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, upper(ln.kind), case when ln.kind = 'advance' then 'Salary advance' else 'Loan repayment' end, 'deduction',
                least(ln.installment_amount, ln.outstanding), 'loan', ln.id, 80,
                'Instalment ' || private.pay_money(ln.installment_amount, b.currency) || ', ' || private.pay_money(ln.outstanding, b.currency) || ' still owed before this');
      end loop;
    end if;

    v_pen_emp := 0; v_employer := 0;
    if pen.id is not null and (pen.applies_to = 'all' or (pen.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := case pen.wage_base when 'basic' then v_salary when 'gross' then v_gross else v_pensionable end;
      if pen.wage_ceiling is not null then v_amount := least(v_amount, round(pen.wage_ceiling * v_factor, 2)); end if;
      v_pen_emp := round(v_amount * pen.employee_rate / 100, 2);
      v_employer := round(v_amount * pen.employer_rate / 100, 2);
      if v_pen_emp > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, 'PENSION', 'Pension (' || trim(to_char(pen.employee_rate, 'FM990.###')) || '%)', 'deduction', pen.employee_rate, v_pen_emp, 'statutory', 90,
                trim(to_char(pen.employee_rate, 'FM990.###')) || '% of ' || private.pay_money(v_amount, b.currency) || ' '
                || case pen.wage_base when 'basic' then 'basic salary' when 'gross' then 'total earnings' else 'pensionable pay' end);
      end if;
      if v_employer > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, rate, amount, source, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, 'PENSION_ER', 'Employer pension (' || trim(to_char(pen.employer_rate, 'FM990.###')) || '%)', 'employer_contribution', pen.employer_rate, v_employer, 'statutory', 95,
                trim(to_char(pen.employer_rate, 'FM990.###')) || '% of ' || private.pay_money(v_amount, b.currency) || ', paid by the company on top');
      end if;
    end if;

    v_tax := 0;
    if tax.id is not null and (tax.applies_to = 'all' or (tax.applies_to = 'locals') = private.is_local(e, b.country)) then
      v_amount := greatest(v_taxable - v_pen_emp, 0);
      -- Worked out on the monthly (or yearly) equivalent, then shared back to this pay period.
      v_tax := case when tax.basis = 'annual' then round(private.tax_for(tax.id, v_amount / v_factor * 12) / 12 * v_factor, 2)
                    else round(private.tax_for(tax.id, v_amount / v_factor) * v_factor, 2) end;
      if v_tax > 0 then
        insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, source, sort, explanation)
        values (r.business_id, r.id, v_re, e.id, 'TAX', 'Income tax', 'deduction', v_tax, 'statutory', 91,
                'On taxable pay of ' || private.pay_money(v_amount, b.currency) || ' after pension, using ' || tax.name
                || case when v_factor <> 1 then ' (worked out on the monthly equivalent)' else '' end);
      end if;
    end if;

    select coalesce(sum(amount), 0) into v_ded from public.payroll_run_lines where run_employee_id = v_re and kind = 'deduction';
    if v_gross - v_ded < 0 then
      v_exc := v_exc || jsonb_build_object('code', 'negative', 'message', 'Deductions are more than pay', 'severity', 'error');
    end if;
    -- A big change from their last regular pay.
    if not v_adhoc then
      select pe.net_pay into v_prev from public.payroll_run_employees pe join public.payroll_runs pr on pr.id = pe.run_id
       where pe.employee_id = e.id and pr.business_id = r.business_id and pr.run_type = 'regular' and pr.status in ('finalized', 'paid')
         and pr.period_end < r.period_start and pr.pay_schedule_id is not distinct from r.pay_schedule_id
       order by pr.period_end desc limit 1;
      if v_prev is not null and v_prev > 0 and abs((v_gross - v_ded) - v_prev) / v_prev > 0.2 then
        v_exc := v_exc || jsonb_build_object('code', 'big_change', 'severity', 'warning',
          'message', 'Net pay is ' || round(abs((v_gross - v_ded) - v_prev) / v_prev * 100) || '% ' || case when v_gross - v_ded > v_prev then 'higher' else 'lower' end
                     || ' than last time (' || private.pay_money(v_prev, b.currency) || ' → ' || private.pay_money(v_gross - v_ded, b.currency) || ')');
      end if;
      v_prev := null;
    end if;
    update public.payroll_run_employees set
      gross_pay = v_gross, taxable_pay = greatest(v_taxable - v_pen_emp, 0), pensionable_pay = v_pensionable,
      total_deductions = v_ded, net_pay = v_gross - v_ded, employer_contributions = v_employer, exceptions = v_exc
    where id = v_re;
  end loop;

  update public.payroll_runs set
    status = 'calculated', calculated_at = now(), calculated_by = auth.uid(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = r.id and status = 'included' and (not v_adhoc or gross_pay <> 0)),
    total_gross = (select coalesce(sum(gross_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_deductions = (select coalesce(sum(total_deductions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_net = (select coalesce(sum(net_pay), 0) from public.payroll_run_employees where run_id = r.id and status = 'included'),
    total_employer_contributions = (select coalesce(sum(employer_contributions), 0) from public.payroll_run_employees where run_id = r.id and status = 'included')
  where id = r.id;
  update public.claims c set payroll_run_id = null
   where c.payroll_run_id = r.id and c.employee_id in (select employee_id from _held);
  return jsonb_build_object('people', v_n);
end $$;

-- ---------------------------------------------------------------------
-- Adjustments by hand: need a reason, kept in the history
-- ---------------------------------------------------------------------
drop function if exists public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean);
create function public.add_payroll_adjustment(
  p_run uuid, p_employee uuid, p_name text, p_kind text, p_amount numeric, p_taxable boolean default true, p_pensionable boolean default false,
  p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  v_re uuid;
  v_id uuid;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is locked (approved or finalized). Undo the approval to change it.' using errcode = '42501';
  end if;
  if p_kind not in ('earning', 'deduction') or coalesce(p_amount, 0) <= 0 or coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name and an amount above zero' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add the reason. It''s kept in the history.' using errcode = '22023';
  end if;
  select id into v_re from public.payroll_run_employees where run_id = p_run and employee_id = p_employee;
  if v_re is null then
    raise exception 'That person isn''t on this pay run' using errcode = '22023';
  end if;
  insert into public.payroll_run_lines (business_id, run_id, run_employee_id, employee_id, code, name, kind, amount, is_taxable, is_pensionable, source, sort, explanation)
  values (r.business_id, p_run, v_re, p_employee, 'ADJ', trim(left(p_name, 80)), p_kind, round(p_amount, 2),
          p_kind = 'earning' and coalesce(p_taxable, true), p_kind = 'earning' and coalesce(p_pensionable, false), 'manual', 70,
          'Added by hand: ' || trim(left(p_reason, 300)))
  returning id into v_id;
  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, resource, subject_employee_id, changes)
  values (r.business_id, auth.uid(), 'adjust', 'payroll_run_lines', v_id, 'payroll', p_employee,
          jsonb_build_object('run', jsonb_build_object('to', r.name), 'name', jsonb_build_object('to', trim(p_name)), 'kind', jsonb_build_object('to', p_kind),
                             'amount', jsonb_build_object('to', round(p_amount, 2)), 'reason', jsonb_build_object('to', trim(p_reason))));
  perform public.calculate_payroll_run(p_run);
end $$;
revoke all on function public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean, text) from public, anon;
grant execute on function public.add_payroll_adjustment(uuid, uuid, text, text, numeric, boolean, boolean, text) to authenticated;

create or replace function public.remove_payroll_adjustment(p_line uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.payroll_run_lines; r public.payroll_runs;
begin
  select * into l from public.payroll_run_lines where id = p_line and source = 'manual';
  select * into r from public.payroll_runs where id = l.run_id;
  if l.id is null or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to change this pay run' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated') then
    raise exception 'This pay run is locked (approved or finalized). Undo the approval to change it.' using errcode = '42501';
  end if;
  delete from public.payroll_run_lines where id = l.id;
  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, resource, subject_employee_id, changes)
  values (r.business_id, auth.uid(), 'remove_adjustment', 'payroll_run_lines', l.id, 'payroll', l.employee_id,
          jsonb_build_object('run', jsonb_build_object('from', r.name), 'name', jsonb_build_object('from', l.name),
                             'amount', jsonb_build_object('from', l.amount), 'reason', jsonb_build_object('from', l.explanation)));
  perform public.calculate_payroll_run(r.id);
end $$;

-- ---------------------------------------------------------------------
-- Approve, undo approval, finalize, reverse
-- ---------------------------------------------------------------------
create or replace function public.approve_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to approve a pay run' using errcode = '42501';
  end if;
  if r.status <> 'calculated' then
    raise exception 'Calculate the pay run before approving it' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_run_employees where run_id = r.id and status = 'included'
              and exceptions @> '[{"severity":"error"}]'::jsonb) then
    raise exception 'Some people have problems to fix first (shown in red), or put them on hold' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = r.id;
end $$;

create or replace function public.unapprove_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to change a pay run''s approval' using errcode = '42501';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only an approved run that isn''t finalized can go back' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'calculated', approved_at = null, approved_by = null where id = r.id;
end $$;

create or replace function public.finalize_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  l record;
  pe record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or r.business_id not in (select private.biz_all('payroll', 'approve')) then
    raise exception 'You need payroll approval rights to finalize a pay run' using errcode = '42501';
  end if;
  if r.status <> 'approved' then
    raise exception 'Approve the pay run before finalizing it' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_run_employees where run_id = r.id and status = 'included'
              and exceptions @> '[{"severity":"error"}]'::jsonb) then
    raise exception 'Some people have problems to fix first (shown in red), or put them on hold' using errcode = '22023';
  end if;
  -- Held people (and, on ad-hoc runs, people with nothing to pay) come off the run.
  delete from public.payroll_run_employees where run_id = r.id and (status <> 'included' or (r.run_type = 'adhoc' and gross_pay = 0 and total_deductions = 0));

  for l in select source_id, amount from public.payroll_run_lines where run_id = r.id and source = 'loan' loop
    insert into public.loan_repayments (business_id, loan_id, run_id, amount, paid_on, method)
    values (r.business_id, l.source_id, r.id, l.amount, r.pay_date, 'payroll');
    update public.loans set outstanding = greatest(outstanding - l.amount, 0),
                            status = case when outstanding - l.amount <= 0 then 'completed' else status end
     where id = l.source_id;
  end loop;
  update public.claims set status = 'paid', paid_at = now(), paid_reference = r.name
   where payroll_run_id = r.id and status = 'approved';
  if r.run_type = 'regular' then
    update public.timesheets set payroll_run_id = r.id
     where business_id = r.business_id and status = 'approved' and period_start >= r.period_start and period_end <= r.period_end;
    update public.leave_requests set payroll_run_id = r.id
     where business_id = r.business_id and status = 'approved' and start_date <= r.period_end and end_date >= r.period_start
       and leave_type_id in (select id from public.leave_types where business_id = r.business_id and not is_paid);
  end if;

  update public.payroll_runs set status = 'finalized', finalized_at = now(), finalized_by = auth.uid(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = r.id)
   where id = r.id;
  update public.payroll_run_employees set payslip_published_at = now() where run_id = r.id;
  for pe in select employee_id from public.payroll_run_employees where run_id = r.id loop
    perform private.notify(r.business_id, private.user_for_employee(r.business_id, pe.employee_id), 'payroll.payslip_ready',
      'Your payslip for ' || r.name || ' is here', null, '/staff/pay', 'payroll');
  end loop;
end $$;

-- Only the owner can undo a finalized run, and must say why.
create or replace function public.reverse_payroll_run(p_run uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs;
  l record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if not found or not private.is_owner(r.business_id) then
    raise exception 'Only the owner can reverse a finalized pay run' using errcode = '42501';
  end if;
  if r.status not in ('finalized', 'paid') then
    raise exception 'Only a finalized or paid run can be reversed. Delete a draft instead.' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add the reason for reversing' using errcode = '22023';
  end if;
  for l in select loan_id, amount from public.loan_repayments where run_id = r.id loop
    update public.loans set outstanding = least(outstanding + l.amount, principal), status = 'active' where id = l.loan_id;
  end loop;
  delete from public.loan_repayments where run_id = r.id;
  update public.claims set status = 'approved', paid_at = null, paid_reference = null, payroll_run_id = null where payroll_run_id = r.id;
  update public.timesheets set payroll_run_id = null where payroll_run_id = r.id;
  update public.leave_requests set payroll_run_id = null where payroll_run_id = r.id;
  update public.payroll_runs set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason) where id = r.id;
end $$;

create or replace function public.delete_payroll_run(p_run uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'delete')) then
    raise exception 'You don''t have permission to delete pay runs' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'calculated', 'approved') then
    raise exception 'Finalized pay runs can''t be deleted; reverse them instead' using errcode = '22023';
  end if;
  update public.claims set payroll_run_id = null where payroll_run_id = r.id;
  delete from public.payroll_runs where id = r.id;
end $$;

-- Recorded when payslips are emailed from the pay run.
create or replace function public.mark_payslips_emailed(p_run uuid, p_employees uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found or r.business_id not in (select private.biz_all('payroll', 'edit')) then
    raise exception 'You don''t have permission to send payslips' using errcode = '42501';
  end if;
  update public.payroll_run_employees set payslip_emailed_at = now() where run_id = p_run and employee_id = any(p_employees);
  update public.payroll_runs set payslips_emailed_at = now() where id = p_run;
end $$;

revoke all on function public.approve_payroll_run(uuid) from public, anon;
revoke all on function public.unapprove_payroll_run(uuid) from public, anon;
revoke all on function public.mark_payslips_emailed(uuid, uuid[]) from public, anon;
grant execute on function public.approve_payroll_run(uuid) to authenticated;
grant execute on function public.unapprove_payroll_run(uuid) to authenticated;
grant execute on function public.mark_payslips_emailed(uuid, uuid[]) to authenticated;

call private.finalize_tenant_tables();
insert into private.schema_migrations (name) values ('20261003000001_payroll_runs.sql') on conflict do nothing;

-- ===================== 20261003000002_payslips_emailed.sql =====================
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
insert into private.schema_migrations (name) values ('20261003000002_payslips_emailed.sql') on conflict do nothing;
