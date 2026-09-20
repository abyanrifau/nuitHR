import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { appConfig } from "@/config/app.config";

/**
 * The square Harbor mark: the first letter of the brand name and the full
 * stop from the wordmark, in white on black, in the real brand font.
 * Used for the browser tab icon, the iPhone home screen and, through
 * /icons/[file], the Android home screen.
 */
export async function renderHarborMark(size: number, { padding = 0.22 }: { padding?: number } = {}) {
  const font = await readFile(join(process.cwd(), "public/fonts/AlteHaasGroteskBold.ttf"));
  const letter = `${appConfig.brand.name.trim().charAt(0).toUpperCase()}.`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000000",
          fontFamily: "Alte Haas Grotesk",
          fontWeight: 700,
          // Slightly above centre: the full stop sits on the baseline, so the
          // ink looks low if the text block is centred exactly.
          paddingBottom: size * 0.06,
          fontSize: size * (1 - padding * 2),
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: "#ffffff",
        }}
      >
        {letter}
      </div>
    ),
    { width: size, height: size, fonts: [{ name: "Alte Haas Grotesk", data: font, weight: 700, style: "normal" }] },
  );
}
