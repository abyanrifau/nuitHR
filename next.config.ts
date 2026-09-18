import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Logo uploads (2 MB) and CSV imports (2 MB) go through server actions; leave room for form overhead.
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
