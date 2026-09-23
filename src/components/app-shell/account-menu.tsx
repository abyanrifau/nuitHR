"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronsUpDown, House, LogOut, Smartphone, UserRound } from "lucide-react";
import { appConfig } from "@/config/app.config";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

export interface AccountMenuUser {
  name: string;
  email: string | null;
  role: string;
  avatarPath: string | null;
}

/** Your picture and name at the foot of the sidebar; opens your account links, light or dark, and sign out. */
export function AccountMenu({ user, mini = false, onNavigate }: { user: AccountMenuUser; mini?: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    onNavigate?.();
  };
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent-soft hover:text-foreground";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={mini ? `Your account: ${user.name}` : undefined}
        title={mini ? user.name : undefined}
        className={cn("flex w-full items-center rounded-lg text-left hover:bg-accent-soft", mini ? "justify-center p-1.5" : "gap-2.5 px-2 py-1.5")}
      >
        <Avatar name={user.name} path={user.avatarPath} size="sm" />
        {!mini && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{user.name}</span>
              <span className="block truncate text-[12px] text-subtle-foreground">{user.role}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 w-60 rounded-xl border border-border bg-background p-1.5 shadow-lg",
            mini ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-2",
          )}
        >
          <div className="flex items-center gap-2.5 border-b border-border px-3 pt-2 pb-3">
            <Avatar name={user.name} path={user.avatarPath} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground">{user.name}</span>
              {user.email && <span className="block truncate text-[12px] text-subtle-foreground">{user.email}</span>}
            </span>
          </div>
          <div className="py-1">
            <Link role="menuitem" href="/app/account" onClick={close} className={item}>
              <UserRound className="size-4" aria-hidden /> Your account
            </Link>
            <Link role="menuitem" href="/staff" onClick={close} className={item}>
              <Smartphone className="size-4" aria-hidden /> Staff app
            </Link>
            <Link role="menuitem" href="/" onClick={close} className={item}>
              <House className="size-4" aria-hidden /> {appConfig.brand.name} home page
            </Link>
            <div className="flex items-center justify-between px-3 py-1.5 text-sm text-muted-foreground">
              Light or dark
              <ThemeToggle />
            </div>
          </div>
          <form action={signOut} className="border-t border-border pt-1">
            <button type="submit" role="menuitem" className={item}>
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
