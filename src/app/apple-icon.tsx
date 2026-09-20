import { renderHarborMark } from "@/lib/og/harbor-mark";

// The icon iPhones and iPads use when Harbor is added to the home screen.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderHarborMark(size.width, { padding: 0.26 });
}
