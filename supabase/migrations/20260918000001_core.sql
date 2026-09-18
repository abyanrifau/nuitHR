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
