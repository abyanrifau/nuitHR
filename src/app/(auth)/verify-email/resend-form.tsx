"use client";

import { useActionState } from "react";
import { resendVerification, type FormState } from "@/lib/auth/actions";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

export function ResendForm({ email }: { email: string }) {
  const [state, action] = useActionState<FormState, FormData>(resendVerification, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}
      <SubmitButton variant="secondary" className="w-full" pendingText="Sending…">
        Send the email again
      </SubmitButton>
    </form>
  );
}
