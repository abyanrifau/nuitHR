import { redirect } from "next/navigation";
import { PartyPopper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { completeOnboarding } from "@/lib/onboarding/actions";
import { requireOnboardingBusiness } from "@/lib/onboarding/state";
import { MODULE_MAP } from "@/modules/registry";
import { ModuleIcon } from "@/modules/icons";

export default async function DoneStep() {
  const state = await requireOnboardingBusiness();
  if (!state.business.onboarding_completed_at) redirect("/onboarding/team");
  const optional = state.modules.filter((m) => !MODULE_MAP[m]?.core);

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardContent className="space-y-6 p-8">
          <div className="flex size-14 items-center justify-center rounded-lg border border-border text-foreground">
            <PartyPopper className="size-7" aria-hidden />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl">Welcome to your workspace</h1>
            <p className="text-muted-foreground">
              <span className="text-foreground">{state.business.name}</span> is ready. Your dashboard has a short checklist for anything you skipped.
            </p>
          </div>
          {optional.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {optional.map((m) => (
                <li key={m} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1 text-sm">
                  <ModuleIcon name={MODULE_MAP[m].icon} className="size-4 text-muted-foreground" />
                  {MODULE_MAP[m].name}
                </li>
              ))}
            </ul>
          )}
          <form action={completeOnboarding}>
            <SubmitButton size="lg" className="w-full" pendingText="Opening…">
              Go to my dashboard
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
