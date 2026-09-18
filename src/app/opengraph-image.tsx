import { OG_ALT, renderHarborCard } from "@/lib/og/harbor-card";

// The link preview image for every page that doesn't set its own.
export const alt = OG_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderHarborCard();
}
