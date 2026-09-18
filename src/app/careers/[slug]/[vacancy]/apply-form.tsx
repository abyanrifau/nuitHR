"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { apply, type ApplyState } from "./actions";

export function ApplyForm({ slug, vacancyId }: { slug: string; vacancyId: string }) {
  const [state, action] = useActionState<ApplyState, FormData>(apply, {});
  if (state.done) {
    return (
      <Alert tone="success" title="Thank you, your application is in">
        We&apos;ll look at it and get back to you by email or phone.
      </Alert>
    );
  }
  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="vacancy_id" value={vacancyId} />
      {/* Left empty by people; filled in by spam robots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <Field label="Full name" htmlFor="ap-name">
        <Input id="ap-name" name="full_name" autoComplete="name" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="ap-email">
          <Input id="ap-email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Phone" htmlFor="ap-phone" optional>
          <Input id="ap-phone" name="phone" type="tel" autoComplete="tel" />
        </Field>
      </div>
      <Field label="CV" htmlFor="ap-cv" hint="PDF, Word or a photo, up to 2 MB." optional>
        <input id="ap-cv" name="cv" type="file" accept=".pdf,.doc,.docx,image/*" className="block w-full text-sm file:mr-3 file:h-9 file:rounded-lg file:border file:border-border-strong file:bg-transparent file:px-3 file:text-foreground" />
      </Field>
      <Field label="A few words about you" htmlFor="ap-cover" optional>
        <Textarea id="ap-cover" name="cover_letter" rows={5} />
      </Field>
      <SubmitButton pendingText="Sending…" size="lg">
        Send application
      </SubmitButton>
      <p className="text-[12px] text-subtle-foreground">Your details are only shared with the company hiring for this role.</p>
    </form>
  );
}
