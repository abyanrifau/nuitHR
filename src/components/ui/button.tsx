import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  // White with black text (black with white text in light mode)
  primary: "bg-accent text-accent-foreground hover:opacity-85 active:opacity-75",
  // Hairline outline
  secondary: "border border-border-strong bg-transparent text-foreground hover:border-foreground/40 hover:bg-accent-soft",
  ghost: "text-muted-foreground hover:bg-accent-soft hover:text-foreground",
  // Destructive: muted danger colour as text + border only
  danger: "border border-danger/50 bg-transparent text-danger hover:border-danger hover:bg-danger-soft",
  link: "h-auto px-0 text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-[15px] gap-2",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "font-display inline-flex items-center justify-center rounded-lg tracking-[-0.01em] whitespace-nowrap transition-[opacity,background-color,border-color,color] disabled:pointer-events-none disabled:opacity-40",
    variants[variant],
    variant !== "link" && sizes[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
