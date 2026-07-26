/**
 * Colour maths. Everything here is the standard WCAG 2.x definition, computed
 * locally — no colour service, no network.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.color) return;

  /* ---------------------------------------------------------------- parsing */

  const parseCache = new Map();

  /**
   * Parse any computed-style colour into {r,g,b,a} with 0-255 channels.
   * Computed styles normalise to rgb()/rgba()/color(srgb ...) in practice, but
   * modern engines can also hand back oklab()/lab(); those are converted so a
   * page using them is measured rather than skipped.
   */
  function parse(input) {
    if (!input) return null;
    const str = String(input).trim();
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (parseCache.has(str)) return parseCache.get(str);

    let out = null;
    let m;

    if ((m = str.match(/^rgba?\(([^)]+)\)$/i))) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean);
      if (parts.length >= 3) {
        out = {
          r: channel(parts[0]),
          g: channel(parts[1]),
          b: channel(parts[2]),
          a: parts.length > 3 ? alpha(parts[3]) : 1,
        };
      }
    } else if ((m = str.match(/^#([0-9a-f]{3,8})$/i))) {
      out = fromHex(m[1]);
    } else if ((m = str.match(/^color\(srgb\s+([^)]+)\)$/i))) {
      const parts = m[1].split(/[\s/]+/).filter(Boolean);
      out = {
        r: clamp255(parseFloat(parts[0]) * 255),
        g: clamp255(parseFloat(parts[1]) * 255),
        b: clamp255(parseFloat(parts[2]) * 255),
        a: parts.length > 3 ? alpha(parts[3]) : 1,
      };
    } else if (/^(oklab|oklch|lab|lch|hsl|hwb)/i.test(str)) {
      out = viaCanvas(str);
    }

    parseCache.set(str, out);
    return out;
  }

  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const channel = (v) => (v.includes('%') ? clamp255((parseFloat(v) / 100) * 255) : clamp255(parseFloat(v)));
  const alpha = (v) => {
    const n = v.includes('%') ? parseFloat(v) / 100 : parseFloat(v);
    return Number.isNaN(n) ? 1 : Math.max(0, Math.min(1, n));
  };

  function fromHex(hex) {
    let h = hex;
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  /** Last-resort conversion for colour spaces we do not hand-parse. */
  let ctx2d = null;
  function viaCanvas(str) {
    try {
      if (!ctx2d) {
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        ctx2d = c.getContext('2d', { willReadFrequently: true });
      }
      ctx2d.clearRect(0, 0, 1, 1);
      ctx2d.fillStyle = '#000';
      ctx2d.fillStyle = str;
      ctx2d.fillRect(0, 0, 1, 1);
      const d = ctx2d.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch {
      return null;
    }
  }

  const toHex = ({ r, g, b }) =>
    `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

  const toCss = ({ r, g, b, a = 1 }) =>
    a >= 0.999 ? toHex({ r, g, b }) : `rgba(${r}, ${g}, ${b}, ${round(a, 2)})`;

  const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;

  /* ------------------------------------------------------- WCAG luminance */

  const srgbToLinear = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  /** WCAG 2.x relative luminance. */
  function luminance({ r, g, b }) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  /** WCAG 2.x contrast ratio, 1–21. Both colours must be opaque. */
  function contrast(fg, bg) {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }

  /** Composite a translucent colour over an opaque backdrop (source-over). */
  function over(fg, bg) {
    const a = fg.a ?? 1;
    if (a >= 0.999) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    };
  }

  /** Flatten a stack of layers (index 0 = bottom-most) onto an opaque base. */
  function flatten(layers, base = { r: 255, g: 255, b: 255, a: 1 }) {
    return layers.reduce((acc, layer) => over(layer, acc), base);
  }

  /* ------------------------------------------------------ WCAG thresholds */

  /**
   * "Large text" per WCAG: 18pt (24px) regular, or 14pt (18.66px) bold.
   * Getting this wrong in either direction is the difference between a useful
   * tool and a noisy one, so weight is read as a number, not a keyword.
   */
  function threshold(fontSizePx, fontWeight) {
    const weight = normaliseWeight(fontWeight);
    const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && weight >= 700);
    return { aa: large ? 3 : 4.5, aaa: large ? 4.5 : 7, large };
  }

  function normaliseWeight(w) {
    if (typeof w === 'number') return w;
    const s = String(w || '400');
    if (s === 'bold') return 700;
    if (s === 'normal') return 400;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 400 : n;
  }

  /* -------------------------------------------- perceptual distance (Lab) */

  function toXyz({ r, g, b }) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    return {
      x: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
      y: R * 0.2126729 + G * 0.7151522 + B * 0.072175,
      z: R * 0.0193339 + G * 0.119192 + B * 0.9503041,
    };
  }

  function toLab(rgb) {
    const { x, y, z } = toXyz(rgb);
    // D65 reference white.
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x / 0.95047);
    const fy = f(y / 1.0);
    const fz = f(z / 1.08883);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  /** CIE76 ΔE — good enough to rank candidate fixes, cheap enough to run in a loop. */
  function deltaE(c1, c2) {
    const a = toLab(c1);
    const b = toLab(c2);
    return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
  }

  /* ----------------------------------------------------------- HSL bridge */

  function toHsl({ r, g, b }) {
    const R = r / 255;
    const G = g / 255;
    const B = b / 255;
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
      else if (max === G) h = ((B - R) / d + 2) / 6;
      else h = ((R - G) / d + 4) / 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function fromHsl({ h, s, l }) {
    const H = ((h % 360) + 360) % 360 / 360;
    const S = Math.max(0, Math.min(100, s)) / 100;
    const L = Math.max(0, Math.min(100, l)) / 100;
    if (S === 0) {
      const v = clamp255(L * 255);
      return { r: v, g: v, b: v, a: 1 };
    }
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
    const p = 2 * L - q;
    const hue = (t) => {
      let T = t;
      if (T < 0) T += 1;
      if (T > 1) T -= 1;
      if (T < 1 / 6) return p + (q - p) * 6 * T;
      if (T < 1 / 2) return q;
      if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
      return p;
    };
    return {
      r: clamp255(hue(H + 1 / 3) * 255),
      g: clamp255(hue(H) * 255),
      b: clamp255(hue(H - 1 / 3) * 255),
      a: 1,
    };
  }

  /* ------------------------------------------------------ fix suggestions */

  /**
   * Find the colour closest to `moving` (by ΔE) that reaches `target` contrast
   * against `fixed`, holding hue and saturation and searching lightness.
   *
   * Both directions are searched — a mid-tone grey on a mid-tone background can
   * legitimately be fixed by going lighter *or* darker, and picking whichever
   * moves less keeps the suggestion faithful to the original design intent
   * instead of always collapsing to black.
   */
  function nearestPassing(moving, fixed, target) {
    const original = { r: moving.r, g: moving.g, b: moving.b };
    if (contrast(original, fixed) >= target) {
      return { color: original, ratio: contrast(original, fixed), delta: 0, changed: false };
    }

    const hsl = toHsl(original);
    const candidates = [];

    for (const direction of [-1, 1]) {
      // Binary search lightness towards the extreme in this direction.
      let lo = hsl.l;
      let hi = direction === -1 ? 0 : 100;
      if (contrast(fromHsl({ ...hsl, l: hi }), fixed) < target) continue; // Unreachable this way.

      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (contrast(fromHsl({ ...hsl, l: mid }), fixed) >= target) hi = mid;
        else lo = mid;
      }
      const color = fromHsl({ ...hsl, l: hi });
      candidates.push({ color, ratio: contrast(color, fixed), delta: deltaE(original, color), changed: true });
    }

    if (!candidates.length) return null; // No lightness at this hue can pass.
    candidates.sort((a, b) => a.delta - b.delta);
    return candidates[0];
  }

  /**
   * Suggest both a text-colour fix and a background fix, so the user can pick
   * whichever is cheaper to apply in their design.
   */
  function suggestFix(fg, bg, target) {
    const text = nearestPassing(fg, bg, target);
    const background = nearestPassing(bg, fg, target);
    return { text, background };
  }

  LAO.color = {
    parse,
    toHex,
    toCss,
    luminance,
    contrast,
    over,
    flatten,
    threshold,
    normaliseWeight,
    deltaE,
    toHsl,
    fromHsl,
    suggestFix,
    round,
  };
})();
