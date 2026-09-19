import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combines Tailwind class names, letting later ones win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Only allow redirects to paths inside this app (prevents open-redirect tricks). */
export function safeNextPath(next: unknown, fallback = "/app"): string {
  if (typeof next !== "string" || next.length > 2000) return fallback;
  // Browsers ignore tabs and line breaks in addresses and treat a backslash like "/",
  // so a tab or backslash after the first "/" could send people to another site. Refuse them.
  for (let i = 0; i < next.length; i++) {
    const code = next.charCodeAt(i);
    if (code < 32 || code === 127 || code === 92) return fallback; // control characters and backslash
  }
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Final check: resolved against this site, it must still be this site.
  const base = "https://harbor.invalid";
  try {
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
