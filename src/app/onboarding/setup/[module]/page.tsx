import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { requireOnboardingBusiness, setupModulesFor } from "@/lib/onboarding/state";
import { MODULE_MAP } from "@/modules/registry";
import { defaultSetup, isSetupModule, type SetupConfig } from "@/modules/setup-defaults";
import type { Industry } from "@/modules/selection";
import { StepHeader } from "../../step-header";
import { AttendanceSetupForm, EmployeesSetupForm, LeaveSetupForm, PayrollSetupForm, PerformanceSetupForm, TransportSetupForm } from "../forms";

const hhmm = (t: string) => t.slice(0, 5);

export default async function SetupModuleStep({ params }: PageProps<"/onboarding/setup/[module]">) {
  const { module } = await params;
  if (!isSetupModule(module)) notFound();
  const state = await requireOnboardingBusiness();
  const list = setupModulesFor(state.modules);
  if (!list.includes(module)) redirect("/onboarding/setup");

  const idx = list.indexOf(module);
  const next = list[idx + 1];
  const nextLabel = next ? MODULE_MAP[next].setup!.title : "Invite your team";
  const ctx = { industry: state.business.industry as Industry, country: state.business.country };
  const supabase = await createClient();
  const bid = state.businessId;
  const def = MODULE_MAP[module];

  // Pre-fill with what's already saved (when coming back), otherwise the defaults.
  let form: React.ReactNode;
  switch (module) {
    case "employees": {
      const initial = defaultSetup("employees", ctx);
      const { data } = await supabase.from("departments").select("id, name, positions(title)").eq("business_id", bid).order("created_at");
      if (data?.length) initial.departments = data.map((d) => ({ name: d.name, positions: (d.positions ?? []).map((p) => p.title) }));
      form = <EmployeesSetupForm initial={initial} nextLabel={nextLabel} />;
      break;
    }
    case "leave": {
      const initial = defaultSetup("leave", ctx);
      const { data } = await supabase
        .from("leave_types")
        .select("code, name, entitlement_days, is_paid, accrual_method, carry_forward_max, gender_eligibility, requires_document")
        .eq("business_id", bid)
        .eq("is_active", true)
        .order("sort");
      if (data?.length)
        initial.leave_types = data.map((t) => ({
          code: t.code,
          name: t.name,
          days: Number(t.entitlement_days),
          paid: t.is_paid,
          accrual: t.accrual_method,
          carry_forward: Number(t.carry_forward_max),
          gender: t.gender_eligibility,
          requires_document: t.requires_document,
        })) as SetupConfig<"leave">["leave_types"];
      form = <LeaveSetupForm initial={initial} nextLabel={nextLabel} />;
      break;
    }
    case "attendance": {
      const initial = defaultSetup("attendance", ctx);
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
      form = <AttendanceSetupForm initial={initial} nextLabel={nextLabel} />;
      break;
    }
    case "payroll": {
      const initial = defaultSetup("payroll", ctx);
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
            .sort((a, b) => a.sort - b.sort)
            .map((b) => ({ lower: Number(b.lower_bound), upper: b.upper_bound == null ? null : Number(b.upper_bound), rate: Number(b.rate) })),
        } as SetupConfig<"payroll">["tax"];
      form = <PayrollSetupForm initial={initial} nextLabel={nextLabel} />;
      break;
    }
    case "transport": {
      const initial = defaultSetup("transport", ctx);
      const { data } = await supabase.from("pay_schedules").select("claims_cutoff_day").eq("business_id", bid).eq("is_default", true).maybeSingle();
      if (data?.claims_cutoff_day) initial.claims_cutoff_day = data.claims_cutoff_day;
      form = <TransportSetupForm initial={initial} nextLabel={nextLabel} />;
      break;
    }
    case "performance": {
      const initial = defaultSetup("performance", ctx);
      const { data } = await supabase.from("review_cycles").select("name").eq("business_id", bid).order("created_at", { ascending: false }).limit(1);
      form = (
        <PerformanceSetupForm
          initial={initial}
          nextLabel={nextLabel}
          note={data?.[0] ? `You've already created "${data[0].name}". Saving with the same name updates it.` : undefined}
        />
      );
      break;
    }
  }

  return (
    <>
      <StepHeader
        title={def.setup!.title}
        description={
          <>
            {def.setup!.description} Setup {idx + 1} of {list.length}, for <span className="text-foreground">{def.name}</span>.
          </>
        }
      >
        {state.setupDone.includes(module) && <Badge tone="success">Saved</Badge>}
      </StepHeader>
      <div className="max-w-4xl">{form}</div>
    </>
  );
}
