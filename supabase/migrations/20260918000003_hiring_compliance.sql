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
