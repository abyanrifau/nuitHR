"use client";

import { useState, useTransition } from "react";
import { acceptInvitation } from "@/lib/onboarding/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AcceptButton({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <Button
        size="lg"
        className="w-full"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await acceptInvitation(token);
            if (r?.error) setError(r.error);
          })
        }
      >
        Accept invitation
      </Button>
    </div>
  );
}
