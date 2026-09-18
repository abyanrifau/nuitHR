import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoalRow } from "@/components/reviews/goals";
import type { BusinessAccess } from "@/lib/auth/session";
import { toAccessContext } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/access";

/**
 * Goals the signed-in person can see (the database filters them), with
 * whether each can be edited or deleted. The buttons follow the same rules
 * the database uses: company and department goals need company-wide rights;
 * personal goals follow own/team rights.
 */
export async function loadGoals(supabase: SupabaseClient, active: BusinessAccess, filter: { employeeId?: string; level?: string } = {}): Promise<GoalRow[]> {
  const ctx = toAccessContext(active);
  let q = supabase
    .from("goals")
    .select(
      "id, level, title, description, metric, target_value, current_value, progress_percent, status, due_date, department_id, employee_id, employee:employees!goals_business_id_employee_id_fkey(first_name, last_name), department:departments(name)",
    )
    .eq("business_id", active.business_id)
    .order("level")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(500);
  if (filter.level) q = q.eq("level", filter.level);
  if (filter.employeeId) q = q.or(`employee_id.eq.${filter.employeeId},level.neq.individual`);
  const { data } = await q;
  const allEdit = can(ctx, "goals", "edit", "all");
  const teamEdit = can(ctx, "goals", "edit", "team");
  const ownEdit = can(ctx, "goals", "edit", "own");
  const allDelete = can(ctx, "goals", "delete", "all");
  const teamDelete = can(ctx, "goals", "delete", "team");
  const me = active.employee_id;
  return (data ?? []).map((g) => {
    const e = g.employee as unknown as { first_name: string; last_name: string } | null;
    const d = g.department as unknown as { name: string } | null;
    const personal = g.level === "individual";
    const mine = personal && g.employee_id === me;
    return {
      id: g.id,
      level: g.level as GoalRow["level"],
      title: g.title,
      description: g.description,
      metric: g.metric,
      target_value: g.target_value === null ? null : Number(g.target_value),
      current_value: g.current_value === null ? null : Number(g.current_value),
      progress_percent: g.progress_percent,
      status: g.status,
      due_date: g.due_date,
      due_label: g.due_date ? formatDate(g.due_date, active.date_format) : null,
      department_id: g.department_id,
      employee_id: g.employee_id,
      owner: g.level === "company" ? "Company" : g.level === "department" ? (d?.name ?? "Department") : mine ? "You" : e ? `${e.first_name} ${e.last_name}`.trim() : "Someone",
      canEdit: allEdit || (personal && (teamEdit || (ownEdit && mine))),
      canDelete: allDelete || (personal && teamDelete && !mine),
    };
  });
}
