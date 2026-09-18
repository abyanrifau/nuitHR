"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { markRead, recentNotifications } from "@/lib/notifications/actions";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = Awaited<ReturnType<typeof recentNotifications>>[number];

/** Bell with an unread count. Opens a short list; everything else is on the notifications page. */
export function NotificationBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    start(async () => setItems(await recentNotifications()));
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const readAll = () =>
    start(async () => {
      await markRead("all");
      setItems((list) => list?.map((i) => ({ ...i, read: true })) ?? null);
      router.refresh();
    });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent-soft hover:text-foreground"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] leading-4 text-accent-foreground tabular">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-strong bg-surface-raised">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-display text-sm">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="text-[13px] text-muted-foreground hover:text-foreground">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items === null ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>
            ) : (
              items.map((n) => (
                <li key={n.id} className="border-b border-border last:border-b-0">
                  <Link
                    href={n.link ?? "/app/notifications"}
                    onClick={() => {
                      setOpen(false);
                      if (!n.read) start(async () => void (await markRead([n.id])));
                    }}
                    className="flex gap-3 px-4 py-3 hover:bg-accent-soft"
                  >
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-foreground")} aria-hidden />
                    <span className="min-w-0">
                      <span className={cn("block text-sm", n.read ? "text-muted-foreground" : "text-foreground")}>{n.title}</span>
                      {n.body && <span className="line-clamp-2 block text-[13px] text-subtle-foreground">{n.body}</span>}
                      <span className="block text-[12px] text-subtle-foreground">{timeAgo(n.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
          <Link href="/app/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-4 py-2.5 text-center text-[13px] text-muted-foreground hover:text-foreground">
            See all
          </Link>
        </div>
      )}
    </div>
  );
}
