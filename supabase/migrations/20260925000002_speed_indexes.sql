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
