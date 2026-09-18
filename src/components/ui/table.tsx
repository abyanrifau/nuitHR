import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tables: hairline row dividers, muted uppercase column labels, subtle row hover. No zebra stripes. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-border", className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("border-b border-border px-4 py-3 text-[11px] font-normal tracking-[0.12em] whitespace-nowrap text-subtle-foreground uppercase", className)}
      style={{ fontFamily: "var(--font-body)" }}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-border px-4 py-3 align-middle", className)} {...props} />;
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("transition-colors last:[&>td]:border-b-0 hover:bg-accent-soft", className)}>{children}</tr>;
}

/** Column heading that sorts by linking to ?sort=field&dir=asc|desc (keeps other filters). */
export function SortTh({
  field,
  label,
  params,
  basePath,
  className,
}: {
  field: string;
  label: string;
  params: Record<string, string | undefined>;
  basePath: string;
  className?: string;
}) {
  const active = params.sort === field;
  const dir = active && params.dir === "asc" ? "desc" : "asc";
  const q = new URLSearchParams(Object.entries({ ...params, sort: field, dir, page: undefined }).filter(([, v]) => v) as [string, string][]);
  return (
    <Th className={className} aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={`${basePath}?${q}`} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active && (params.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </Link>
    </Th>
  );
}

/** Previous / next page links with "x–y of z". */
export function Pagination({
  page,
  pageSize,
  total,
  params,
  basePath,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
  basePath: string;
}) {
  if (total <= pageSize) return total ? <p className="mt-3 text-[13px] text-subtle-foreground tabular">{total} in total</p> : null;
  const pages = Math.ceil(total / pageSize);
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `${basePath}?${q}`;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-[13px] text-muted-foreground">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 hover:border-border-strong hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 hover:border-border-strong hover:text-foreground">
            Next <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

/** Small status label with a coloured dot. */
export function StatusDot({ tone, children }: { tone: "success" | "warning" | "danger" | "info" | "neutral"; children: ReactNode }) {
  const dot = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", neutral: "bg-subtle-foreground" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      {children}
    </span>
  );
}
