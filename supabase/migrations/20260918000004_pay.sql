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
