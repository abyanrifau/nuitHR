import { redirect } from "next/navigation";
import { getOnboardingState, setupModulesFor } from "@/lib/onboarding/state";

/** Sends the user to where they left off. */
export default async function OnboardingIndex() {
  const state = await getOnboardingState();
  if (!state.businessId) redirect("/onboarding/business");
  switch (state.currentStep) {
    case 3:
      redirect("/onboarding/modules");
    case 4: {
      const pending = setupModulesFor(state.modules).find((m) => !state.setupDone.includes(m) && !state.draft.skipped?.includes(m));
      redirect(pending ? `/onboarding/setup/${pending}` : "/onboarding/team");
    }
    case 5:
      redirect("/onboarding/team");
    default:
      redirect(state.currentStep >= 6 ? "/onboarding/done" : "/onboarding/modules");
  }
}
