import { renderHarborMark } from "@/lib/og/harbor-mark";

/** Only used by scripts/make-favicon.mjs while building favicon.ico. */
export const dynamic = "force-static";

export function generateStaticParams() {
  return [] as { size: string }[];
}

export async function GET(_: Request, { params }: RouteContext<"/favicon-source/[size]">) {
  const { size } = await params;
  const n = Number(size);
  if (![16, 32, 48].includes(n)) return new Response("Not found", { status: 404 });
  return renderHarborMark(n, { padding: n === 16 ? 0.12 : 0.16 });
}
