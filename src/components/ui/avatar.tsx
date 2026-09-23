import Image from "next/image";
import { avatarUrl, initialsOf } from "@/lib/people/avatar";
import { cn } from "@/lib/utils";

const SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 96 } as const;

/** A round profile picture, or the person's initials when there isn't one. */
export function Avatar({ name, path, size = "sm", className }: { name: string | null | undefined; path?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const px = SIZES[size];
  const url = avatarUrl(path);
  const text = size === "xs" ? "text-[9px]" : size === "sm" ? "text-[11px]" : size === "md" ? "text-xs" : size === "lg" ? "text-base" : "text-2xl";
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface-muted text-muted-foreground", text, className)}
      style={{ width: px, height: px }}
      aria-hidden={url ? undefined : true}
    >
      {url ? <Image src={url} alt={name ? `${name}` : ""} width={px} height={px} className="size-full object-cover" /> : initialsOf(name)}
    </span>
  );
}
