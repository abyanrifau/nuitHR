import type { MetadataRoute } from "next";
import { appConfig } from "@/config/app.config";

// Search engines may list the public site and careers pages, never the app itself.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/staff", "/api", "/onboarding", "/invite", "/auth", "/setup", "/two-step", "/offline"],
    },
    sitemap: `${appConfig.brand.siteUrl}/sitemap.xml`,
  };
}
