// Builds labelled Old | New side-by-side images (desktop light + phone light) with sharp.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "side-by-side");
fs.mkdirSync(OUT, { recursive: true });
const PAGES = ["home", "home-lowest-rated", "researcher", "stats", "leaderboard", "guide", "extension", "about", "login", "register"];
const MAX_H = 2500, GAP = 40, LABEL = 70, BG = { r: 255, g: 255, b: 255, alpha: 1 };
const label = (text, w) => Buffer.from(`<svg width="${w}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="48" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`);
const report = [];
for (const page of PAGES) for (const w of [1440, 390]) {
  const name = `${page}-${w}-light.png`;
  const parts = [];
  for (const side of ["old", "new"]) {
    const meta = await sharp(path.join(DIR, side, name)).metadata();
    const h = Math.min(meta.height, MAX_H);
    // Desktop shots are scaled to 1100px wide so the pair stays a sensible size.
    const scale = w === 1440 ? 1100 / meta.width : 1;
    const buf = await sharp(path.join(DIR, side, name)).extract({ left: 0, top: 0, width: meta.width, height: h })
      .resize(Math.round(meta.width * scale)).png().toBuffer();
    const m = await sharp(buf).metadata();
    parts.push({ buf, width: m.width, height: m.height, side });
  }
  const colW = Math.max(...parts.map((p) => p.width));
  const height = LABEL + Math.max(...parts.map((p) => p.height));
  const width = colW * 2 + GAP;
  const comps = [];
  parts.forEach((p, i) => {
    const x = i * (colW + GAP);
    comps.push({ input: label(p.side === "old" ? "Old" : "New", colW), left: x, top: 0 });
    comps.push({ input: p.buf, left: x, top: LABEL });
  });
  const file = `${page}-${w === 1440 ? "desktop" : "phone"}.png`;
  let img = sharp({ create: { width, height, channels: 4, background: BG } }).composite(comps);
  let out = await img.png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  if (out.length > 3e6) out = await sharp(out).jpeg({ quality: 85 }).toBuffer();
  fs.writeFileSync(path.join(OUT, file), out);
  report.push(`${file} ${width}x${height} ${(out.length / 1e6).toFixed(2)}MB`);
}
console.log(report.join("\n"));
