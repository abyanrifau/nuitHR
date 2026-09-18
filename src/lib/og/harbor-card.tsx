import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { appConfig } from "@/config/app.config";

/**
 * The link preview card (1200 x 630) shown when someone shares a Harbor link
 * on WhatsApp, Instagram, Discord, iMessage and so on. Used by both
 * app/opengraph-image.tsx and app/twitter-image.tsx.
 *
 * The soft colour background is a PNG made by scripts/og-background.mjs,
 * because the image renderer can't blur. Text is drawn on top in the real
 * brand fonts from public/fonts.
 */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = `${appConfig.brand.name} ${appConfig.brand.byline.text}: HR and payroll for businesses in the Maldives.`;

export async function renderHarborCard() {
  const root = process.cwd();
  const [background, display, body] = await Promise.all([
    readFile(join(root, "public/og/harbor-bg.png"), "base64"),
    readFile(join(root, "public/fonts/AlteHaasGroteskBold.ttf")),
    readFile(join(root, "public/fonts/HelveticaNeue-Light.otf")),
  ]);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", backgroundColor: "#000000" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the image renderer only understands plain img */}
        <img src={`data:image/png;base64,${background}`} width={1200} height={630} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
        <div style={{ position: "absolute", top: 0, left: 80, bottom: 0, right: 80, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontFamily: "Alte Haas Grotesk", fontWeight: 700, fontSize: 196, lineHeight: 1, letterSpacing: "-0.04em", color: "#ffffff" }}>
            {`${appConfig.brand.name}.`}
          </div>
          <div style={{ fontFamily: "Helvetica Neue", fontWeight: 300, fontSize: 38, lineHeight: 1.25, marginTop: 28, color: "rgba(255,255,255,0.7)" }}>
            HR and payroll for businesses in the Maldives.
          </div>
        </div>
        <div style={{ position: "absolute", left: 80, bottom: 56, fontFamily: "Helvetica Neue", fontWeight: 300, fontSize: 26, color: "rgba(255,255,255,0.5)" }}>
          {appConfig.brand.byline.text}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Alte Haas Grotesk", data: display, weight: 700, style: "normal" },
        { name: "Helvetica Neue", data: body, weight: 300, style: "normal" },
      ],
    },
  );
}
