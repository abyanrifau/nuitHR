import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tabs across the top of a page. They wrap onto a second line on narrow
 * screens instead of scrolling sideways, so every tab is always visible.
 */
export function TabNav({ label, tabs, current }: { label: string; tabs: { key: string; label: string; href: string }[]; current: string }) {
  return (
    <nav aria-label={label} className="mb-8 border-b border-border">
      <ul className="flex flex-wrap gap-x-6">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === current ? "page" : undefined}
              className={cn(
                "-mb-px block border-b py-3 text-sm whitespace-nowrap",
                t.key === current ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
