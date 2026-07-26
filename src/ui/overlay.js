/**
 * The on-page marker layer.
 *
 * Markers are positioned in viewport coordinates and re-read from the live
 * elements on every frame that scroll/resize dirties, which keeps them glued to
 * sticky headers, transformed containers and virtualised lists — all the places
 * a one-shot absolute-positioned overlay drifts.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.Overlay) return;

  const { util } = LAO;
  const CULL_PAD = 300;

  class Overlay {
    constructor(root, { onSelect } = {}) {
      this.onSelect = onSelect || (() => {});

      this.layer = document.createElement('div');
      this.layer.className = 'lao-layer';
      // The marker layer is decoration over content that is already in the
      // accessibility tree; issues are reachable as real controls in the panel,
      // so exposing several hundred duplicate buttons here would only bloat the
      // very tree we are asking authors to keep clean.
      this.layer.setAttribute('aria-hidden', 'true');

      this.pathSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.pathSvg.setAttribute('class', 'lao-path');
      this.pathSvg.setAttribute('aria-hidden', 'true');
      this.layer.appendChild(this.pathSvg);

      root.appendChild(this.layer);

      this.markers = new Map(); // id -> { issue, el, frame } — mounted only
      this.issueList = [];      // every active issue, mounted or not
      this.nodes = new Map();   // tab index -> element
      this.segments = [];
      this.data = { contrast: [], images: [], headings: [], tabs: { steps: [], issues: [] } };
      this.lenses = { contrast: true, headings: true, images: true, tabs: false };
      this.selectedId = null;

      this._frame = 0;
      this._dirty = false;
      this._onScroll = () => this.invalidate();
      addEventListener('scroll', this._onScroll, { passive: true, capture: true });
      addEventListener('resize', this._onScroll, { passive: true });
      this._tick = this._tick.bind(this);
    }

    destroy() {
      removeEventListener('scroll', this._onScroll, { capture: true });
      removeEventListener('resize', this._onScroll);
      cancelAnimationFrame(this._frame);
      this.layer.remove();
    }

    setLenses(lenses) {
      this.lenses = lenses;
      this.render();
    }

    setData(data) {
      this.data = data;
      this.render();
    }

    select(id) {
      this.selectedId = id;
      for (const [key, entry] of this.markers) {
        entry.el.dataset.selected = String(key === id);
        entry.el.dataset.dim = String(!!id && key !== id);
      }
      this.invalidate();
    }

    /* ------------------------------------------------------------ rendering */

    /** Markers currently eligible to appear, given which lenses are on. */
    activeIssues() {
      const { contrast = [], images = [], headings = [] } = this.data;
      const out = [];
      if (this.lenses.contrast) out.push(...contrast);
      if (this.lenses.images) out.push(...images);
      // Heading problems are marked on the page too, so the outline and the
      // page agree, but only the ones that are actually a problem.
      if (this.lenses.headings) out.push(...headings.filter((h) => h.rect && h.element));
      return out.filter((i) => i.element && i.element.isConnected);
    }

    /**
     * Markers are virtualised: the element for an issue is only in the DOM
     * while that issue is near the viewport. A page with a thousand findings
     * would otherwise put several thousand nodes in the shadow root and read a
     * rect for each one on every scroll frame.
     */
    render() {
      this.issueList = this.activeIssues();
      const wanted = new Set(this.issueList.map((i) => i.id));

      for (const [id, entry] of this.markers) {
        if (!wanted.has(id)) {
          entry.el.remove();
          this.markers.delete(id);
        }
      }

      this._renderTabs();
      this.invalidate();
    }

    _createMarker(id, issue) {
      const el = document.createElement('div');
      el.className = 'lao-mk';
      el.dataset.sev = issue.severity || 'notice';
      el.dataset.selected = String(this.selectedId === id);
      el.dataset.dim = String(!!this.selectedId && this.selectedId !== id);

      const fill = document.createElement('div');
      fill.className = 'lao-mk-fill';

      const frame = document.createElement('div');
      frame.className = 'lao-mk-frame';

      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'lao-mk-badge';
      badge.tabIndex = -1; // Reachable by pointer; the panel is the keyboard path.
      badge.innerHTML =
        `<span class="lao-mk-meter">${meterGlyph(issue.severity)}</span>` +
        `<span class="lao-mk-metric">${escape(shortMetric(issue))}</span>`;

      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onSelect(issue);
      });

      el.append(fill, frame, badge);
      el.addEventListener('pointerenter', () => { el.dataset.hover = 'true'; });
      el.addEventListener('pointerleave', () => { el.dataset.hover = 'false'; });
      badge.addEventListener('pointerenter', () => { el.dataset.hover = 'true'; });

      this.layer.appendChild(el);
      return { issue, el, frame, badge };
    }

    _renderTabs() {
      // Clear previous tab layer content.
      for (const node of this.nodes.values()) node.remove();
      this.nodes.clear();
      this.pathSvg.replaceChildren();
      this.segments = [];

      if (!this.lenses.tabs) return;

      const steps = this.data.tabs.steps || [];
      steps.forEach((step) => {
        if (!step.el?.isConnected) return;
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'lao-node';
        node.tabIndex = -1;
        node.textContent = String(step.index);
        if (step.offCanvas) node.dataset.flag = 'critical';
        else if (step.backward) node.dataset.flag = 'true';
        node.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.onSelect({ ...step, lens: 'tabs', id: step.id });
        });
        this.layer.appendChild(node);
        this.nodes.set(step.index, node);
      });

      for (let i = 1; i < steps.length; i++) {
        const backward = !!steps[i].backward;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // Backward segments are dashed as well as differently coloured, so the
        // distinction survives colour blindness and greyscale screenshots.
        if (backward) path.dataset.backward = 'true';

        // An arrowhead at the midpoint states the direction outright. A
        // travelling dash only reads while it is moving, which is no use in the
        // screenshot someone actually shares.
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrow.setAttribute('class', 'lao-arrow');
        arrow.setAttribute('d', 'M0 0 L-6 -3.4 L-6 3.4 Z');
        if (backward) arrow.dataset.backward = 'true';

        this.pathSvg.append(path, arrow);
        this.segments.push({ from: steps[i - 1], to: steps[i], path, arrow });
      }
    }

    /* -------------------------------------------------------- positioning */

    invalidate() {
      if (this._dirty) return;
      this._dirty = true;
      this._frame = requestAnimationFrame(this._tick);
    }

    _tick() {
      this._dirty = false;
      this._position();
    }

    _position() {
      const vw = innerWidth;
      const vh = innerHeight;
      const inView = (r) =>
        r.bottom > -CULL_PAD && r.top < vh + CULL_PAD &&
        r.right > -CULL_PAD && r.left < vw + CULL_PAD;

      /* Pass 1 — read every rect, touching no styles.
         Interleaving reads and writes forces a synchronous layout per marker,
         which is the difference between a smooth scroll and a locked tab on a
         page with hundreds of findings. */
      const measured = [];
      for (const issue of this.issueList || []) {
        const target = issue.element;
        if (!target?.isConnected) continue;
        const r = target.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (!inView(r)) continue;
        measured.push({ issue, r });
      }

      const steps = this.data.tabs.steps || [];
      const stepRects = new Map();
      for (const [index, node] of this.nodes) {
        const target = steps[index - 1]?.el;
        if (!target?.isConnected) { stepRects.set(index, null); continue; }
        const r = target.getBoundingClientRect();
        stepRects.set(index, inView(r) ? r : null);
        void node;
      }

      const segRects = this.segments.map((seg) => ({
        seg,
        a: anchor(seg.from.el),
        b: anchor(seg.to.el),
      }));

      /* Pass 2 — mount, unmount and write, reading nothing. */
      const live = new Set();
      for (const { issue, r } of measured) {
        live.add(issue.id);
        let entry = this.markers.get(issue.id);
        if (!entry) {
          entry = this._createMarker(issue.id, issue);
          this.markers.set(issue.id, entry);
        } else {
          entry.issue = issue;
        }
        const { el } = entry;
        // Inflate slightly so the brackets sit just outside the text, not on it.
        el.style.transform = `translate(${Math.round(r.left - 3)}px, ${Math.round(r.top - 3)}px)`;
        el.style.width = `${Math.round(r.width + 6)}px`;
        el.style.height = `${Math.round(r.height + 6)}px`;
        el.dataset.flip = String(r.top < 26);
      }

      // Anything that scrolled out of range leaves the DOM entirely.
      for (const [id, entry] of this.markers) {
        if (!live.has(id)) {
          entry.el.remove();
          this.markers.delete(id);
        }
      }

      for (const [index, node] of this.nodes) {
        const r = stepRects.get(index);
        if (!r) { node.style.display = 'none'; continue; }
        node.style.display = '';
        node.style.left = `${Math.round(r.left)}px`;
        node.style.top = `${Math.round(r.top)}px`;
        node.dataset.flip = String(r.top < 26);
      }

      for (const { seg, a, b } of segRects) {
        const hide = () => {
          seg.path.removeAttribute('d');
          seg.arrow.removeAttribute('transform');
          seg.arrow.style.display = 'none';
        };
        if (!a || !b) { hide(); continue; }
        const offscreen =
          (a.y < -CULL_PAD && b.y < -CULL_PAD) || (a.y > vh + CULL_PAD && b.y > vh + CULL_PAD);
        if (offscreen) { hide(); continue; }

        const { d, mid, angle, length } = curve(a, b);
        seg.path.setAttribute('d', d);
        // On a very short hop the arrow would be bigger than the line itself.
        if (length < 26) {
          seg.arrow.style.display = 'none';
        } else {
          seg.arrow.style.display = '';
          seg.arrow.setAttribute('transform', `translate(${mid.x} ${mid.y}) rotate(${angle})`);
        }
      }
    }

    /* ------------------------------------------------------------- effects */

    /** Scroll an element into view and ring it once, so the eye can find it. */
    reveal(element) {
      if (!element?.isConnected) return;
      const reduced = util.prefersReducedMotion();
      element.scrollIntoView({
        behavior: reduced ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      });

      const draw = () => {
        const r = element.getBoundingClientRect();
        const ring = document.createElement('div');
        ring.className = 'lao-pulse';
        ring.style.left = `${r.left - 4}px`;
        ring.style.top = `${r.top - 4}px`;
        ring.style.width = `${r.width + 8}px`;
        ring.style.height = `${r.height + 8}px`;
        this.layer.appendChild(ring);
        setTimeout(() => ring.remove(), 1300);
        this.invalidate();
      };

      // Let the smooth scroll land before drawing, so the ring is not left behind.
      if (reduced) draw();
      else setTimeout(draw, 320);
    }
  }

  /* ------------------------------------------------------------- helpers */

  function anchor(el) {
    if (!el?.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left, y: r.top };
  }

  /**
   * A gentle S-curve rather than a straight line: it makes crossing paths
   * separable by eye, and reads as a route rather than a wireframe connector.
   */
  function curve(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      return { d: `M${a.x} ${a.y}`, mid: a, angle: 0, length: 0 };
    }

    const bend = Math.min(dist * 0.28, 46);
    // Bow perpendicular to the travel direction.
    const nx = -dy / dist;
    const ny = dx / dist;
    const cx = a.x + dx / 2 + nx * bend;
    const cy = a.y + dy / 2 + ny * bend;

    // Quadratic Bézier at t=0.5, and its tangent (which is simply b - a).
    const mid = { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y };
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    return {
      d: `M${round(a.x)} ${round(a.y)} Q${round(cx)} ${round(cy)} ${round(b.x)} ${round(b.y)}`,
      mid: { x: round(mid.x), y: round(mid.y) },
      angle: round(angle),
      length: dist,
    };
  }

  const round = (n) => Math.round(n * 10) / 10;

  /** Three segments, filled by rank — the same glyph the panel uses. */
  function meterGlyph(severity) {
    const filled = { critical: 3, warning: 2, notice: 1 }[severity] || 1;
    return Array.from({ length: 3 }, (_, i) => `<i data-on="${i < filled}"></i>`).join('');
  }

  /** The one number worth showing before the user asks for detail. */
  function shortMetric(issue) {
    if (issue.lens === 'contrast') {
      if (issue.unmeasurable) return issue.unmeasurable === 'gradient' ? 'gradient' : 'image bg';
      return `${LAO.color.round(issue.ratio, 2)}:1 · needs ${issue.required}`;
    }
    if (issue.lens === 'images') return issue.title || 'alt text';
    if (issue.lens === 'headings') {
      const p = issue.problems?.[0];
      return p ? p.label : `H${issue.level}`;
    }
    return issue.title || '';
  }

  const escape = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
    );

  LAO.Overlay = Overlay;
  LAO.overlayHelpers = { shortMetric, escape };
})();
