// Generates marketplace assets (icon.png, banner.png) with zero dependencies.
// PNG encoding: IHDR + IDAT (zlib deflate of filtered scanlines) + IEND, with manual CRC32.
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "assets");
fs.mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function insideRoundedRect(x, y, w, h, radius) {
  const rx = Math.min(Math.max(x, radius), w - radius);
  const ry = Math.min(Math.max(y, radius), h - radius);
  const dx = x - rx;
  const dy = y - ry;
  return dx * dx + dy * dy <= radius * radius;
}

function sparkCoverage(x, y, cx, cy, r, sharpness = 0.5) {
  const dx = Math.abs(x - cx) / r;
  const dy = Math.abs(y - cy) / r;
  return Math.pow(dx, sharpness) + Math.pow(dy, sharpness) <= 1 ? 1 : 0;
}

const INDIGO = [99, 102, 241];
const CYAN = [6, 182, 212];
const WHITE = [255, 255, 255];

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;
  const sparkR = size * 0.30;
  const smallR = size * 0.10;
  const ss = 3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          if (!insideRoundedRect(px, py, size, size, radius)) continue;
          const t = (px / size + py / size) / 2;
          const [br, bg, bb] = mix(INDIGO, CYAN, t);
          let cr = br, cg = bg, cb = bb;

          const mainSpark = sparkCoverage(px, py, cx, cy, sparkR, 0.45);
          const dotSpark = sparkCoverage(px, py, size * 0.76, size * 0.24, smallR, 0.5);
          const w = Math.min(1, mainSpark + dotSpark * 0.9);
          if (w > 0) {
            cr = Math.round(cr * (1 - w) + WHITE[0] * w);
            cg = Math.round(cg * (1 - w) + WHITE[1] * w);
            cb = Math.round(cb * (1 - w) + WHITE[2] * w);
          }
          r += cr; g += cg; b += cb; a += 255;
        }
      }
      const samples = ss * ss;
      const idx = (y * size + x) * 4;
      if (a > 0) {
        rgba[idx] = Math.round(r / (a / 255));
        rgba[idx + 1] = Math.round(g / (a / 255));
        rgba[idx + 2] = Math.round(b / (a / 255));
        rgba[idx + 3] = Math.round(a / samples);
      }
    }
  }
  return encodePng(size, size, rgba);
}

const BG_TOP = [15, 23, 42];
const BG_BOTTOM = [30, 27, 75];
const BANNER_W = 1280;
const BANNER_H = 640;

function renderBanner() {
  const rgba = Buffer.alloc(BANNER_W * BANNER_H * 4);
  const sparkR = 150;
  const cx = BANNER_W * 0.78;
  const cy = BANNER_H * 0.5;
  const ss = 2;

  for (let y = 0; y < BANNER_H; y++) {
    for (let x = 0; x < BANNER_W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const t = py / BANNER_H;
          let [cr, cg, cb] = mix(BG_TOP, BG_BOTTOM, t);

          const glow = Math.max(0, 1 - Math.hypot(px - cx, py - cy) / 420);
          cr = Math.round(cr + (CYAN[0] - cr) * glow * 0.35);
          cg = Math.round(cg + (CYAN[1] - cg) * glow * 0.35);
          cb = Math.round(cb + (CYAN[2] - cb) * glow * 0.35);

          const main = sparkCoverage(px, py, cx, cy, sparkR, 0.45);
          const s2 = sparkCoverage(px, py, BANNER_W * 0.16, BANNER_H * 0.72, 46, 0.5);
          const s3 = sparkCoverage(px, py, BANNER_W * 0.30, BANNER_H * 0.26, 30, 0.5);
          const s4 = sparkCoverage(px, py, BANNER_W * 0.55, BANNER_H * 0.82, 22, 0.5);
          const w = Math.min(1, main + s2 * 0.75 + s3 * 0.6 + s4 * 0.5);
          if (w > 0) {
            cr = Math.round(cr * (1 - w) + WHITE[0] * w);
            cg = Math.round(cg * (1 - w) + WHITE[1] * w);
            cb = Math.round(cb * (1 - w) + WHITE[2] * w);
          }
          r += cr; g += cg; b += cb;
        }
      }
      const idx = (y * BANNER_W + x) * 4;
      rgba[idx] = Math.round(r / (ss * ss));
      rgba[idx + 1] = Math.round(g / (ss * ss));
      rgba[idx + 2] = Math.round(b / (ss * ss));
      rgba[idx + 3] = 255;
    }
  }
  return encodePng(BANNER_W, BANNER_H, rgba);
}

fs.writeFileSync(path.join(outDir, "icon.png"), renderIcon(256));
fs.writeFileSync(path.join(outDir, "banner.png"), renderBanner());
console.log(`[assets] wrote ${path.join(outDir, "icon.png")} (256x256)`);
console.log(`[assets] wrote ${path.join(outDir, "banner.png")} (1280x640)`);
