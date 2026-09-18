"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { KeyRound, Mail } from "lucide-react";
import { sendMagicLink, signInWithPassword, type FormState } from "@/lib/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";

type Mode = "password" | "magic";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("password");
  const [pwState, pwAction] = useActionState<FormState, FormData>(signInWithPassword, {});
  const [mlState, mlAction] = useActionState<FormState, FormData>(sendMagicLink, {});
  const state = mode === "password" ? pwState : mlState;
  const emailDefault = pwState.values?.email ?? mlState.values?.email ?? "";

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="How would you like to sign in?" className="grid grid-cols-2 rounded-lg bg-surface-muted p-1">
        {(
          [
            { value: "password", label: "Password", Icon: KeyRound },
            { value: "magic", label: "Email me a link", Icon: Mail },
          ] as const
        ).map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm text-muted-foreground transition-colors",
              mode === value && "bg-surface text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}

      <form action={mode === "password" ? pwAction : mlAction} className="space-y-4" noValidate key={mode}>
        <input type="hidden" name="next" value={next} />
        <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            defaultValue={emailDefault}
            aria-invalid={!!state.fieldErrors?.email}
            aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
          />
        </Field>

        {mode === "password" && (
          <Field
            label={
              <span className="flex w-full items-center justify-between">
                Password
                <Link href="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Forgot password?
                </Link>
              </span>
            }
            htmlFor="password"
            error={state.fieldErrors?.password}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={!!state.fieldErrors?.password}
            />
          </Field>
        )}

        <SubmitButton className="w-full" size="lg" pendingText={mode === "password" ? "Signing in…" : "Sending link…"}>
          {mode === "password" ? "Sign in" : "Email me a sign-in link"}
        </SubmitButton>
      </form>
    </div>
  );
}
