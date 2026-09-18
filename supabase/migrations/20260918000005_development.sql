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
