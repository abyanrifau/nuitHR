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
