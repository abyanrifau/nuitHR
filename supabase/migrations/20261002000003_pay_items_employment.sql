-- =====================================================================
-- 0035 Pay items: nobody gets an item for a period they didn't work for
--   the company at all (the test panel says so), and "per occurrence"
--   explanations read plainly when nothing is charged.
-- =====================================================================
create or replace function private.pay_item_applies(c public.pay_components, p_employee uuid, p_start date, p_end date, p_targets jsonb default null)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
begin
  if not c.is_active or (c.effective_from is not null and c.effective_from > p_end) or (c.effective_to is not null and c.effective_to < p_start) then
    return false;
  end if;
  -- Nobody gets anything for a period they didn't work for us at all.
  select * into e from public.employees where id = p_employee;
  if (e.join_date is not null and e.join_date > p_end) or (e.exit_date is not null and e.exit_date < p_start) then
    return false;
  end if;
  if c.applies_to = 'all' then return true; end if;
  if c.id is not null and exists (select 1 from public.employee_pay_components o where o.component_id = c.id and o.employee_id = p_employee
                                    and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)) then
    return true;
  end if;
  if p_targets is not null then
    return exists (select 1 from jsonb_array_elements(p_targets) t
                    where (t ->> 'target_type' = 'employee' and (t ->> 'target_id')::uuid = e.id)
                       or (t ->> 'target_type' = 'department' and (t ->> 'target_id')::uuid = e.department_id)
                       or (t ->> 'target_type' = 'position' and (t ->> 'target_id')::uuid = e.position_id)
                       or (t ->> 'target_type' = 'branch' and (t ->> 'target_id')::uuid = e.branch_id));
  end if;
  return exists (select 1 from public.pay_component_targets t where t.component_id = c.id and (
                   (t.target_type = 'employee' and t.target_id = e.id) or (t.target_type = 'department' and t.target_id = e.department_id)
                   or (t.target_type = 'position' and t.target_id = e.position_id) or (t.target_type = 'branch' and t.target_id = e.branch_id)));
end $$;

