import { OG_ALT, renderHarborCard } from "@/lib/og/harbor-card";

// Same card as the Open Graph image, for X (Twitter) link previews.
export const alt = OG_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderHarborCard();
}
