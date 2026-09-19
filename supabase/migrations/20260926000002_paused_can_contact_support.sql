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
