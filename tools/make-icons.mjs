/**
 * Generates the extension icons from the same aperture geometry the panel uses,
 * so the toolbar mark and the in-panel mark are literally the same drawing.
 *
 *   node tools/make-icons.mjs
 *
 * Rasterises with 4x4 supersampled signed-distance coverage — no canvas, no
 * dependencies — and writes 8-bit RGBA PNGs.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

/* ------------------------------------------------------------------ colour */

const INK = [0x14, 0x16, 0x1c];
const AQUA = [0x5f, 0xdb, 0xe6];

/* ------------------------------------------------------------- geometry (24u) */

const C = { x: 12, y: 12 };
const RING_R = 9.25;

const HEX = [
  [12, 7], [16.33, 9.5], [16.33, 14.5], [12, 17], [7.67, 14.5], [7.67, 9.5],
];

const BLADES = [
  [[12, 7], [16.98, 4.13]],
  [[7.67, 14.5], [2.70, 11.62]],
  [[16.33, 14.5], [16.32, 20.25]],
];

const hexEdges = HEX.map((p, i) => [p, HEX[(i + 1) % HEX.length]]);

/* --------------------------------------------------------------- distances */

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const distToRing = (px, py) => Math.abs(Math.hypot(px - C.x, py - C.y) - RING_R);

/** Signed distance to a rounded square covering the whole 24u tile. */
function roundedRectSD(px, py, inset, radius) {
  const half = 12 - inset;
  const qx = Math.abs(px - 12) - (half - radius);
  const qy = Math.abs(py - 12) - (half - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

/* --------------------------------------------------------------- rasterise */

function render(size) {
  // Below 40px the blades and the hexagon collide into mush; drop the blades
  // and fatten the remaining strokes so the mark stays a legible aperture.
  const detailed = size >= 40;
  const stroke = detailed ? 1.45 : size >= 28 ? 1.9 : 2.3;
  const half = stroke / 2;

  const SS = 4;                       // supersamples per axis
  const scale = 24 / size;            // pixel -> 24u
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) * scale;
          const uy = (y + (sy + 0.5) / SS) * scale;

          if (roundedRectSD(ux, uy, 0.35, size >= 48 ? 5.4 : 4.6) <= 0) bg++;

          let d = distToRing(ux, uy);
          for (const [a, b] of hexEdges) d = Math.min(d, distToSegment(ux, uy, a, b));
          if (detailed) {
            for (const [a, b] of BLADES) d = Math.min(d, distToSegment(ux, uy, a, b));
          }
          if (d <= half) fg++;
        }
      }

      const total = SS * SS;
      const bgA = bg / total;
      const fgA = fg / total;
      const i = (y * size + x) * 4;

      // Source-over: aqua mark on an ink tile, both over transparency.
      // Composite premultiplied, then unpremultiply for straight-alpha PNG.
      const outA = fgA + bgA * (1 - fgA);
      if (outA === 0) continue;

      for (let ch = 0; ch < 3; ch++) {
        const premult = AQUA[ch] * fgA + INK[ch] * bgA * (1 - fgA);
        px[i + ch] = Math.round(Math.max(0, Math.min(255, premult / outA)));
      }
      px[i + 3] = Math.round(outA * 255);
    }
  }
  return px;
}

/* ------------------------------------------------------------- PNG encoder */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // truecolour + alpha
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // One filter byte (type 0) per scanline.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------- run */

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
