import type { MetadataRoute } from "next";
import { appConfig } from "@/config/app.config";
import { HELP_GUIDES, HELP_ROLES } from "@/content/help";

// The public pages, for search engines.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appConfig.brand.siteUrl;
  const pages = ["", "/product", "/pricing", "/industries", "/contact", "/help", "/signup", "/login", "/privacy", "/terms"];
  return [
    ...pages.map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly" as const, priority: p === "" ? 1 : 0.6 })),
    ...HELP_ROLES.map((r) => ({ url: `${base}/help/${r.key}`, changeFrequency: "monthly" as const, priority: 0.4 })),
    ...HELP_GUIDES.map((g) => ({ url: `${base}/help/guides/${g.slug}`, changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
}
