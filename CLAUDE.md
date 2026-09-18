@AGENTS.md

# Project notes
- Multi-tenant HR SaaS. Brand/prices/rates: `src/config/app.config.ts`. Module registry: `src/modules/registry.ts` (single source of truth for wizard, nav, portal, permissions).
- Tenant isolation: every business table has `business_id`, `unique (business_id, id)`, composite FKs, and RLS via `private.std_rls(...)`; each migration ends with `call private.finalize_tenant_tables();` (fails if any table lacks RLS).
- Permissions: `role_permissions(resource, action, scope all|team|own)`; SQL helpers `private.biz_all/biz_with/emp_scope/self_scope/team_scope`. Salary resources (compensation, payroll, payslips, roles) are owner-grant-only.
- Guards run as security invoker and use `private.is_client_context()` (current_user = authenticated/anon) to tell user requests from trusted definer functions.
- Tests: `npm test` runs migrations in PGlite (tests/db/harness.ts stubs Supabase auth/storage). No Docker.
- User is non-technical: explain setup steps in plain language; build in phases and stop after each.
