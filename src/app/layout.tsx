import type { Metadata, Viewport } from "next";
import { appConfig } from "@/config/app.config";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { fullBrandName } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  // Link previews and search results always point at the public address.
  metadataBase: new URL(appConfig.brand.siteUrl),
  title: {
    default: fullBrandName,
    template: `%s | ${appConfig.brand.name}`,
  },
  description: appConfig.brand.shareDescription,
  applicationName: appConfig.brand.name,
  authors: [{ name: appConfig.brand.byline.studio, url: appConfig.brand.byline.url }],
  creator: appConfig.brand.byline.studio,
  // The preview image comes from app/opengraph-image.tsx and app/twitter-image.tsx,
  // and every page shares it unless the page makes its own.
  openGraph: { siteName: appConfig.brand.name, title: fullBrandName, description: appConfig.brand.shareDescription, type: "website" },
  twitter: { card: "summary_large_image", title: fullBrandName, description: appConfig.brand.shareDescription },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
