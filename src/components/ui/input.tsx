import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const inputClasses =
  "block h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground transition-colors placeholder:text-subtle-foreground hover:border-foreground/30 focus:border-foreground focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(inputClasses, className)} {...props} />;
});
