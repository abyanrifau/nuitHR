import { ImageResponse } from "next/og";
import { appConfig } from "@/config/app.config";

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
  const maskable = Boolean(m?.[1]);
  const letter = appConfig.brand.name.trim().charAt(0).toUpperCase();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#000000" }}>
        <div style={{ display: "flex", alignItems: "baseline", color: "#ffffff", fontSize: size * (maskable ? 0.42 : 0.56), fontWeight: 700, letterSpacing: "-0.04em" }}>
          {letter}
          <span style={{ fontSize: size * (maskable ? 0.42 : 0.56) }}>.</span>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
