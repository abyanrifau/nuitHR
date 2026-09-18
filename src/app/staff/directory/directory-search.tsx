"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function DirectorySearch({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (q === initial) return;
    const t = setTimeout(() => router.replace(q ? `${path}?q=${encodeURIComponent(q)}` : path), 250);
    return () => clearTimeout(t);
  }, [q, initial, path, router]);
  return (
    <label className="relative block">
      <span className="sr-only">Search colleagues</span>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, job or team"
        className="h-12 w-full rounded-lg border border-border-strong bg-surface pr-3 pl-9 text-base placeholder:text-subtle-foreground focus:border-foreground focus:outline-none"
      />
    </label>
  );
}
