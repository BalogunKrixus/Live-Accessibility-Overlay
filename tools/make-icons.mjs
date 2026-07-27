/**
 * Generates the extension icons: a rounded pointy-top hexagon with a check
 * knocked out of it, matching the supplied brand mark.
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

const BLUE = [0x4e, 0x6b, 0xf5];
const WHITE = [0xff, 0xff, 0xff];

/* --------------------------------------------------------- geometry (24u) */

const C = { x: 12, y: 12 };
const CORNER = 2.6;          // Corner radius of the hexagon.
const R = 12.05 - CORNER;    // Circumradius of the *inset* polygon.

/** Pointy-top regular hexagon: a vertex at 12 o'clock, flats left and right. */
const HEX = [90, 150, 210, 270, 330, 30].map((deg) => {
  const t = (deg * Math.PI) / 180;
  return [C.x + R * Math.cos(t), C.y - R * Math.sin(t)];
});

/** The check: short down-stroke into a long up-stroke. */
const CHECK = [
  [[7.4, 12.3], [10.7, 15.7]],
  [[10.7, 15.7], [17.0, 8.5]],
];

/* --------------------------------------------------------------- distances */

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Exact signed distance to a convex polygon: negative inside, positive
 * outside. Inside, the nearest edge plane is the answer; outside, the nearest
 * edge segment is. Subtracting a constant then rounds every corner evenly.
 */
function sdConvexPolygon(px, py, poly) {
  let inside = true;
  let maxPlane = -Infinity;
  let minEdge = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    // HEX is wound counter-clockwise in screen space (y grows downward), so the
    // outward normal is the edge rotated the other way from the usual formula.
    const nx = -ey / len;
    const ny = ex / len;
    const plane = (px - a[0]) * nx + (py - a[1]) * ny;
    if (plane > 0) inside = false;
    maxPlane = Math.max(maxPlane, plane);
    minEdge = Math.min(minEdge, distToSegment(px, py, a, b));
  }
  return inside ? maxPlane : minEdge;
}

/* --------------------------------------------------------------- rasterise */

function render(size) {
  // The check has to thicken as the icon shrinks or it disappears into the fill.
  const stroke = size >= 96 ? 2.9 : size >= 48 ? 3.2 : size >= 32 ? 3.6 : 4.0;
  const half = stroke / 2;

  const SS = 4;
  const scale = 24 / size;
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hex = 0;
      let check = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) * scale;
          const uy = (y + (sy + 0.5) / SS) * scale;

          if (sdConvexPolygon(ux, uy, HEX) - CORNER <= 0) hex++;

          let d = Infinity;
          for (const [a, b] of CHECK) d = Math.min(d, distToSegment(ux, uy, a, b));
          if (d <= half) check++;
        }
      }

      const total = SS * SS;
      const hexA = hex / total;
      if (hexA === 0) continue;

      // The check is knocked out of the hexagon, so it never spills past the
      // silhouette even where the stroke would otherwise overshoot an edge.
      const checkA = Math.min(check / total, hexA);
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        px[i + ch] = Math.round(BLUE[ch] * (1 - checkA / hexA) + WHITE[ch] * (checkA / hexA));
      }
      px[i + 3] = Math.round(hexA * 255);
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

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type 0 per scanline
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

/**
 * The store listing icon is a different asset from the toolbar icon.
 *
 * A toolbar icon should fill its box — it is tiny and needs every pixel. The
 * Web Store's image guidelines ask for the artwork at 96x96 inside a 128x128
 * frame, so icons sit on a consistent optical grid beside each other in the
 * store. Same drawing, centred with transparent padding.
 */
function padded(outer, inner) {
  const art = render(inner);
  const out = Buffer.alloc(outer * outer * 4); // Transparent by default.
  const offset = Math.round((outer - inner) / 2);
  for (let y = 0; y < inner; y++) {
    art.copy(out, ((y + offset) * outer + offset) * 4, y * inner * 4, (y + 1) * inner * 4);
  }
  return out;
}

const storeIcon = join(OUT, 'store-icon-128.png');
writeFileSync(storeIcon, encodePng(128, padded(128, 96)));
console.log(`wrote ${storeIcon}`);

/* A vector master, so the mark can be re-cut at any size. */
const hexPath = HEX.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + ' Z';
writeFileSync(join(OUT, 'mark.svg'),
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path d="${hexPath}" fill="#4E6BF5" stroke="#4E6BF5" stroke-width="${CORNER * 2}"
        stroke-linejoin="round"/>
  <path d="M7.4 12.3 L10.7 15.7 L17.0 8.5" fill="none" stroke="#FFFFFF" stroke-width="2.9"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`);
console.log(`wrote ${join(OUT, 'mark.svg')}`);
