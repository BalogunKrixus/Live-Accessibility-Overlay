/**
 * Icon set. Drawn on a 24px grid at a consistent 1.6px stroke so the whole set
 * reads as one family, and sized down where needed rather than redrawn.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.icons) return;

  const svg = (body, size = 16, view = 24) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 ${view} ${view}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`;

  /**
   * The brand mark: a pointy-top hexagon with a check inside it. Drawn as an
   * outline here so it sits in the same stroked family as the rest of the set;
   * the toolbar icon is the solid version of the same geometry.
   */
  const HEX = [90, 150, 210, 270, 330, 30]
    .map((deg) => {
      const t = (deg * Math.PI) / 180;
      return [12 + 9.5 * Math.cos(t), 12 - 9.5 * Math.sin(t)];
    })
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ') + ' Z';

  const CHECK = 'M8.1 12.2 L10.9 15.1 L16.2 8.9';

  const mark = (size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" focusable="false">
      <path d="${HEX}"/>
      <path d="${CHECK}"/>
    </svg>`;

  /** The same mark with the hexagon filled — used for the all-clear state. */
  const markSolid = (size = 44) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" focusable="false">
      <path d="${HEX}" fill="currentColor" fill-opacity="0.14"/>
      <path d="${CHECK}" stroke-width="2"/>
    </svg>`;

  LAO.icons = {
    mark,
    markSolid,

    // Lens glyphs -----------------------------------------------------------
    contrast: (s = 16) =>
      svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none"/>`, s),

    headings: (s = 16) =>
      svg(`<path d="M5 5v14M13 5v14M5 12h8"/><path d="M17.5 10.5l2-1.5V19"/>`, s),

    images: (s = 16) =>
      svg(`<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>
           <circle cx="9" cy="10" r="1.6"/>
           <path d="M4 16.5l4.2-3.8a1.6 1.6 0 0 1 2.2.06L14 16.2"/>
           <path d="M13.5 14.2l1.9-1.7a1.6 1.6 0 0 1 2.2.06L20.4 15"/>`, s),

    tabs: (s = 16) =>
      svg(`<path d="M4 6.5h7M4 12h11M4 17.5h5"/>
           <path d="M15.5 15.5l4.5 4.5M20 20v-3.4M20 20h-3.4" stroke-width="1.5"/>`, s),

    // Controls --------------------------------------------------------------
    chevronRight: (s = 14) => svg(`<path d="M9.5 5.5L16 12l-6.5 6.5"/>`, s),
    chevronLeft: (s = 14) => svg(`<path d="M14.5 5.5L8 12l6.5 6.5"/>`, s),
    close: (s = 16) => svg(`<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`, s),
    refresh: (s = 14) =>
      svg(`<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.5v4.2h-4.2"/>`, s),
    target: (s = 13) =>
      svg(`<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>
           <path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5"/>`, s),
    dock: (s = 16) =>
      svg(`<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M14 5v14"/>`, s),
    sun: (s = 16) =>
      svg(`<circle cx="12" cy="12" r="4.2"/>
           <path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.3 6.3L4.8 4.8M19.2 19.2l-1.5-1.5M17.7 6.3l1.5-1.5M4.8 19.2l1.5-1.5"/>`, s),
    moon: (s = 16) =>
      svg(`<path d="M20 14.4A8.6 8.6 0 0 1 9.6 4 8.6 8.6 0 1 0 20 14.4z"/>`, s),
    auto: (s = 16) =>
      svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>`, s),
    copy: (s = 13) =>
      svg(`<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>`, s),
    check: (s = 13) => svg(`<path d="M5 12.5l4.8 4.8L19 7.5"/>`, s),
  };
})();
