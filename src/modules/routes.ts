/**
 * Admin pages that exist so far. Checklist items and menu links only
 * become clickable once their page is built, so nobody lands on a
 * "page not found". Each build phase adds its pages here.
 */
export const AVAILABLE_ROUTES = new Set<string>(["/app", "/app/settings/modules"]);

export function isRouteAvailable(href: string): boolean {
  return AVAILABLE_ROUTES.has(href.split("?")[0]);
}
