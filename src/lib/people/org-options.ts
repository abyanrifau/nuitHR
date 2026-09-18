import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Dropdown choices for locations, departments, job titles and managers. */
export async function loadOrgOptions(supabase: SupabaseClient, businessId: string, excludeEmployee?: string) {
  const [{ data: branches }, { data: departments }, { data: positions }, { data: people }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("business_id", businessId).eq("is_active", true).order("name"),
    supabase.from("departments").select("id, name").eq("business_id", businessId).eq("is_active", true).order("name"),
    supabase.from("positions").select("id, title, department:departments(name)").eq("business_id", businessId).eq("is_active", true).order("title"),
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("business_id", businessId)
      .in("status", ["active", "probation", "on_leave", "suspended"])
      .order("first_name")
      .limit(2000),
  ]);
  return {
    branches: (branches ?? []).map((b) => ({ value: b.id, label: b.name })),
    departments: (departments ?? []).map((d) => ({ value: d.id, label: d.name })),
    positions: (positions ?? []).map((p) => {
      const dept = (p.department as unknown as { name: string } | null)?.name;
      return { value: p.id, label: dept ? `${p.title} (${dept})` : p.title };
    }),
    managers: (people ?? [])
      .filter((p) => p.id !== excludeEmployee)
      .map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() + ` · ${p.employee_code}` })),
  };
}
