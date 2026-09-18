"use client";

import { useState, useTransition } from "react";
import { saveToolSettings } from "@/lib/onboarding/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Save button shared by every tool settings screen (Workspace → Tools → tool). */
export function SetupActions({ module, getConfig }: { module: string; getConfig: () => unknown }) {
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3 border-t border-border pt-5">
      {result?.error && <Alert tone="danger">{result.error}</Alert>}
      {result?.message && <Alert tone="success">{result.message}</Alert>}
      <Button
        size="lg"
        loading={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await saveToolSettings(module, getConfig()));
          })
        }
      >
        Save settings
      </Button>
    </div>
  );
}
