"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Companies" },
  { href: "/admin/accounts", label: "Logins" },
  { href: "/admin/activity", label: "Admin log" },
];

export function AdminNav({ horizontal = false }: { horizontal?: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Admin" className={cn(horizontal ? "flex gap-4 text-sm" : "space-y-0.5")}>
      {ITEMS.map((i) => {
        const on = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              horizontal ? "py-1" : "block rounded-lg px-3 py-2 text-sm",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              !horizontal && on && "bg-accent-soft",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
