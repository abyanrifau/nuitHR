import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";
import { SchedulesClient } from "./schedules-client";

export const metadata: Metadata = { title: "Work schedules" };

/** Which days each person works, and their usual shift. The roster can change any single day. */
export default async function SchedulesPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "roster", "view")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to see work schedules.</Alert>;
  }
  const supabase = await createClient();
  const [{ data: schedules }, { data: shifts }, { data: people }, { data: biz }] = await Promise.all([
    supabase.from("work_schedules").select("id, name, working_days, shift_id, is_default").eq("business_id", active.business_id).order("name"),
    supabase.from("shifts").select("id, name, start_time, end_time, break_minutes").eq("business_id", active.business_id).eq("is_active", true).order("start_time"),
    supabase
      .from("employees")
      .select("id, first_name, last_name, preferred_name, work_schedule_id, department:departments!employees_business_id_department_id_fkey(name)")
      .eq("business_id", active.business_id)
      .in("status", ["active", "probation", "on_leave", "suspended"])
      .order("first_name")
      .limit(3000),
    supabase.from("businesses").select("working_days").eq("id", active.business_id).single(),
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/app/time", label: "Time" }}
        title="Work schedules"
        description="Which days each person works, and their usual shift (its times and break). The roster can change any single day; rest days and public holidays are never absences."
      />
      <SchedulesClient
        canEdit={can(ctx, "roster", "edit", "all")}
        canAssign={can(ctx, "employees", "edit")}
        companyDays={(biz?.working_days as number[]) ?? [0, 1, 2, 3, 4]}
        schedules={(schedules ?? []).map((s) => ({ ...s, working_days: s.working_days as number[] }))}
        shifts={(shifts ?? []).map((s) => ({ id: s.id, label: `${s.name} · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}, ${s.break_minutes} min break` }))}
        people={(people ?? []).map((p) => ({
          id: p.id,
          name: `${p.preferred_name || p.first_name} ${p.last_name}`.trim(),
          department: (p.department as unknown as { name: string } | null)?.name ?? "No department",
          schedule: p.work_schedule_id,
        }))}
      />
    </div>
  );
}
