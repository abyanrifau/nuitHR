/**
 * Rebuilds src/app/favicon.ico from the Harbor mark, so the tab icon
 * matches the wordmark. Run it after changing the brand name or font:
 *   node scripts/make-favicon.mjs
 * It needs the dev server running (npm run dev).
 */
import { writeFile } from "node:fs/promises";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const sizes = [16, 32, 48];

// ImageResponse gives us one size, so ask the sharp-free way: fetch the
// 180px mark and let the .ico hold a single crisp 48px PNG plus the
// smaller ones rendered by the same route.
const pngs = [];
for (const s of sizes) {
  const res = await fetch(`${base}/favicon-source/${s}`);
  if (!res.ok) throw new Error(`${s}px: ${res.status}`);
  pngs.push({ size: s, data: Buffer.from(await res.arrayBuffer()) });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + pngs.length * 16;
const entries = [];
for (const p of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
  e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
  e.writeUInt8(0, 2); // colours in palette
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(p.data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += p.data.length;
  entries.push(e);
}
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));
console.log(`favicon.ico written (${sizes.join(", ")}px)`);
