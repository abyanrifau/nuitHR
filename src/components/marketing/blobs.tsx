import { cn } from "@/lib/utils";

/**
 * Soft, heavily blurred colour blobs that sit BEHIND marketing content.
 * Colours come from --blob-1…4 in globals.css. They drift very slowly
 * (disabled with "reduce motion") and a faint grain stops the gradients
 * from banding. Never used inside the logged-in app.
 *
 * Placement keeps blobs to the sides/corners so text sits on near-black.
 */
type Placement = "hero" | "header" | "auth" | "wizard" | "cta";

interface BlobSpec {
  color: string;
  className: string;
  animation: string;
}

const LAYOUTS: Record<Placement, BlobSpec[]> = {
  hero: [
    {
      color: "var(--blob-1)",
      className: "right-[-12%] top-[4%] size-[46rem] max-sm:size-[26rem] max-sm:right-[-40%]",
      animation: "blob-drift-a 34s ease-in-out infinite",
    },
    {
      color: "var(--blob-2)",
      className: "right-[14%] top-[34%] size-[30rem] max-sm:size-[18rem] max-sm:right-[-20%]",
      animation: "blob-drift-b 28s ease-in-out infinite",
    },
    { color: "var(--blob-3)", className: "right-[-6%] bottom-[-18%] size-[34rem] max-sm:hidden", animation: "blob-drift-c 38s ease-in-out infinite" },
  ],
  header: [
    {
      color: "var(--blob-3)",
      className: "right-[-10%] top-[-30%] size-[36rem] max-sm:size-[20rem]",
      animation: "blob-drift-a 32s ease-in-out infinite",
    },
    { color: "var(--blob-1)", className: "right-[20%] top-[-40%] size-[26rem] max-sm:hidden", animation: "blob-drift-b 26s ease-in-out infinite" },
  ],
  auth: [
    {
      color: "var(--blob-1)",
      className: "left-[-18%] top-[-18%] size-[38rem] max-sm:size-[22rem]",
      animation: "blob-drift-a 36s ease-in-out infinite",
    },
    {
      color: "var(--blob-2)",
      className: "right-[-16%] bottom-[-20%] size-[34rem] max-sm:size-[20rem]",
      animation: "blob-drift-b 30s ease-in-out infinite",
    },
  ],
  wizard: [
    {
      color: "var(--blob-1)",
      className: "right-[-14%] top-[-12%] size-[40rem] max-sm:size-[22rem]",
      animation: "blob-drift-a 38s ease-in-out infinite",
    },
    { color: "var(--blob-4)", className: "left-[-18%] bottom-[-22%] size-[34rem] max-sm:hidden", animation: "blob-drift-c 32s ease-in-out infinite" },
  ],
  cta: [
    {
      color: "var(--blob-2)",
      className: "right-[-8%] top-[-20%] size-[32rem] max-sm:size-[18rem]",
      animation: "blob-drift-b 30s ease-in-out infinite",
    },
    { color: "var(--blob-4)", className: "right-[22%] bottom-[-35%] size-[24rem] max-sm:hidden", animation: "blob-drift-a 36s ease-in-out infinite" },
  ],
};

// Fine grain (SVG noise) laid over the blobs.
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

export function Blobs({ placement, className }: { placement: Placement; className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}>
      {LAYOUTS[placement].map((b, i) => (
        <div
          key={i}
          className={cn("absolute rounded-full will-change-transform", b.className)}
          style={{
            background: `radial-gradient(circle at 50% 50%, ${b.color} 0%, transparent 68%)`,
            filter: "blur(140px)",
            opacity: "var(--blob-opacity)",
            animation: b.animation,
          }}
        />
      ))}
      <div className="absolute inset-0 mix-blend-overlay" style={{ backgroundImage: GRAIN, opacity: "var(--grain-opacity)" }} />
    </div>
  );
}
