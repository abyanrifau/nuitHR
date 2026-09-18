/**
 * Marketing navigation. The features, pricing and help pages are built in
 * Phase 9; until then "features" points at the modules section on the
 * home page. When those pages exist, change the hrefs here (one place).
 */
export const MARKETING_LINKS = [
  { label: "features", href: "/#modules" },
  { label: "how it works", href: "/#how-it-works" },
] as const;

export const FOOTER_LINKS = [
  ...MARKETING_LINKS,
  { label: "privacy", href: "/privacy" },
  { label: "terms", href: "/terms" },
] as const;

/** Link for a module group on the features page, once that page exists (Phase 9). */
export function featuresGroupHref(groupKey: string): string | null {
  void groupKey; // becomes `/features#${groupKey}` once the features page exists
  return null;
}
