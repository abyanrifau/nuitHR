"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input, inputClasses } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { sendContactMessage, type ContactState } from "./actions";

export function ContactForm() {
  const [state, action] = useActionState<ContactState, FormData>(sendContactMessage, {});
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <Alert tone="success" title="Thanks, your message is with us">
        We usually reply within one working day.
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" htmlFor="name" error={err.name}>
          <Input id="name" name="name" autoComplete="name" defaultValue={v.name} aria-invalid={!!err.name} />
        </Field>
        <Field label="Email" htmlFor="email" error={err.email}>
          <Input id="email" name="email" type="email" autoComplete="email" defaultValue={v.email} aria-invalid={!!err.email} />
        </Field>
        <Field label="Company" htmlFor="company" optional>
          <Input id="company" name="company" autoComplete="organization" defaultValue={v.company} />
        </Field>
        <Field label="Phone" htmlFor="phone" optional>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={v.phone} />
        </Field>
      </div>
      <Field label="Message" htmlFor="message" error={err.message}>
        <textarea
          id="message"
          name="message"
          rows={6}
          defaultValue={v.message}
          aria-invalid={!!err.message}
          className={cn(inputClasses, "h-auto py-2.5 leading-relaxed")}
        />
      </Field>
      <div className="hidden" aria-hidden>
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <SubmitButton size="lg" pendingText="Sending…">
        Send message
      </SubmitButton>
    </form>
  );
}
