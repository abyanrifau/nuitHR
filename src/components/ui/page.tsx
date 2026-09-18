import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Page title block used across the app. */
export function PageHeader({
  label,
  title,
  description,
  back,
  actions,
}: {
  label?: string;
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden /> {back.label}
          </Link>
        )}
        {label && <p className="section-label">{label}</p>}
        <h1 className={cn("text-3xl sm:text-4xl", label && "mt-2")}>{title}</h1>
        {description && <p className="measure mt-2 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Friendly empty list: what goes here and a button to add the first one. */
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-14 text-center">
      <p className="font-display text-lg">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-muted", className)} aria-hidden />;
}

/** Label/value pairs for profile-style pages. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-[13px] text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 text-foreground">{i.value || <span className="text-subtle-foreground">Not added</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
