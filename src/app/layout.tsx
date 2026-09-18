import type { Metadata, Viewport } from "next";
import { appConfig } from "@/config/app.config";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { siteUrl } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${appConfig.brand.name} · ${appConfig.brand.tagline}`,
    template: `%s · ${appConfig.brand.name}`,
  },
  description: appConfig.brand.description,
  applicationName: appConfig.brand.name,
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
