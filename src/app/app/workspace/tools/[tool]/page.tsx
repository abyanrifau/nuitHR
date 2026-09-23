import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { can } from "@/modules/access";
import { MODULE_MAP } from "@/modules/registry";
import { defaultSetup, type SetupConfig } from "@/modules/setup-defaults";
import type { Industry } from "@/modules/selection";
import type { ModuleKey } from "@/modules/types";
import { AttendanceSetupForm, EmployeesSetupForm, LeaveSetupForm, PayrollSetupForm, PerformanceSetupForm } from "@/components/tool-settings/forms";
import { ClaimTypesEditor, type ClaimTypeRow } from "./claim-types-editor";

export const metadata: Metadata = { title: "Tool settings" };

const hhmm = (t: string) => t.slice(0, 5);

// Which permission is needed to change each tool's settings (matches the database checks).
const EDIT_RIGHT: Partial<Record<ModuleKey, [string, "create" | "edit"]>> = {
  employees: ["org", "create"],
  leave: ["leave", "edit"],
  attendance: ["attendance", "edit"],
  payroll: ["payroll", "edit"],
  claims: ["claims", "edit"],
  performance: ["reviews", "edit"],
};

export default async function ToolSettingsPage({ params }: PageProps<"/app/workspace/tools/[tool]">) {
  const { tool } = await params;
  const def = MODULE_MAP[tool as ModuleKey];
  if (!def?.setup) notFound();
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  const enabled = def.core || active.modules.includes(def.key);
  const right = EDIT_RIGHT[def.key]!;
  const supabase = await createClient();
  const bid = active.business_id;
  const { data: b } = await supabase.from("businesses").select("industry, country").eq("id", bid).maybeSingle();
  const cfg = { industry: (b?.industry ?? "other") as Industry, country: b?.country ?? "MV" };

  const header = (
    <div>
      <Link href="/app/workspace/tools" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Tools
      </Link>
      <h1 className="mt-3 text-3xl sm:text-4xl">{def.setup.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {def.name}. {def.setup.description}
      </p>
    </div>
  );

  if (!enabled)
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="info">Switch {def.name} on in Tools first.</Alert>
      </div>
    );
  if (!can(ctx, right[0], right[1]))
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="warning" title="No access">
          Ask the owner or someone who manages {def.name.toLowerCase()} to change these settings.
        </Alert>
      </div>
    );

  let form: React.ReactNode = null;
  switch (def.key) {
    case "employees": {
      const initial = defaultSetup("employees", cfg);
      const { data } = await supabase.from("departments").select("name, positions(title)").eq("business_id", bid).order("created_at");
      if (data?.length) initial.departments = data.map((d) => ({ name: d.name, positions: (d.positions ?? []).map((p) => p.title) }));
      form = <EmployeesSetupForm initial={initial} />;
      break;
    }
    case "leave": {
      const initial = defaultSetup("leave", cfg);
      const [{ data: types }, { data: hol }] = await Promise.all([
        supabase
          .from("leave_types")
          .select("code, name, entitlement_days, is_paid, accrual_method, gender_eligibility, requires_document")
          .eq("business_id", bid)
          .eq("is_active", true)
          .order("sort"),
        supabase.from("public_holidays").select("name, holiday_date").eq("business_id", bid).order("holiday_date"),
      ]);
      if (types?.length)
        initial.leave_types = types.map((t) => ({
          code: t.code,
          name: t.name,
          days: Number(t.entitlement_days),
          paid: t.is_paid,
          accrual: t.accrual_method === "none" ? ("none" as const) : ("upfront" as const),
          gender: t.gender_eligibility,
          requires_document: t.requires_document,
        })) as SetupConfig<"leave">["leave_types"];
      if (hol?.length) initial.holidays = hol.map((h) => ({ date: h.holiday_date, name: h.name }));
      form = <LeaveSetupForm initial={initial} />;
      break;
    }
    case "attendance": {
      const initial = defaultSetup("attendance", cfg);
      const [{ data: shifts }, { data: policy }] = await Promise.all([
        supabase.from("shifts").select("name, start_time, end_time, break_minutes").eq("business_id", bid).eq("is_active", true).order("start_time"),
        supabase.from("attendance_policies").select("*").eq("business_id", bid).eq("is_default", true).maybeSingle(),
      ]);
      if (shifts?.length)
        initial.shifts = shifts.map((s) => ({ name: s.name, start: hhmm(s.start_time), end: hhmm(s.end_time), break_minutes: s.break_minutes }));
      if (policy)
        initial.policy = {
          grace_minutes: policy.grace_minutes,
          half_day_min_hours: Number(policy.half_day_min_hours),
          full_day_hours: Number(policy.full_day_hours),
          overtime_enabled: policy.overtime_enabled,
          overtime_after_minutes: policy.overtime_after_minutes,
          overtime_rate_weekday: Number(policy.overtime_rate_weekday),
          overtime_rate_rest_day: Number(policy.overtime_rate_rest_day),
          overtime_rate_holiday: Number(policy.overtime_rate_holiday),
          require_gps: policy.require_gps,
          require_selfie: policy.require_selfie,
        };
      form = <AttendanceSetupForm initial={initial} />;
      break;
    }
    case "payroll": {
      const initial = defaultSetup("payroll", cfg);
      const [{ data: sched }, { data: pension }, { data: tax }] = await Promise.all([
        supabase.from("pay_schedules").select("frequency, pay_day, period_start_day").eq("business_id", bid).eq("is_default", true).maybeSingle(),
        supabase
          .from("pension_schemes")
          .select("name, employee_rate, employer_rate, applies_to, notes")
          .eq("business_id", bid)
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("tax_tables")
          .select("name, basis, notes, tax_brackets(lower_bound, upper_bound, rate, sort)")
          .eq("business_id", bid)
          .eq("is_active", true)
          .maybeSingle(),
      ]);
      if (sched) initial.schedule = sched as SetupConfig<"payroll">["schedule"];
      if (pension)
        initial.pension = {
          name: pension.name,
          employee_rate: Number(pension.employee_rate),
          employer_rate: Number(pension.employer_rate),
          applies_to: pension.applies_to,
          note: pension.notes ?? undefined,
        } as SetupConfig<"payroll">["pension"];
      if (tax?.tax_brackets?.length)
        initial.tax = {
          name: tax.name,
          basis: tax.basis,
          note: tax.notes ?? undefined,
          brackets: [...tax.tax_brackets]
            .sort((a, c) => a.sort - c.sort)
            .map((x) => ({ lower: Number(x.lower_bound), upper: x.upper_bound == null ? null : Number(x.upper_bound), rate: Number(x.rate) })),
        } as SetupConfig<"payroll">["tax"];
      form = <PayrollSetupForm initial={initial} />;
      break;
    }
    case "performance": {
      const { data } = await supabase.from("review_cycles").select("name").eq("business_id", bid).order("created_at", { ascending: false }).limit(1);
      form = (
        <PerformanceSetupForm
          initial={defaultSetup("performance", cfg)}
          note={data?.[0] ? `You already have "${data[0].name}". Saving with the same name updates it.` : undefined}
        />
      );
      break;
    }
    case "claims": {
      const [{ data: types }, payrollOn] = [
        await supabase
          .from("claim_types")
          .select("id, name, key, cutoff_day, max_amount, requires_receipt, payout_method, is_active")
          .eq("business_id", bid)
          .order("sort"),
        active.modules.includes("payroll"),
      ];
      form = (
        <ClaimTypesEditor
          initial={(types ?? []).map((t) => ({ ...t, max_amount: t.max_amount == null ? null : Number(t.max_amount) })) as ClaimTypeRow[]}
          payrollOn={payrollOn}
          currency={active.currency}
        />
      );
      break;
    }
  }

  return (
    <div className="space-y-8">
      {header}
      <div className="max-w-4xl">{form}</div>
    </div>
  );
}
