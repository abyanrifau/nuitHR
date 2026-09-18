import { appConfig } from "@/config/app.config";

/** Where a link to Nuit Works sits. Shows up as utm_campaign in your analytics. */
export type NuitLocation = "hero" | "footer" | "login" | "app-sidebar" | "settings" | "staff-app" | "email";

/**
 * The one place every link to Nuit Works is built. Change the address or the
 * tracking parameters here and every link across the site, app and emails follows.
 */
export function nuitWorksUrl(location: NuitLocation): string {
  const url = new URL(appConfig.brand.byline.url);
  url.pathname = "/";
  url.searchParams.set("utm_source", "harbor");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", location);
  return url.toString();
}

/** "Harbor by Nuit Works", for titles and plain text. */
export const fullBrandName = `${appConfig.brand.name} ${appConfig.brand.byline.text}`;
