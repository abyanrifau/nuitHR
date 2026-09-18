import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";

/** Sends people back to where they left off in setup. */
export default async function OnboardingIndex() {
  const state = await getOnboardingState();
  if (!state.businessId) redirect("/onboarding/company");
  const step = Math.min(state.currentStep, 5);
  redirect(
    ["/onboarding/company", "/onboarding/company", "/onboarding/company", "/onboarding/questions", "/onboarding/tools", "/onboarding/invite"][step],
  );
}
