import type { MetadataRoute } from "next";
import { appConfig } from "@/config/app.config";

/** Lets staff add the app to their phone's home screen. It opens straight into the staff app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.brand.name,
    short_name: appConfig.brand.shortName,
    description: appConfig.brand.description,
    id: "/staff",
    start_url: "/staff",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
