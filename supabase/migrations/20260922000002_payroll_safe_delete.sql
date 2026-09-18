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
