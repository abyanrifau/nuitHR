"use client";

import { useActionState, useState } from "react";
import { signUp, type FormState } from "@/lib/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";

export function SignupForm({ next, email = "" }: { next: string; email?: string }) {
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  const [method, setMethod] = useState<"password" | "magic">(state.values?.method === "magic" ? "magic" : "password");
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="method" value={method} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <Field label="Full name" htmlFor="full_name" error={err.full_name}>
        <Input id="full_name" name="full_name" autoComplete="name" required defaultValue={v.full_name} aria-invalid={!!err.full_name} />
      </Field>

      <Field label="Work email" htmlFor="email" error={err.email}>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          defaultValue={v.email ?? email}
          aria-invalid={!!err.email}
        />
      </Field>

      <Field label="Phone" htmlFor="phone" optional hint="Include the country code, e.g. +960 7XX XXXX" error={err.phone}>
        <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={v.phone} aria-invalid={!!err.phone} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm">How would you like to sign in?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { value: "password", title: "With a password", text: "Type it each time you sign in." },
              { value: "magic", title: "With an email link", text: "We email you a one-time link. No password." },
            ] as const
          ).map((o) => (
            <label
              key={o.value}
              className={cn(
                "cursor-pointer rounded-lg border p-3 text-sm transition-colors",
                method === o.value ? "border-foreground bg-surface" : "border-border hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name="method_choice"
                value={o.value}
                checked={method === o.value}
                onChange={() => setMethod(o.value)}
                className="sr-only"
              />
              <span className="block">{o.title}</span>
              <span className="block text-xs text-muted-foreground">{o.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {method === "password" && (
        <>
          <Field label="Password" htmlFor="password" hint="At least 8 characters, with a letter and a number." error={err.password}>
            <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!err.password} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm_password" error={err.confirm_password}>
            <Input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={!!err.confirm_password}
            />
          </Field>
        </>
      )}

      <SubmitButton className="w-full" size="lg" pendingText="Creating your account…">
        Create account
      </SubmitButton>
      <p className="text-xs text-subtle-foreground">
        By creating an account you agree to our{" "}
        <a href="/terms" className="underline hover:text-foreground">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline hover:text-foreground">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}
