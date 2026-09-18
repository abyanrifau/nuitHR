"use client";

import { useState, useTransition } from "react";
import { saveSetupStep, skipSetupStep } from "@/lib/onboarding/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Save / Skip buttons shared by every quick-setup screen. */
export function SetupActions({ module, getConfig, nextLabel }: { module: string; getConfig: () => unknown; nextLabel: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [skipping, startSkip] = useTransition();

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" loading={skipping} disabled={pending} onClick={() => startSkip(() => skipSetupStep(module))}>
          Skip for now, set up later
        </Button>
        <Button
          size="lg"
          loading={pending}
          disabled={skipping}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await saveSetupStep(module, getConfig());
              if (r?.error) setError(r.error);
            })
          }
        >
          Save and continue
        </Button>
      </div>
      <p className="text-right text-xs text-muted-foreground">Next: {nextLabel}</p>
    </div>
  );
}
