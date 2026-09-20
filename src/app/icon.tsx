import { renderHarborMark } from "@/lib/og/harbor-mark";

// The icon shown in the browser tab and in bookmarks.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return renderHarborMark(size.width);
}
