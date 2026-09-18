"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/errors";
import { Alert } from "./alert";
import { Field } from "./field";
import { Input } from "./input";
import { Select } from "./select";
import { Textarea } from "./textarea";
import { SubmitButton } from "./submit-button";
import { cn } from "@/lib/utils";

const ErrorsContext = createContext<Record<string, string[] | undefined>>({});

/**
 * A form that sends to a server action, shows a pop-up when saved,
 * and shows problems next to the fields they belong to.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  className,
  onSuccess,
  resetOnSuccess,
  footer,
  hideSubmit,
}: {
  action: (state: ActionResult, form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  onSuccess?: (state: ActionResult) => void;
  resetOnSuccess?: boolean;
  footer?: ReactNode;
  hideSubmit?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const last = useRef<ActionResult>({});
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
  }, [state, onSuccess, resetOnSuccess]);

  return (
    <ErrorsContext.Provider value={state.fieldErrors ?? {}}>
      <form ref={ref} action={formAction} className={cn("space-y-5", className)} noValidate>
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        {children}
        {!hideSubmit && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <SubmitButton pendingText={pendingLabel}>{submitLabel}</SubmitButton>
            {footer}
          </div>
        )}
      </form>
    </ErrorsContext.Provider>
  );
}

export function useFieldError(name: string) {
  return useContext(ErrorsContext)[name];
}

type Common = { name: string; label: ReactNode; hint?: ReactNode; optional?: boolean; className?: string };

/** Labelled text/date/number/email input that shows its own error. */
export function TextField({
  name,
  label,
  hint,
  optional,
  className,
  ...props
}: Common & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">) {
  const error = useFieldError(name);
  return (
    <Field label={label} htmlFor={name} hint={hint} error={error} optional={optional} className={className}>
      <Input id={name} name={name} aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-error` : undefined} {...props} />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  hint,
  optional,
  className,
  options,
  placeholder,
  ...props
}: Common & { options: { value: string; label: string }[]; placeholder?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name">) {
  const error = useFieldError(name);
  return (
    <Field label={label} htmlFor={name} hint={hint} error={error} optional={optional} className={className}>
      <Select id={name} name={name} options={options} placeholder={placeholder} aria-invalid={error ? true : undefined} {...props} />
    </Field>
  );
}

export function TextareaField({
  name,
  label,
  hint,
  optional,
  className,
  ...props
}: Common & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
  const error = useFieldError(name);
  return (
    <Field label={label} htmlFor={name} hint={hint} error={error} optional={optional} className={className}>
      <Textarea id={name} name={name} rows={3} aria-invalid={error ? true : undefined} {...props} />
    </Field>
  );
}

export function CheckboxField({ name, label, defaultChecked, hint }: { name: string; label: ReactNode; defaultChecked?: boolean; hint?: ReactNode }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      {/* Sends "off" when unticked, so the saved value can be switched back to no. */}
      <input type="hidden" name={name} value="" />
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
      <span>
        <span className="text-foreground">{label}</span>
        {hint && <span className="block text-xs text-subtle-foreground">{hint}</span>}
      </span>
    </label>
  );
}
