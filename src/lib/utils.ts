import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combines Tailwind class names, letting later ones win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Only allow redirects to paths inside this app (prevents open-redirect tricks). */
export function safeNextPath(next: unknown, fallback = "/app"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
