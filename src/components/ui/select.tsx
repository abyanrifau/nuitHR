import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }
>(function Select({ className, options, placeholder, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "block h-10 w-full appearance-none rounded-lg border border-border-strong bg-surface py-0 pr-9 pl-3 text-sm text-foreground transition-colors hover:border-foreground/30 focus:border-foreground focus:ring-1 focus:ring-ring focus:outline-none aria-[invalid=true]:border-danger [&>option]:bg-surface-raised",
          className,
        )}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
    </div>
  );
});