create or replace function private.pay_item_result(c public.pay_components, p_employee uuid, p_start date, p_end date, p_vars jsonb, p_currency text)
returns table (amount numeric, explanation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  ov record;
  v_amount numeric;
  v_pct numeric;
  v_basis numeric;
  v_count numeric;
  v_n numeric;
  r numeric;
  v_out numeric;
  v_expl text;
  v_rule jsonb;
  v_vars jsonb;
  v_unit text;
  m text;
begin
  select o.amount, o.percent into ov from public.employee_pay_components o
   where o.component_id = c.id and o.employee_id = p_employee and o.start_date <= p_end and (o.end_date is null or o.end_date >= p_start)
   order by o.start_date desc limit 1;
  v_amount := coalesce(ov.amount, c.default_amount, 0);
  v_pct := coalesce(ov.percent, c.default_percent, 0);
  v_vars := p_vars || jsonb_build_object('amount', v_amount);

  case c.method
    when 'fixed' then
      r := v_amount;
      v_expl := private.pay_money(v_amount, p_currency) || ' a month';
    when 'per_day' then
      r := v_amount * (p_vars ->> 'days_present')::numeric;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num((p_vars ->> 'days_present')::numeric) || ' days present = ' || private.pay_money(r, p_currency);
    when 'prorated' then
      if c.prorate_basis = 'working' then
        v_basis := (p_vars ->> 'working_days')::numeric;
        v_count := (p_vars ->> 'days_present')::numeric;
        v_unit := ' working days';
      else
        -- Calendar days: every day they were employed counts, less the days they should have been at work and weren't.
        v_basis := (p_vars ->> 'days_in_month')::numeric;
        v_count := greatest(0, (p_vars ->> '_days_employed')::numeric - (p_vars ->> 'unapproved_absences')::numeric
                               - (p_vars ->> 'unpaid_leave_days')::numeric - 0.5 * (p_vars ->> 'half_days')::numeric);
        v_unit := ' days in the month';
      end if;
      r := case when v_basis > 0 then v_amount * v_count / v_basis else 0 end;
      v_expl := private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_count) || ' of ' || private.pay_num(v_basis) || v_unit
                || ' = ' || private.pay_money(r, p_currency);
    when 'percent' then
      r := (p_vars ->> 'basic_salary')::numeric * v_pct / 100;
      v_expl := private.pay_num(v_pct) || '% of basic salary ' || private.pay_money((p_vars ->> 'basic_salary')::numeric, p_currency)
                || ' = ' || private.pay_money(r, p_currency);
    when 'per_occurrence' then
      v_count := coalesce((p_vars ->> c.occurrence_var)::numeric, 0);
      v_n := greatest(0, v_count - c.occurrence_after);
      r := v_amount * v_n;
      v_unit := case c.occurrence_var
                  when 'late_count' then case when v_count = 1 then 'late' else 'lates' end
                  when 'early_leaves' then case when v_count = 1 then 'early leave' else 'early leaves' end
                  when 'unapproved_absences' then case when v_count = 1 then 'unapproved absence' else 'unapproved absences' end
                  when 'half_days' then case when v_count = 1 then 'half day' else 'half days' end
                  else replace(c.occurrence_var, '_', ' ') end;
      v_expl := private.pay_num(v_count) || ' ' || v_unit
                || case when v_n = 0 and c.occurrence_after > 0 then ', within the first ' || c.occurrence_after || ' that are free, so nothing is '
                                                                     || case when c.kind = 'deduction' then 'taken off' else 'paid' end
                        when v_n = 0 then ', so nothing is ' || case when c.kind = 'deduction' then 'taken off' else 'paid' end
                        else case when c.occurrence_after > 0 then ', the first ' || c.occurrence_after || ' free, so ' || private.pay_num(v_n) || ' counted' else '' end
                             || ': ' || private.pay_money(v_amount, p_currency) || ' × ' || private.pay_num(v_n) || ' = ' || private.pay_money(r, p_currency) end;
    else
      r := private.pay_eval(c.formula_ast, v_vars);
      v_expl := c.formula || ' = ' || private.pay_money(r, p_currency);
  end case;
  r := round(greatest(coalesce(r, 0), 0), 2);
  v_out := r;

  if c.rules_mode = 'builder' and jsonb_array_length(c.rules) > 0 then
    v_vars := p_vars || jsonb_build_object('amount', r);
    select x into v_rule from jsonb_array_elements(c.rules) with ordinality t(x, i)
     where private.pay_rule_matches(x, v_vars) order by i limit 1;
    if v_rule is null then
      v_expl := v_expl || '. No rule matched, so it''s paid in full';
    else
      m := v_rule #>> '{outcome,type}';
      v_out := case m
        when 'percent' then r * (v_rule #>> '{outcome,value}')::numeric / 100
        when 'nothing' then 0
        when 'subtract' then greatest(r - (v_rule #>> '{outcome,value}')::numeric, 0)
        when 'fixed' then (v_rule #>> '{outcome,value}')::numeric
        else r end;
      v_expl := v_expl || '. Rule ''' || coalesce(nullif(v_rule ->> 'label', ''), 'rule') || ''' applied: ' || case m
        when 'percent' then private.pay_num((v_rule #>> '{outcome,value}')::numeric) || '% = ' || private.pay_money(v_out, p_currency)
        when 'nothing' then 'nothing paid'
        when 'subtract' then private.pay_money(r, p_currency) || ' − ' || private.pay_money((v_rule #>> '{outcome,value}')::numeric, p_currency) || ' = ' || private.pay_money(v_out, p_currency)
        when 'fixed' then 'set to ' || private.pay_money(v_out, p_currency)
        else 'paid in full' end;
    end if;
  elsif c.rules_mode = 'formula' and c.rules_ast is not null then
    v_out := private.pay_eval(c.rules_ast, p_vars || jsonb_build_object('amount', r));
    v_expl := v_expl || '. Rule formula ' || c.rules_formula || ' gives ' || private.pay_money(greatest(v_out, 0), p_currency);
  end if;

  amount := round(greatest(coalesce(v_out, 0), 0), 2);
  explanation := v_expl;
  return next;
end $$;

create or replace function public.pay_items_preview(p_business uuid, p_employee uuid, p_month date, p_draft jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_vars jsonb;
  v_currency text;
  c public.pay_components;
  v_draft public.pay_components;
  v_items jsonb := '[]'::jsonb;
  v_amt numeric;
  v_ex text;
  v_applies boolean;
  v_targets jsonb;
begin
  if p_business not in (select private.biz_all('payroll', 'view')) or not private.can_emp('compensation', 'view', p_business, p_employee) then
    raise exception 'You don''t have permission to see this person''s pay' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee and business_id = p_business) then
    raise exception 'Choose a person' using errcode = '22023';
  end if;
  select currency into v_currency from public.businesses where id = p_business;
  v_vars := private.pay_vars(p_business, p_employee, v_start, v_end);

  if p_draft is not null then
    select * into v_draft from public.pay_components where id = (p_draft ->> 'id')::uuid and business_id = p_business;
    v_draft := jsonb_populate_record(coalesce(v_draft, null::public.pay_components), (p_draft - 'targets') || jsonb_build_object('business_id', p_business));
    v_draft.is_active := true;
    perform private.pay_item_check(v_draft);
  end if;

  for c in select * from public.pay_components pc where pc.business_id = p_business and pc.is_active
            and (v_draft.id is null or pc.id <> v_draft.id)
           union all select v_draft.* where p_draft is not null
           order by kind desc, sort, name loop
    v_targets := case when p_draft is not null and c.id is not distinct from v_draft.id then p_draft -> 'targets' end;
    v_applies := private.pay_item_applies(c, p_employee, v_start, v_end, v_targets);
    v_amt := null;
    v_ex := null;
    if v_applies then
      select x.amount, x.explanation into v_amt, v_ex from private.pay_item_result(c, p_employee, v_start, v_end, v_vars, v_currency) x;
    end if;
    v_items := v_items || jsonb_build_object(
      'id', c.id, 'name', c.name, 'kind', c.kind, 'draft', p_draft is not null and c.id is not distinct from v_draft.id,
      'applies', v_applies,
      'why_not', case when v_applies then null
                      when exists (select 1 from public.employees x where x.id = p_employee
                                    and ((x.join_date is not null and x.join_date > v_end) or (x.exit_date is not null and x.exit_date < v_start))) then 'Not working for you that month'
                      when (c.effective_from is not null and c.effective_from > v_end) or (c.effective_to is not null and c.effective_to < v_start) then 'Not in effect that month'
                      else 'Not for this person' end,
      'amount', v_amt, 'explanation', v_ex);
  end loop;
  return jsonb_build_object('vars', v_vars, 'currency', v_currency, 'start', v_start, 'end', v_end, 'items', v_items);
end $$;
revoke all on function public.pay_items_preview(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.pay_items_preview(uuid, uuid, date, jsonb) to authenticated;
revoke all on function public.pay_items_preview(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.pay_items_preview(uuid, uuid, date, jsonb) to authenticated;

call private.finalize_tenant_tables();
