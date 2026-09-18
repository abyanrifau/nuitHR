import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF letters are drawn on the server with this library; load it as-is rather than bundling it.
  serverExternalPackages: ["@react-pdf/renderer"],
  // Lets the local dev server also be opened at 127.0.0.1 (used for testing with a second sign-in).
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      // Logo uploads (2 MB) and CSV imports (2 MB) go through server actions; leave room for form overhead.
      bodySizeLimit: "3mb",
    },
  },
  // The staff app's service worker must always be fresh, so updates reach phones straight away.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  // Old addresses from before tools were renamed keep working.
  async redirects() {
    return [
      { source: "/app/settings/modules", destination: "/app/workspace/tools", permanent: true },
      { source: "/app/settings", destination: "/app/workspace/tools", permanent: true },
      { source: "/onboarding/business", destination: "/onboarding/company", permanent: true },
      { source: "/onboarding/modules", destination: "/onboarding/tools", permanent: true },
      { source: "/onboarding/setup", destination: "/onboarding/tools", permanent: true },
      { source: "/onboarding/setup/:path*", destination: "/onboarding/tools", permanent: true },
      { source: "/onboarding/team", destination: "/onboarding/invite", permanent: true },
      { source: "/onboarding/done", destination: "/app", permanent: true },
      { source: "/portal", destination: "/staff", permanent: true },
      { source: "/portal/:path*", destination: "/staff/:path*", permanent: true },
      { source: "/features", destination: "/product", permanent: true },
      { source: "/documentation", destination: "/help", permanent: true },
      { source: "/docs", destination: "/help", permanent: true },
    ];
  },
};

export default nextConfig;
