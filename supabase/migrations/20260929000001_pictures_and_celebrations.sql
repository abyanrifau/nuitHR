-- =====================================================================
-- 0024 PICTURES AND CELEBRATIONS
--   1. Profile pictures: a storage bucket for small square pictures
--      (uploaded by the app's server after checking permission; each
--      file has a random name).
--   2. Celebrations on Home: birthdays this week (day and month only,
--      never the year), work anniversaries and new joiners, visible to
--      everyone in the company. Staff can hide their birthday; admins
--      can switch the card off.
--   3. The request inbox also returns the person's picture.
-- =====================================================================

-- 1. Pictures ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- 2. Celebrations --------------------------------------------------------
alter table public.employees add column if not exists hide_birthday boolean not null default false;
alter table public.businesses add column if not exists celebrations_enabled boolean not null default true;

-- Everyone in the company sees these, so this returns only names, pictures,
-- the day and month of birthdays (never the year or full date of birth),
-- the number of years for anniversaries, and join dates of new joiners.
create or replace function public.celebrations(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_on boolean;
begin
  if p_business is null or p_business not in (select private.my_business_ids()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select b.celebrations_enabled, private.biz_today(b.id) into v_on, v_today from public.businesses b where b.id = p_business;
  if not coalesce(v_on, false) then
    return jsonb_build_object('enabled', false);
  end if;

  return jsonb_build_object(
    'enabled', true,
    'birthdays', coalesce((
      select jsonb_agg(x order by x ->> 'on') from (
        select jsonb_build_object(
                 'employee_id', e.id,
                 'name', trim(coalesce(nullif(e.preferred_name, ''), e.first_name) || ' ' || e.last_name),
                 'photo_path', e.photo_path,
                 'day', extract(day from e.date_of_birth)::int,
                 'month', extract(month from e.date_of_birth)::int,
                 'on', d.day) as x
          from public.employees e
          cross join lateral (
            select g::date as day from generate_series(v_today, v_today + 6, interval '1 day') g
             where extract(month from g) = extract(month from e.date_of_birth)
               and (extract(day from g) = extract(day from e.date_of_birth)
                    -- 29 February birthdays are celebrated on 28 February in other years
                    or (extract(month from e.date_of_birth) = 2 and extract(day from e.date_of_birth) = 29
                        and extract(day from g) = 28
                        and extract(day from (make_date(extract(year from g)::int, 3, 1) - 1)) = 28))
             limit 1) d
         where e.business_id = p_business
           and e.status in ('active', 'probation', 'on_leave')
           and e.date_of_birth is not null
           and not e.hide_birthday) t), '[]'::jsonb),
    'anniversaries', coalesce((
      select jsonb_agg(x order by x ->> 'on') from (
        select jsonb_build_object(
                 'employee_id', e.id,
                 'name', trim(coalesce(nullif(e.preferred_name, ''), e.first_name) || ' ' || e.last_name),
                 'photo_path', e.photo_path,
                 'years', extract(year from d.day)::int - extract(year from e.join_date)::int,
                 'on', d.day) as x
          from public.employees e
          cross join lateral (
            select g::date as day from generate_series(v_today, v_today + 6, interval '1 day') g
             where extract(month from g) = extract(month from e.join_date)
               and extract(day from g) = extract(day from e.join_date)
             limit 1) d
         where e.business_id = p_business
           and e.status in ('active', 'probation', 'on_leave')
           and e.join_date is not null
           and extract(year from d.day) > extract(year from e.join_date)) t), '[]'::jsonb),
    'joiners', coalesce((
      select jsonb_agg(x order by x ->> 'join_date' desc) from (
        select jsonb_build_object(
                 'employee_id', e.id,
                 'name', trim(coalesce(nullif(e.preferred_name, ''), e.first_name) || ' ' || e.last_name),
                 'photo_path', e.photo_path,
                 'join_date', e.join_date,
                 'position', p.title) as x
          from public.employees e
          left join public.positions p on p.business_id = e.business_id and p.id = e.position_id
         where e.business_id = p_business
           and e.status in ('active', 'probation', 'on_leave')
           and e.join_date between v_today - 14 and v_today) t), '[]'::jsonb)
  );
end $$;
revoke all on function public.celebrations(uuid) from public, anon;
grant execute on function public.celebrations(uuid) to authenticated;

-- Staff choose whether their birthday is shown to colleagues.
create or replace function public.set_my_birthday_hidden(p_business uuid, p_hidden boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid;
begin
  select m.employee_id into v_emp from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active';
  if v_emp is null then
    raise exception 'Your login isn''t linked to a staff profile yet. Ask HR to link it.' using errcode = '42501';
  end if;
  update public.employees set hide_birthday = coalesce(p_hidden, false) where id = v_emp and business_id = p_business;
end $$;
revoke all on function public.set_my_birthday_hidden(uuid, boolean) from public, anon;
grant execute on function public.set_my_birthday_hidden(uuid, boolean) to authenticated;

-- Your own picture on your own staff profile. Only a file in your own
-- folder (stored by the app's server after checking it) can be used.
create or replace function public.set_my_photo(p_business uuid, p_path text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid;
begin
  if p_path is not null and p_path !~ ('^users/' || auth.uid()::text || '/[0-9a-f-]{36}\.(webp|jpg|png)$') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select m.employee_id into v_emp from public.business_members m
   where m.business_id = p_business and m.user_id = auth.uid() and m.status = 'active';
  if v_emp is null then return; end if;
  update public.employees set photo_path = p_path where id = v_emp and business_id = p_business;
end $$;
revoke all on function public.set_my_photo(uuid, text) from public, anon;
grant execute on function public.set_my_photo(uuid, text) to authenticated;

-- 3. Request inbox with the person's picture ---------------------------------
drop function if exists public.my_request_inbox(uuid);
create function public.my_request_inbox(p_business uuid)
returns table (
  id uuid, request_type text, module_key text, title text, summary text, amount numeric, submitted_at timestamptz,
  employee_id uuid, employee_name text, requested_by_name text, step_order smallint, total_steps int, via text,
  employee_photo text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.request_type, r.module_key, r.title, r.summary, r.amount, r.submitted_at,
         r.employee_id, trim(e.first_name || ' ' || e.last_name), p.full_name, s.step_order,
         (select count(*)::int from public.approval_request_steps x where x.request_id = r.id),
         case when s.approver_user_id = auth.uid() then 'you'
              when s.approver_role_id is not null then 'role'
              when s.approver_user_id is not null and s.approver_user_id <> auth.uid()
                   and exists (select 1 from public.approval_delegations d where d.delegate_user_id = auth.uid()
                                and d.delegator_user_id = s.approver_user_id and d.revoked_at is null
                                and now() between d.starts_at and d.ends_at) then 'stand-in'
              else 'admin' end,
         coalesce(e.photo_path, p.avatar_path)
    from public.approval_requests r
    join public.approval_request_steps s on s.request_id = r.id and s.status = 'pending'
    left join public.employees e on e.id = r.employee_id
    left join public.profiles p on p.id = r.requested_by
   where r.business_id = p_business and r.status = 'pending'
     and p_business in (select private.my_business_ids())
     and (r.requested_by is distinct from auth.uid() or private.is_owner(p_business))
     and private.is_assigned(r, s)
   order by r.submitted_at
$$;
revoke all on function public.my_request_inbox(uuid) from public, anon;
grant execute on function public.my_request_inbox(uuid) to authenticated;

call private.finalize_tenant_tables();
