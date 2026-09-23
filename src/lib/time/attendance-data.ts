import "server-only";
import type { BusinessAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceDay, AttendanceMonth } from "./day-status";

export interface RegisterPerson {
  id: string;
  name: string;
  code: string;
  photo_path: string | null;
  branch: string | null;
  department: string | null;
}

/**
 * A month of attendance: each person's days (with one status each) and
 * their stored monthly summary, brought up to date first. The database only
 * returns the people the viewer may see.
 */
export async function loadAttendanceMonth(
  active: BusinessAccess,
  range: { start: string; end: string },
  opts: { employeeId?: string; branch?: string; department?: string } = {},
) {
  const supabase = await createClient();
  let people = supabase
    .from("employees")
    .select("id, first_name, last_name, preferred_name, employee_code, photo_path, branch:branches(name), department:departments!employees_business_id_department_id_fkey(name), branch_id, department_id")
    .eq("business_id", active.business_id)
    .order("first_name");
  if (opts.employeeId) people = people.eq("id", opts.employeeId);
  if (opts.branch) people = people.eq("branch_id", opts.branch);
  if (opts.department) people = people.eq("department_id", opts.department);

  const [months, { data: days, error }, { data: emps }] = await Promise.all([
    // Summaries are refreshed, then read (locked months stay as they were).
    supabase.rpc("refresh_attendance_month", { p_business: active.business_id, p_month: range.start, p_employee: opts.employeeId ?? null }).then(() => {
      let m = supabase.from("attendance_months").select("*").eq("business_id", active.business_id).eq("month", range.start);
      if (opts.employeeId) m = m.eq("employee_id", opts.employeeId);
      return m;
    }),
    supabase.rpc("attendance_days", { p_business: active.business_id, p_start: range.start, p_end: range.end, p_employee: opts.employeeId ?? null }),
    people,
  ]);
  if (error) throw new Error(error.message);

  const byPerson = new Map<string, AttendanceDay[]>();
  for (const d of (days ?? []) as AttendanceDay[]) {
    const list = byPerson.get(d.employee_id) ?? [];
    list.push(d);
    byPerson.set(d.employee_id, list);
  }
  const summaries = new Map(((months.data ?? []) as AttendanceMonth[]).map((m) => [m.employee_id, m]));
  const list: RegisterPerson[] = (emps ?? [])
    .filter((e) => byPerson.has(e.id))
    .map((e) => ({
      id: e.id,
      name: `${e.preferred_name || e.first_name} ${e.last_name}`.trim(),
      code: e.employee_code,
      photo_path: e.photo_path,
      branch: (e.branch as unknown as { name: string } | null)?.name ?? null,
      department: (e.department as unknown as { name: string } | null)?.name ?? null,
    }));
  return { people: list, days: byPerson, summaries };
}
