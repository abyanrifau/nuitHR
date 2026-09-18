"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { ModuleIcon } from "@/modules/icons";
import type { IconName } from "@/modules/types";
import { cn } from "@/lib/utils";

export interface JumpItem {
  label: string;
  href: string;
  icon: IconName;
  group: string;
}

/** "Jump to": a command bar opened with Ctrl+K / Cmd+K to go anywhere quickly. */
export function JumpTo({ items }: { items: JumpItem[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(q)) : items;
  }, [items, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
      >
        <Search className="size-4" aria-hidden />
        <span className="font-body hidden sm:inline">Jump to</span>
        <kbd className="font-body ml-2 hidden rounded border border-border px-1.5 text-[11px] text-subtle-foreground md:inline">Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && setOpen(false)}
        className="mx-auto mt-[12vh] w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface-raised p-0 text-foreground backdrop:bg-black/70"
        aria-label="Jump to"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 text-subtle-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[index]) {
                go(results[index].href);
              }
            }}
            placeholder="Jump to a page…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
            aria-label="Search pages"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {results.length === 0 && <li className="px-3 py-6 text-sm text-subtle-foreground">Nothing matches &ldquo;{query}&rdquo;.</li>}
          {results.map((r, i) => (
            <li key={r.href} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(r.href)}
                className={cn(
                  "font-body flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm",
                  i === index ? "bg-accent-soft text-foreground" : "text-muted-foreground",
                )}
              >
                <ModuleIcon name={r.icon} className="size-4 shrink-0" />
                <span className="flex-1">{r.label}</span>
                <span className="text-[11px] text-subtle-foreground">{r.group}</span>
                {i === index && <CornerDownLeft className="size-3.5 text-subtle-foreground" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
