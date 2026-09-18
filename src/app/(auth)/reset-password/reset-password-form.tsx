"use client";

import { useActionState } from "react";
import { updatePassword, type FormState } from "@/lib/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

export function ResetPasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(updatePassword, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="New password" htmlFor="password" hint="At least 8 characters, with a letter and a number." error={err.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!err.password} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm_password" error={err.confirm_password}>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!err.confirm_password}
        />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
