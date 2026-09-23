import type { NextConfig } from "next";

// Profile pictures are served from Supabase storage (the public "avatars" bucket).
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHost ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/avatars/**" }] : [],
  },
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
        // Browser safety settings for every page: no framing by other sites (stops
        // click-tricks on approve and payroll buttons), no guessing file types,
        // HTTPS only, and only the phone features clock-in needs.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()" },
        ],
      },
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
