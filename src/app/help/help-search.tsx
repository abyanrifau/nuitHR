"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { HELP_GUIDES } from "@/content/help";

/** Search across every guide's title, intro and steps. */
export function HelpSearch() {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return HELP_GUIDES.filter((g) => {
      const text = [g.title, g.intro, ...g.steps, ...g.wrong].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [q]);

  return (
    <div className="max-w-2xl">
      <label htmlFor="help-search" className="sr-only">
        Search the guides
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-subtle-foreground" aria-hidden />
        <input
          id="help-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the guides, e.g. invite, password, claim"
          className="h-14 w-full rounded-xl border border-border-strong bg-surface pr-4 pl-12 text-base placeholder:text-subtle-foreground focus:border-foreground focus:outline-none"
        />
      </div>
      {q.trim() && (
        <div className="mt-3 rounded-xl border border-border bg-surface" aria-live="polite">
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No guide matches &ldquo;{q}&rdquo;. Try another word, or{" "}
              <Link href="/contact" className="text-foreground underline underline-offset-4">
                ask us
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((g) => (
                <li key={g.slug}>
                  <Link href={`/help/guides/${g.slug}`} className="block p-4 hover:bg-accent-soft">
                    <span className="font-display block">{g.title}</span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">{g.intro}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
