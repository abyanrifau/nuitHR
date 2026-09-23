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
