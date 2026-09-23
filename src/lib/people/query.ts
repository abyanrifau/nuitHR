import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PAGE_SIZE = 50;

export interface PeopleFilters {
  q?: string;
  status?: string;
  department?: string;
  branch?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

const SORTS: Record<string, string> = { name: "first_name", code: "employee_code", joined: "join_date", status: "status" };

/** Strips characters that have meaning in the database filter syntax. */
function cleanSearch(q: string) {
  return q.replace(/[%,()*\\:."']/g, " ").trim().slice(0, 60);
}

/** One place for the people list filters, used by the page and the CSV export. */
export function peopleQuery(supabase: SupabaseClient, businessId: string, f: PeopleFilters, select: string, opts: { count?: boolean } = {}) {
  let q = supabase
    .from("employees")
    .select(select, opts.count ? { count: "exact" } : undefined)
    .eq("business_id", businessId);
  const term = f.q ? cleanSearch(f.q) : "";
  for (const w of term.split(/\s+/).filter(Boolean)) {
    q = q.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,preferred_name.ilike.%${w}%,employee_code.ilike.%${w}%,work_email.ilike.%${w}%`);
  }
  if (f.status === "current" || !f.status) q = q.in("status", ["active", "probation", "on_leave", "suspended"]);
  else if (f.status === "left") q = q.in("status", ["resigned", "terminated"]);
  else if (f.status !== "all") q = q.eq("status", f.status);
  if (f.department) q = q.eq("department_id", f.department);
  if (f.branch) q = q.eq("branch_id", f.branch);
  const col = SORTS[f.sort ?? "name"] ?? "first_name";
  q = q.order(col, { ascending: f.dir !== "desc", nullsFirst: false });
  if (col === "first_name") q = q.order("last_name", { ascending: f.dir !== "desc" });
  return q;
}
