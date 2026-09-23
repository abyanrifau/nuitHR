-- =====================================================================
-- 0036 Formula explanations show the numbers they used, for example
--   "... = MVR 1,557.69 (basic_salary MVR 13,500.00, working_days 26,
--   unapproved_absences 3)".
-- =====================================================================
-- Every variable a formula uses, in the order they first appear.
create or replace function private.pay_ast_vars(n jsonb)
returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_child text;
  i int;
begin
  if n is null or jsonb_typeof(n) <> 'array' then return v_out; end if;
  if n ->> 0 = 'var' then return array[n ->> 1]; end if;
  if n ->> 0 = 'num' then return v_out; end if;
  for i in 1 .. jsonb_array_length(n) - 1 loop
    foreach v_child in array private.pay_ast_vars(n -> i) loop
      if not (v_child = any(v_out)) then v_out := v_out || v_child; end if;
    end loop;
  end loop;
  return v_out;
end $$;

-- " (basic_salary MVR 13,500.00, working_days 26)"
create or replace function private.pay_formula_values(n jsonb, v jsonb, p_currency text)
returns text
language sql immutable set search_path = '' as $$
  select coalesce(' (' || string_agg(k || ' ' || case when k in ('basic_salary', 'amount') then private.pay_money((v ->> k)::numeric, p_currency)
                                                   else private.pay_num((v ->> k)::numeric) end, ', ' order by ord) || ')', '')
    from unnest(private.pay_ast_vars(n)) with ordinality as t(k, ord)
$$;

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
      v_expl := c.formula || ' = ' || private.pay_money(r, p_currency) || private.pay_formula_values(c.formula_ast, v_vars, p_currency);
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
    v_expl := v_expl || '. Rule formula ' || c.rules_formula || ' gives ' || private.pay_money(greatest(v_out, 0), p_currency)
              || private.pay_formula_values(c.rules_ast, p_vars || jsonb_build_object('amount', r), p_currency);
  end if;

  amount := round(greatest(coalesce(v_out, 0), 0), 2);
  explanation := v_expl;
  return next;
end $$;

call private.finalize_tenant_tables();
