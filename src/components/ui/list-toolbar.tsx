"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToolbarFilter {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

/** Search box + filter dropdowns that update the address bar (so filtered views can be shared and bookmarked). */
export function ListToolbar({ placeholder = "Search", filters = [], children }: { placeholder?: string; filters?: ToolbarFilter[]; children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next}`));
  };

  // Search as you type, with a short pause so we don't reload on every key.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => update({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [q]);

  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <label className="relative min-w-[14rem] flex-1">
        <span className="sr-only">{placeholder}</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-lg border border-border-strong bg-surface pr-3 pl-9 text-sm placeholder:text-subtle-foreground focus:border-foreground focus:outline-none"
        />
      </label>
      {filters.map((f) => (
        <label key={f.name} className="relative">
          <span className="sr-only">{f.label}</span>
          <select
            value={params.get(f.name) ?? ""}
            onChange={(e) => update({ [f.name]: e.target.value })}
            className="h-10 appearance-none rounded-lg border border-border-strong bg-surface py-0 pr-8 pl-3 text-sm focus:border-foreground focus:outline-none"
          >
            <option value="">{f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-subtle-foreground">▾</span>
        </label>
      ))}
      {children}
    </div>
  );
}
