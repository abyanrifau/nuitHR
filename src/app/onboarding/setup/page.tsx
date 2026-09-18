import { redirect } from "next/navigation";
import { requireOnboardingBusiness, setupModulesFor } from "@/lib/onboarding/state";

export default async function SetupIndex() {
  const state = await requireOnboardingBusiness();
  const list = setupModulesFor(state.modules);
  redirect(list[0] ? `/onboarding/setup/${list[0]}` : "/onboarding/team");
}
