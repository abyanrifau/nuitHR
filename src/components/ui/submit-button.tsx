"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/** A submit button that shows a spinner while its form is being sent. */
export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
