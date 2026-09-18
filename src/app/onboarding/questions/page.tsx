import { requireOnboardingBusiness } from "@/lib/onboarding/state";
import { StepHeader } from "../step-header";
import { QuestionsForm } from "./questions-form";

export default async function QuestionsStep() {
  const state = await requireOnboardingBusiness();
  return (
    <>
      <StepHeader
        title="Tell us how you work"
        description="Eight quick questions. Your answers decide which tools we suggest, and you can change everything on the next screen."
      />
      <QuestionsForm initial={state.draft.answers ?? {}} />
    </>
  );
}
