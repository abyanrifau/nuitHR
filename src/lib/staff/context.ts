import "server-only";
import { cache } from "react";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Everything a staff app page needs: who you are, your company, and which
 * staff profile your login is linked to (`me.id`, or null if it isn't).
 * Returns without a database trip of its own, so pages can start their
 * queries straight away; pages that show profile details also call
 * getStaffProfile() alongside their other queries.
 */
export const getStaffContext = cache(async () => {
  const [user, active] = await Promise.all([getSessionUser(), getActiveBusiness()]);
  const supabase = await createClient();
  const me = active!.employee_id ? { id: active!.employee_id } : null;
  return { user: user!, active: active!, ctx: toAccessContext(active!), me, supabase };
});

/** The signed-in person's own staff profile, with position, team and location names. */
export const getStaffProfile = cache(async () => {
  const { active, supabase } = await getStaffContext();
  if (!active.employee_id) return null;
  const { data } = await supabase
    .from("employees")
    .select("id, branch_id, department_id, first_name, last_name, preferred_name, employee_code, status, phone, personal_email, work_email, current_address, permanent_address, join_date, position:positions(title), department:departments!employees_business_id_department_id_fkey(name), branch:branches(name)")
    .eq("id", active.employee_id)
    .maybeSingle();
  return data;
});

export type StaffMe = NonNullable<Awaited<ReturnType<typeof getStaffProfile>>>;
