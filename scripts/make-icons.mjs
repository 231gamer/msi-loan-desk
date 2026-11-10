// Builds the browser icons from the company logo (Next.js App Router file conventions):
//   src/app/icon.png (512), src/app/apple-icon.png (180), src/app/favicon.ico (16, 32, 48).
// The logo is centred on a white square with a margin, never stretched.
// Usage: node scripts/make-icons.mjs [source] [outDir]   (defaults: public/brand/msi-logo-480.png, src/app)
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// sharp ships with Next.js (its image optimiser); load it through next so no new dependency is needed.
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");

const source = process.argv[2] ?? "public/brand/msi-logo-480.png";
const outDir = process.argv[3] ?? "src/app";
const MARGIN = 0.06; // share of the side left white on each edge, so the circle is not cut off

async function square(size) {
  const inner = Math.round(size * (1 - 2 * MARGIN));
  const logo = await sharp(source)
    .resize({ width: inner, height: inner, fit: "contain", background: "#ffffff", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } })
    .composite([{ input: logo, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ICO container holding PNG images (supported by every current browser).
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

await writeFile(path.join(outDir, "icon.png"), await square(512));
await writeFile(path.join(outDir, "apple-icon.png"), await square(180));
const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push({ size, data: await square(size) });
await writeFile(path.join(outDir, "favicon.ico"), ico(images));
// ICON_PREVIEW=1 also writes the small sizes as PNGs, to check they are still recognisable.
if (process.env.ICON_PREVIEW === "1") {
  for (const { size, data } of images) await writeFile(path.join(outDir, `preview-${size}.png`), data);
}
console.log(`icons written to ${outDir}`);
