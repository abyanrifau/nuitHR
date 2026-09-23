import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";
import { RulesForm, type Rules } from "./rules-form";

export const metadata: Metadata = { title: "Attendance rules" };

const DEFAULTS: Rules = {
  grace_minutes: 10,
  early_leave_minutes: 10,
  half_day_min_hours: 4,
  full_day_hours: 8,
  overtime_enabled: true,
  overtime_mode: "daily_hours",
  overtime_daily_hours: null,
  overtime_after_minutes: 30,
  overtime_rounding: "down",
  overtime_round_to: 15,
  overtime_monthly_cap_hours: null,
  overtime_requires_approval: false,
  overtime_rate_weekday: 1.25,
  overtime_rate_rest_day: 1.5,
  overtime_rate_holiday: 1.5,
  require_gps: false,
  require_selfie: false,
};

/** How each day's status and overtime are worked out. */
export default async function RulesPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "attendance", "view")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to see attendance rules.</Alert>;
  }
  const supabase = await createClient();
  const { data: p } = await supabase.from("attendance_policies").select("*").eq("business_id", active.business_id).eq("is_default", true).maybeSingle();
  const rules: Rules = p
    ? {
        grace_minutes: p.grace_minutes,
        early_leave_minutes: p.early_leave_minutes,
        half_day_min_hours: Number(p.half_day_min_hours),
        full_day_hours: Number(p.full_day_hours),
        overtime_enabled: p.overtime_enabled,
        overtime_mode: p.overtime_mode,
        overtime_daily_hours: p.overtime_daily_hours == null ? null : Number(p.overtime_daily_hours),
        overtime_after_minutes: p.overtime_after_minutes,
        overtime_rounding: p.overtime_rounding,
        overtime_round_to: p.overtime_round_to,
        overtime_monthly_cap_hours: p.overtime_monthly_cap_hours == null ? null : Number(p.overtime_monthly_cap_hours),
        overtime_requires_approval: p.overtime_requires_approval,
        overtime_rate_weekday: Number(p.overtime_rate_weekday),
        overtime_rate_rest_day: Number(p.overtime_rate_rest_day),
        overtime_rate_holiday: Number(p.overtime_rate_holiday),
        require_gps: p.require_gps,
        require_selfie: p.require_selfie,
      }
    : DEFAULTS;
  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/time", label: "Time" }}
        title="Attendance rules"
        description="How each day's status and overtime are worked out. Rest days and public holidays are never counted as absences."
      />
      <RulesForm rules={rules} canEdit={can(ctx, "attendance", "edit", "all")} />
    </div>
  );
}
