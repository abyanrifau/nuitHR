import { renderHarborMark } from "@/lib/og/harbor-mark";

/**
 * Home-screen icons, drawn from the brand name so there are no image files
 * to keep in sync: /icons/192.png, /icons/512.png, /icons/180.png (iPhone),
 * /icons/maskable-512.png (extra padding for Android's rounded shapes).
 */
export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ file: "192.png" }, { file: "512.png" }, { file: "180.png" }, { file: "maskable-512.png" }];
}

export async function GET(_: Request, { params }: RouteContext<"/icons/[file]">) {
  const { file } = await params;
  const m = file.match(/^(maskable-)?(\d+)\.png$/);
  const size = m ? Number(m[2]) : 0;
  if (![180, 192, 512].includes(size)) return new Response("Not found", { status: 404 });
  return renderHarborMark(size, { padding: m?.[1] ? 0.3 : 0.22 });
}
