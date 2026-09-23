/** What each person chose in the sidebar: sections folded away, and icons only. Kept in a cookie so the first paint is right. */
export interface NavPrefs {
  closed: string[];
  mini: boolean;
}

export const NAV_COOKIE = "harbor_nav";

/** Reads the saved choices, ignoring ones saved by someone else on this browser. */
export function readNavPrefs(raw: string | undefined, userId: string): NavPrefs {
  try {
    const v = JSON.parse(decodeURIComponent(raw ?? "")) as { u?: string; c?: unknown; m?: unknown };
    if (v.u !== userId) return { closed: [], mini: false };
    return { closed: Array.isArray(v.c) ? v.c.filter((x): x is string => typeof x === "string").slice(0, 20) : [], mini: v.m === 1 };
  } catch {
    return { closed: [], mini: false };
  }
}

export function navPrefsCookie(userId: string, prefs: NavPrefs): string {
  const value = encodeURIComponent(JSON.stringify({ u: userId, c: prefs.closed, m: prefs.mini ? 1 : 0 }));
  return `${NAV_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
}
