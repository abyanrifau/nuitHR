import { requireOnboardingBusiness } from "@/lib/onboarding/state";
import { saveModulesStep } from "@/lib/onboarding/actions";
import { employeeCountFromRange } from "@/modules/pricing";
import { applyBundle, bundlesForIndustry, type Industry } from "@/modules/selection";
import { CORE_MODULE_KEYS } from "@/modules/registry";
import { ModulePicker } from "@/components/modules/module-picker";
import { StepHeader } from "../step-header";

export default async function ModulesStep() {
  const state = await requireOnboardingBusiness();
  const industry = state.business.industry as Industry;
  // First visit: pre-select the bundle recommended for their industry.
  const firstVisit = state.modules.every((m) => CORE_MODULE_KEYS.includes(m));
  const initial = firstVisit ? applyBundle(bundlesForIndustry(industry)[0].bundle.key).selected : state.modules;

  return (
    <>
      <StepHeader
        title="Choose your modules"
        description="Pick only what you need. We've started you with the bundle most businesses like yours use. Adjust it freely, and change it anytime later."
      />
      <ModulePicker
        industry={industry}
        initialSelected={initial}
        employeeCount={employeeCountFromRange(state.business.employee_count_range)}
        mode="wizard"
        onSave={saveModulesStep}
      />
    </>
  );
}
