import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Simple accordion of questions, separated by hairlines. Works without JavaScript. */
export function Faq({ items, className }: { items: { q: string; a: string }[]; className?: string }) {
  return (
    <div className={cn("border-t border-border", className)}>
      {items.map((f) => (
        <details key={f.q} className="group border-b border-border">
          <summary className="font-display flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg [&::-webkit-details-marker]:hidden">
            {f.q}
            <Plus className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" aria-hidden />
          </summary>
          <p className="measure pb-6 text-muted-foreground">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
