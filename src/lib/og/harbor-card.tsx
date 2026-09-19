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
 * brand fonts from public/fonts (Alte Haas Grotesk Bold, and Helvetica Neue
 * Regular for the tagline, as on the Nuit Works card).
 */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = `${appConfig.brand.name} ${appConfig.brand.byline.text}: HR and payroll for businesses in the Maldives.`;

/** Positions in pixels. The text's visible edges line up with the Nuit Works card. */
const LAYOUT = { wordSize: 168, wordTop: 234, wordLeft: 61, tagSize: 23, tagTop: 424, tagLeft: 71 };

export async function renderHarborCard() {
  const root = process.cwd();
  const [background, display, body] = await Promise.all([
    readFile(join(root, "public/og/harbor-bg.png"), "base64"),
    readFile(join(root, "public/fonts/AlteHaasGroteskBold.ttf")),
    readFile(join(root, "public/fonts/HelveticaNeue-Roman.otf")),
  ]);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", backgroundColor: "#000000" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the image renderer only understands plain img */}
        <img src={`data:image/png;base64,${background}`} width={1200} height={630} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
        {/* Text placed to match the Nuit Works preview card (measured on its 1200 x 630 version). */}
        <div style={{ position: "absolute", top: LAYOUT.wordTop, left: LAYOUT.wordLeft, display: "flex", fontFamily: "Alte Haas Grotesk", fontWeight: 700, fontSize: LAYOUT.wordSize, lineHeight: 1, letterSpacing: "-0.03em", color: "#ffffff" }}>
          {`${appConfig.brand.name}.`}
        </div>
        <div style={{ position: "absolute", top: LAYOUT.tagTop, left: LAYOUT.tagLeft, display: "flex", fontFamily: "Helvetica Neue", fontWeight: 400, fontSize: LAYOUT.tagSize, lineHeight: 1, color: "rgba(255,255,255,0.85)" }}>
          {`HR and payroll for businesses in the Maldives. By ${appConfig.brand.byline.studio}.`}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Alte Haas Grotesk", data: display, weight: 700, style: "normal" },
        { name: "Helvetica Neue", data: body, weight: 400, style: "normal" },
      ],
    },
  );
}
