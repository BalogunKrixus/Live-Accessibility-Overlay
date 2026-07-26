/**
 * The on-page marker layer.
 *
 * Deliberately shows one thing at a time. Marking every finding at once turns
 * the page into a wall of brackets and tells you nothing about where to start —
 * so the default state is empty, and exactly one element is marked: the one the
 * user is looking at right now.
 *
 * The keyboard path is the single exception, because a route is meaningless
 * unless you can see the whole of it. It is opt-in and never on by default.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.Overlay) return;

  const { util } = LAO;
  const CULL_PAD = 300;

  class Overlay {
    constructor(root, { onSelectStep } = {}) {
      this.onSelectStep = onSelectStep || (() => {});

      this.layer = document.createElement('div');
      this.layer.className = 'lao-layer';
      // Decoration over content that is already in the accessibility tree. Every
      // finding is reachable as a real control in the panel, so duplicating them
      // here would only bloat the tree we ask authors to keep clean.
      this.layer.setAttribute('aria-hidden', 'true');

      this.pathSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.pathSvg.setAttribute('class', 'lao-path');
      this.pathSvg.setAttribute('aria-hidden', 'true');
      this.layer.appendChild(this.pathSvg);

      root.appendChild(this.layer);

      this.marker = null;      // The single focused marker, when there is one.
      this.target = null;
      this.tabSteps = [];
      this.nodes = new Map();
      this.segments = [];
      this.showTabPath = false;

      this._dirty = false;
      this._frame = 0;
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

    /* --------------------------------------------------------- single mark */

    /**
     * Mark one element and bring it into view. `tier` picks the colour;
     * `label` is the short caption shown beside the brackets.
     */
    focus(element, tier = 'fix', label = '') {
      if (!element?.isConnected) return this.clear();

      this.target = element;
      if (!this.marker) {
        this.marker = document.createElement('div');
        this.marker.className = 'lao-mk';
        this.marker.append(
          Object.assign(document.createElement('div'), { className: 'lao-mk-fill' }),
          Object.assign(document.createElement('div'), { className: 'lao-mk-frame' }),
        );
        this.caption = document.createElement('div');
        this.caption.className = 'lao-mk-badge';
        this.marker.appendChild(this.caption);
        this.layer.appendChild(this.marker);
      }

      this.marker.dataset.tier = tier;
      this.caption.textContent = util.truncate(label, 46);
      this.caption.hidden = !label;

      // Retrigger the entrance so moving between issues reads as a new mark
      // rather than the old one silently teleporting.
      this.marker.classList.remove('lao-mk--in');
      void this.marker.offsetWidth;
      this.marker.classList.add('lao-mk--in');

      this._scrollTo(element);
      this.invalidate();
    }

    clear() {
      this.target = null;
      if (this.marker) {
        this.marker.remove();
        this.marker = null;
        this.caption = null;
      }
    }

    _scrollTo(element) {
      const r = element.getBoundingClientRect();
      const margin = 120;
      const alreadyVisible = r.top >= margin && r.bottom <= innerHeight - margin;
      if (alreadyVisible) return;
      element.scrollIntoView({
        behavior: util.prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }

    /* ------------------------------------------------------- keyboard path */

    setTabPath(on, steps = []) {
      this.showTabPath = on;
      this.tabSteps = on ? steps : [];
      this._renderTabs();
      this.invalidate();
    }

    _renderTabs() {
      for (const node of this.nodes.values()) node.remove();
      this.nodes.clear();
      this.pathSvg.replaceChildren();
      this.segments = [];
      if (!this.showTabPath) return;

      const steps = this.tabSteps;
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
          this.onSelectStep(step);
        });
        this.layer.appendChild(node);
        this.nodes.set(step.index, node);
      });

      for (let i = 1; i < steps.length; i++) {
        const backward = !!steps[i].backward;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        if (backward) path.dataset.backward = 'true';

        // An arrowhead states direction outright; a travelling dash only reads
        // while it moves, which is no use in a screenshot or under reduced motion.
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrow.setAttribute('class', 'lao-arrow');
        arrow.setAttribute('d', 'M0 0 L-6 -3.4 L-6 3.4 Z');
        if (backward) arrow.dataset.backward = 'true';

        this.pathSvg.append(path, arrow);
        this.segments.push({ from: steps[i - 1], to: steps[i], path, arrow });
      }
    }

    /* ---------------------------------------------------------- positioning */

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
      const vh = innerHeight;
      const vw = innerWidth;
      const inView = (r) =>
        r.bottom > -CULL_PAD && r.top < vh + CULL_PAD &&
        r.right > -CULL_PAD && r.left < vw + CULL_PAD;

      /* Read pass. Interleaving reads with style writes forces a synchronous
         layout per element, which is what makes an overlay stutter on scroll. */
      const markRect = this.target?.isConnected ? this.target.getBoundingClientRect() : null;

      const steps = this.tabSteps;
      const stepRects = new Map();
      for (const index of this.nodes.keys()) {
        const target = steps[index - 1]?.el;
        if (!target?.isConnected) { stepRects.set(index, null); continue; }
        const r = target.getBoundingClientRect();
        stepRects.set(index, inView(r) ? r : null);
      }
      const segRects = this.segments.map((seg) => ({
        seg, a: anchor(seg.from.el), b: anchor(seg.to.el),
      }));

      /* Write pass. */
      if (this.marker) {
        if (!markRect || (markRect.width === 0 && markRect.height === 0)) {
          this.marker.style.display = 'none';
        } else {
          this.marker.style.display = '';
          this.marker.style.transform =
            `translate(${Math.round(markRect.left - 4)}px, ${Math.round(markRect.top - 4)}px)`;
          this.marker.style.width = `${Math.round(markRect.width + 8)}px`;
          this.marker.style.height = `${Math.round(markRect.height + 8)}px`;
          this.marker.dataset.flip = String(markRect.top < 34);
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
          seg.arrow.style.display = 'none';
        };
        if (!a || !b) { hide(); continue; }
        if ((a.y < -CULL_PAD && b.y < -CULL_PAD) || (a.y > vh + CULL_PAD && b.y > vh + CULL_PAD)) {
          hide();
          continue;
        }
        const { d, mid, angle, length } = curve(a, b);
        seg.path.setAttribute('d', d);
        if (length < 26) seg.arrow.style.display = 'none';
        else {
          seg.arrow.style.display = '';
          seg.arrow.setAttribute('transform', `translate(${mid.x} ${mid.y}) rotate(${angle})`);
        }
      }
    }
  }

  /* ------------------------------------------------------------- helpers */

  function anchor(el) {
    if (!el?.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left, y: r.top };
  }

  /** A gentle bow, so crossing routes stay separable by eye. */
  function curve(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return { d: `M${a.x} ${a.y}`, mid: a, angle: 0, length: 0 };

    const bend = Math.min(dist * 0.28, 46);
    const nx = -dy / dist;
    const ny = dx / dist;
    const cx = a.x + dx / 2 + nx * bend;
    const cy = a.y + dy / 2 + ny * bend;

    return {
      d: `M${round(a.x)} ${round(a.y)} Q${round(cx)} ${round(cy)} ${round(b.x)} ${round(b.y)}`,
      mid: {
        x: round(0.25 * a.x + 0.5 * cx + 0.25 * b.x),
        y: round(0.25 * a.y + 0.5 * cy + 0.25 * b.y),
      },
      angle: round((Math.atan2(dy, dx) * 180) / Math.PI),
      length: dist,
    };
  }

  const round = (n) => Math.round(n * 10) / 10;

  LAO.Overlay = Overlay;
})();
