import { redirect } from "next/navigation";
import { requireOnboardingBusiness } from "@/lib/onboarding/state";
import { saveToolsStep } from "@/lib/onboarding/actions";
import { CORE_MODULE_KEYS } from "@/modules/registry";
import { employeeCountFromRange } from "@/modules/pricing";
import { isComplete, recommendTools, selectionFromAnswers } from "@/modules/setup-questions";
import { ToolPicker } from "@/components/tools/tool-picker";
import { StepHeader } from "../step-header";

export default async function ToolsStep() {
  const state = await requireOnboardingBusiness();
  const answers = state.draft.answers ?? {};
  if (!isComplete(answers)) redirect("/onboarding/questions");

  const recs = recommendTools(answers);
  // First visit: start from the recommendation. Coming back: keep what they chose.
  const chosenBefore = state.modules.some((m) => !CORE_MODULE_KEYS.includes(m));
  const initial = chosenBefore ? state.modules : selectionFromAnswers(answers);

  return (
    <>
      <StepHeader
        title="Your recommended tools"
        description={
          recs.length
            ? "Based on your answers. Switch anything on or off; you can change this any time in Workspace → Tools."
            : "Your answers point to the foundation on its own. Add any tool below if you'd like it."
        }
      />
      <ToolPicker
        initialSelected={initial}
        people={employeeCountFromRange(state.business.employee_count_range)}
        mode="setup"
        reasons={Object.fromEntries(recs.map((r) => [r.key, r.reason]))}
        onSave={saveToolsStep}
      />
    </>
  );
}
