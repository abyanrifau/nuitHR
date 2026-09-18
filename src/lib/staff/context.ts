import "server-only";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** Everything a staff app page needs: who you are, your company, and your own staff profile (if linked). */
export async function getStaffContext() {
  const [user, active] = await Promise.all([getSessionUser(), getActiveBusiness()]);
  const supabase = await createClient();
  const { data: me } = active!.employee_id
    ? await supabase
        .from("employees")
        .select("id, branch_id, department_id, first_name, last_name, preferred_name, employee_code, status, phone, personal_email, work_email, current_address, permanent_address, join_date, position:positions(title), department:departments!employees_business_id_department_id_fkey(name), branch:branches(name)")
        .eq("id", active!.employee_id)
        .maybeSingle()
    : { data: null };
  return { user: user!, active: active!, ctx: toAccessContext(active!), me, supabase };
}

export type StaffMe = NonNullable<Awaited<ReturnType<typeof getStaffContext>>["me"]>;
