-- =====================================================================
-- 0022 ADMIN: the list of logins (accounts), for the admin area.
--   Server key only. Shows which companies each login belongs to, so a
--   test account can be found and removed.
-- =====================================================================
create or replace function public.admin_accounts()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_request() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'name', p.full_name,
        'phone', p.phone,
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'confirmed', u.email_confirmed_at is not null,
        'is_platform_admin', exists (select 1 from public.platform_admins pa where pa.user_id = u.id),
        'memberships', coalesce((
          select jsonb_agg(jsonb_build_object('business_id', b.id, 'business_name', b.name, 'role', r.name, 'is_owner', r.is_owner, 'status', m.status)
                   order by b.name)
            from public.business_members m
            join public.businesses b on b.id = m.business_id
            join public.roles r on r.id = m.role_id
           where m.user_id = u.id), '[]'::jsonb)
      ) as x
      from auth.users u
      left join public.profiles p on p.id = u.id
    ) t
  );
end $$;
revoke all on function public.admin_accounts() from public, anon, authenticated;
grant execute on function public.admin_accounts() to service_role;

call private.finalize_tenant_tables();
