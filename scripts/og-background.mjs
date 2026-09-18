// Draws the soft colour background for the link preview image
// (public/og/harbor-bg.png, 1200 x 630): black, with three heavily blurred
// blobs on the right and a fine dither so the gradients don't band.
//
// Run it again after changing the blob colours:  node scripts/og-background.mjs
// No packages needed; it writes the PNG by hand.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1200;
const H = 630;

// The site's blob colours (src/app/globals.css, --blob-1 to --blob-4).
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const blobs = [
  { c: hex("#3b2bff"), x: 1040, y: 170, r: 230, a: 0.42 },
  { c: hex("#ff4fd8"), x: 1150, y: 590, r: 220, a: 0.32 },
  { c: hex("#00c2ff"), x: 850, y: 660, r: 190, a: 0.24 },
];

// Small fixed random generator, so the grain is the same every run.
let seed = 20260919;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// Extra random grain on top of the dither. Each step adds about 90 KB, and WhatsApp
// previews want the card under about 300 KB, so it is off by default.
const GRAIN = Number(process.env.GRAIN ?? 0);

const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  const row = y * (W * 3 + 1);
  raw[row] = 0; // PNG filter: none
  for (let x = 0; x < W; x++) {
    // Keep the left side, where the text sits, near black.
    const keep = Math.min(1, Math.max(0, (x - 420) / 520));
    const fade = keep * keep * (3 - 2 * keep);
    let r = 0;
    let g = 0;
    let b = 0;
    let glow = 0;
    for (const bl of blobs) {
      const d2 = (x - bl.x) ** 2 + (y - bl.y) ** 2;
      const k = bl.a * Math.exp(-d2 / (2 * bl.r * bl.r)) * fade;
      r += bl.c[0] * k;
      g += bl.c[1] * k;
      b += bl.c[2] * k;
      glow += k;
    }
    // Stop banding: an ordered dither (compresses well, so the image stays
    // small enough for WhatsApp) plus a light random grain where there's colour.
    const dither = BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47;
    const n = dither + (glow > 0.02 ? (rand() - 0.5) * GRAIN * Math.min(1, glow * 3) : 0);
    const px = row + 1 + x * 3;
    raw[px] = Math.max(0, Math.min(255, Math.floor(r + n + 0.5)));
    raw[px + 1] = Math.max(0, Math.min(255, Math.floor(g + n + 0.5)));
    raw[px + 2] = Math.max(0, Math.min(255, Math.floor(b + n + 0.5)));
  }
}

// Minimal PNG writer.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("public/og", { recursive: true });
writeFileSync("public/og/harbor-bg.png", png);
console.log(`Wrote public/og/harbor-bg.png (${Math.round(png.length / 1024)} KB)`);
