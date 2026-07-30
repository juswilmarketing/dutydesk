/**
 * Generate PWA icons from SVG sources in apps/web/public.
 * Run: node scripts/generate-pwa-icons.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "apps", "web", "public");

const jobs = [
  { src: "icon.svg", out: "pwa-192x192.png", size: 192 },
  { src: "icon.svg", out: "pwa-512x512.png", size: 512 },
  { src: "icon.svg", out: "apple-touch-icon.png", size: 180 },
  { src: "icon.svg", out: "favicon-32x32.png", size: 32 },
  { src: "icon-maskable.svg", out: "pwa-512x512-maskable.png", size: 512 },
];

for (const { src, out, size } of jobs) {
  const input = await readFile(path.join(publicDir, src));
  const png = await sharp(input).resize(size, size).png().toBuffer();
  await writeFile(path.join(publicDir, out), png);
  console.log(`wrote ${out} (${size}x${size})`);
}

const favicon = await sharp(await readFile(path.join(publicDir, "icon.svg")))
  .resize(32, 32)
  .png()
  .toBuffer();
await writeFile(path.join(publicDir, "favicon.ico"), favicon);
console.log("wrote favicon.ico");
