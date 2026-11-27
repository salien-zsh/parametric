// A Fusion-style value box drawn beside a feature on the model: the offset of
// a plane, an extrusion depth, a fillet radius. It can be dragged sideways to
// change the value, typed into (units and expressions included) and opened as a
// small menu. The leader dot marks the geometry the value belongs to.

import type { Vec3 } from '../math/vec';
import { add, normalize } from '../math/vec';
import { formatNumber, UNIT_SYSTEMS } from '../model/units';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { openMenu, type MenuItem } from '../ui/menu';
import { type UnitContext, parseParam } from './pm';
import type { App } from './app';
import { tr } from '../i18n';

export interface CanvasValueSpec {
  /** World point the value belongs to; the box is placed beside it. */
  anchor: Vec3;
  /** Where the arrow starts (e.g. the sketch plane), for the arrow indicator. */
  arrowFrom?: Vec3 | null;
  /** Shift-dragging the handle changes this taper angle instead of the value. */
  taper?: { value: number; min: number; max: number; onChange: (value: number) => void };
  /** 'taper' draws a small curved handle whose drag changes an angle. */
  style?: 'taper';
  /** Direction the value grows in (world). Null: drag vertically on screen. */
  axis?: Vec3 | null;
  /** Value in model units (mm or degrees). */
  value: number;
  kind: 'length' | 'angle';
  label: string;
  min?: number;
  max?: number;
  /** Applies a value to the feature (live while dragging, once when typed). */
  onChange: (value: number) => void;
  /** Entries of the small menu; omit for no menu button. */
  menu?: () => MenuItem[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Value text as Fusion shows it: number, then the document's length unit. */
export function formatCanvasValue(value: number, kind: CanvasValueSpec['kind'], ctx: UnitContext): string {
  if (kind === 'angle') return `${formatNumber(value, Math.max(0, ctx.decimals - 1))}°`;
  const u = UNIT_SYSTEMS[ctx.units];
  return `${formatNumber(value / u.scale, ctx.decimals)} ${u.length}`;
}

/** Reads typed text (a number with an optional unit, or an expression) into a value. */
export function parseCanvasValue(text: string, kind: CanvasValueSpec['kind'], ctx: UnitContext): number | null {
  const s = text.trim();
  if (!s) return null;
  const r = parseParam(s, kind, ctx, true);
  return r.ok && Number.isFinite(r.num) ? r.num : null;
}

export class CanvasValueHandle {
  private spec: CanvasValueSpec;
  private readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly leader: SVGSVGElement;
  private readonly line: SVGLineElement;
  private readonly arrow: SVGPolygonElement;
  private readonly arc: SVGPathElement;
  private readonly arcHead: SVGPolygonElement;
  private readonly dot: HTMLElement;
  private drag: { id: number; sx: number; sy: number; start: number; dx: number; dy: number; len2: number; screen: boolean } | null = null;
  private timer = 0;
  private pending: number | null = null;
  private lastApply = 0;
  private composing = false;
  private valueAtFocus = 0;
  private disposed = false;

  constructor(private app: App, spec: CanvasValueSpec) {
    this.spec = spec;
    this.leader = document.createElementNS(SVG_NS, 'svg');
    this.leader.setAttribute('class', 'cv-leader');
    this.leader.setAttribute('aria-hidden', 'true');
    this.line = document.createElementNS(SVG_NS, 'line');
    this.line.setAttribute('class', 'cv-line');
    this.arrow = document.createElementNS(SVG_NS, 'polygon');
    this.arrow.setAttribute('class', 'cv-arrow');
    this.arc = document.createElementNS(SVG_NS, 'path');
    this.arc.setAttribute('class', 'cv-arc');
    this.arcHead = document.createElementNS(SVG_NS, 'polygon');
    this.arcHead.setAttribute('class', 'cv-arc-head');
    this.leader.append(this.line, this.arrow, this.arc, this.arcHead);
    this.dot = h('div', { class: 'cv-dot', 'aria-hidden': 'true' });

    const grip = h('span', {
      class: 'cv-grip', 'aria-hidden': 'true', title: tr("Drag to change the value"),
    }, icon('grip', 14));
    this.input = h('input', {
      class: 'cv-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
      spellcheck: 'false', 'aria-label': tr("{0} on the model", [spec.label]),
    }) as HTMLInputElement;
    this.menuBtn = h('button', {
      class: 'cv-menu', type: 'button', 'aria-label': tr("Value options"), title: tr("Value options"), 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    }, icon('more', 14)) as HTMLButtonElement;
    this.el = h('div', { class: 'cv-value', role: 'group', 'aria-label': spec.label }, grip, this.input, this.menuBtn);
    this.input.inputMode = spec.min !== undefined && spec.min >= 0 ? 'decimal' : 'text';

    app.viewport.root.append(this.leader, this.dot, this.el);
    this.bind(grip);
    this.writeValue(spec.value);
    this.updateMenu();
    this.position();
  }

  /** Updates the value shown (the panel regenerates it after every rebuild). */
  set(spec: CanvasValueSpec) {
    if (this.disposed) return;
    const old = this.spec;
    this.spec = spec;
    this.input.setAttribute('aria-label', tr("{0} on the model", [spec.label]));
    this.el.setAttribute('aria-label', spec.label);
    this.input.inputMode = spec.min !== undefined && spec.min >= 0 ? 'decimal' : 'text';
    // Never overwrite what is being typed or dragged.
    if (document.activeElement !== this.input && !this.drag) this.writeValue(spec.value);
    if (old.menu !== spec.menu) this.updateMenu();
    this.position();
  }

  position() {
    if (this.disposed) return;
    const cam = this.app.renderer.camera;
    const [x, y, z] = cam.project(this.spec.anchor);
    const w = cam.width, hgt = cam.height;
    // Behind the camera (or past the far plane): the handle has no anchor.
    if (!Number.isFinite(x) || !Number.isFinite(y) || z < -1 || z > 1) {
      this.el.hidden = true;
      this.dot.hidden = true;
      this.leader.style.display = 'none';
      return;
    }
    this.el.hidden = false;
    this.dot.hidden = false;
    this.leader.style.display = '';
    if (this.spec.style === 'taper') {
      this.line.style.display = 'none';
      this.arrow.style.display = 'none';
      this.arc.style.display = '';
      this.arcHead.style.display = '';
      const r = 17;
      const a0 = -Math.PI * 0.78, a1 = -Math.PI * 0.08;
      const sx = x + r * Math.cos(a0), sy = y + r * Math.sin(a0);
      const ex = x + r * Math.cos(a1), ey = y + r * Math.sin(a1);
      this.arc.setAttribute('d', `M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`);
      const ux = -Math.sin(a1), uy = Math.cos(a1);
      this.arcHead.setAttribute('points', [
        `${ex},${ey}`,
        `${ex - ux * 9 - uy * 5},${ey - uy * 9 + ux * 5}`,
        `${ex - ux * 9 + uy * 5},${ey - uy * 9 - ux * 5}`,
      ].join(' '));
      const tipX = ex, tipY = ey;
      this.line.setAttribute('x1', String(tipX));
      this.line.setAttribute('y1', String(tipY));
      this.line.setAttribute('x2', String(tipX));
      this.line.setAttribute('y2', String(tipY));
      const bw0 = this.el.offsetWidth || 128, bh0 = this.el.offsetHeight || 26;
      // Place the angle box below-left of the arrow, clear of the floating panel.
      let left0 = Math.max(4, Math.min(w - bw0 - 4, x - 110));
      let top0 = Math.max(4, Math.min(hgt - bh0 - 4, y + 22));
      const taperPanel = document.querySelector<HTMLElement>('.panel-layer .pm');
      if (taperPanel && !taperPanel.hidden) {
        const root = this.app.shell.viewport.getBoundingClientRect();
        const pr = taperPanel.getBoundingClientRect();
        const px = pr.left - root.left, py = pr.top - root.top;
        if (left0 < px + pr.width && left0 + bw0 > px && top0 < py + pr.height && top0 + bh0 > py) {
          left0 = px - bw0 - 8 >= 4 ? px - bw0 - 8 : Math.max(4, w - bw0 - 4);
          if (left0 < px + pr.width && left0 + bw0 > px) top0 = Math.min(hgt - bh0 - 4, py + pr.height + 8);
        }
      }
      this.el.style.left = `${left0}px`;
      this.el.style.top = `${top0}px`;
      this.dot.style.left = `${x}px`;
      this.dot.style.top = `${y}px`;
      this.dot.hidden = true;
      return;
    }
    this.arc.style.display = 'none';
    this.arcHead.style.display = 'none';
    // The indicator is an arrow from the sketch plane to the handle when the
    // feature gives a start point; otherwise a leader to the value box.
    const from = this.spec.arrowFrom ? cam.project(this.spec.arrowFrom) : null;
    if (from && Number.isFinite(from[0]) && Number.isFinite(from[1])) {
      this.line.setAttribute('x1', String(from[0]));
      this.line.setAttribute('y1', String(from[1]));
      this.line.setAttribute('x2', String(x));
      this.line.setAttribute('y2', String(y));
      // A fixed-length arrow along the feature axis, so it reads as a handle
      // even when the axis is foreshortened (Inventor/Fusion style).
      let ux = 0, uy = -1;
      if (this.spec.axis) {
        const tip = cam.project(add(this.spec.anchor, normalize(this.spec.axis)));
        const ax = tip[0] - x, ay = tip[1] - y;
        const alen = Math.hypot(ax, ay);
        if (alen > 0.5) { ux = ax / alen; uy = ay / alen; }
      }
      const size = 12;
      const startX = x - ux * 46, startY = y - uy * 46;
      this.line.setAttribute('x1', String(startX));
      this.line.setAttribute('y1', String(startY));
      // Stop before the handle dot so the arrow head stays visible.
      const tipX = x - ux * 10, tipY = y - uy * 10;
      this.line.setAttribute('x2', String(tipX));
      this.line.setAttribute('y2', String(tipY));
      this.arrow.setAttribute('points', [
        `${tipX},${tipY}`,
        `${tipX - ux * size - uy * size * 0.55},${tipY - uy * size + ux * size * 0.55}`,
        `${tipX - ux * size + uy * size * 0.55},${tipY - uy * size - ux * size * 0.55}`,
      ].join(' '));
      this.arrow.style.display = '';
    } else {
      this.arrow.style.display = 'none';
    }
    const bw = this.el.offsetWidth || 128, bh = this.el.offsetHeight || 26;
    let left = Math.max(4, Math.min(w - bw - 4, x + 20));
    let top = Math.max(4, Math.min(hgt - bh - 4, y - 30));
    // Keep clear of the OK / Cancel column in the top-right corner and of the
    // view HUD at the top centre: the box must never swallow their clicks.
    if (left + bw > w - 64 && top < 104) left = Math.max(4, w - bw - 72);
    if (top < 50 && left + bw > w / 2 - 150 && left < w / 2 + 150) top = 52;
    // Keep the box clear of an open floating feature panel so its controls stay clickable.
    const panel = document.querySelector<HTMLElement>('.panel-layer .pm');
    if (panel && !panel.hidden) {
      const root = this.app.shell.viewport.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const px = pr.left - root.left, py = pr.top - root.top;
      const overlaps = left < px + pr.width && left + bw > px && top < py + pr.height && top + bh > py;
      if (overlaps) {
        if (px + pr.width + 8 + bw <= w - 4) left = px + pr.width + 8;
        else if (py + pr.height + 8 + bh <= hgt - 4) top = py + pr.height + 8;
        else left = Math.max(4, px - bw - 8);
      }
    }
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    // No start point: the leader continues from the dot to the box.
    if (this.arrow.style.display === 'none') {
      this.line.setAttribute('x1', String(x));
      this.line.setAttribute('y1', String(y));
      this.line.setAttribute('x2', String(left));
      this.line.setAttribute('y2', String(top + bh / 2));
    }
    this.dot.style.left = `${x}px`;
    this.dot.style.top = `${y}px`;
    this.line.setAttribute('x1', String(x));
    this.line.setAttribute('y1', String(y));
    this.line.setAttribute('x2', String(left));
    this.line.setAttribute('y2', String(top + bh / 2));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    if (this.drag) this.setDragging(false);
    this.el.remove();
    this.dot.remove();
    this.leader.remove();
  }

  private get ctx(): UnitContext {
    return this.app.unitContext();
  }

  private writeValue(v: number) {
    this.input.value = formatCanvasValue(v, this.spec.kind, this.ctx);
  }

  private updateMenu() {
    const has = !!this.spec.menu;
    this.menuBtn.hidden = !has;
  }

  private clamp(v: number): number {
    let n = v;
    if (this.spec.min !== undefined) n = Math.max(this.spec.min, n);
    if (this.spec.max !== undefined) n = Math.min(this.spec.max, n);
    return n;
  }

  /** One value change; dragging is throttled so the kernel is not flooded. */
  private apply(v: number, immediate = false) {
    const n = this.clamp(v);
    this.pending = n;
    this.spec = { ...this.spec, value: n };
    this.writeValue(n);
    const run = () => {
      this.timer = 0;
      const pending = this.pending;
      this.pending = null;
      if (pending === null) return;
      this.lastApply = performance.now();
      this.spec.onChange(pending);
    };
    if (immediate) {
      clearTimeout(this.timer);
      this.timer = 0;
      run();
      return;
    }
    if (this.timer) return;
    const wait = Math.max(0, 60 - (performance.now() - this.lastApply));
    this.timer = window.setTimeout(run, wait);
  }

  /** A press on the grip or the anchor dot drags the value along its axis. */
  private bindDrag(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const cam = this.app.renderer.camera;
      const p0 = cam.project(this.spec.anchor);
      const p1 = this.spec.axis ? cam.project(add(this.spec.anchor, normalize(this.spec.axis))) : null;
      const dx = p1 ? p1[0] - p0[0] : 0;
      const dy = p1 ? p1[1] - p0[1] : -1;
      const len2 = dx * dx + dy * dy;
      this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, start: this.spec.value, dx, dy, len2, screen: !p1 || len2 < 1 };
      el.setPointerCapture(e.pointerId);
      this.setDragging(true);
    });
    el.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const mx = e.clientX - d.sx, my = e.clientY - d.sy;
      if (e.shiftKey && this.spec.taper) {
        // Shift-drag is the taper handle, like Inventor's taper drag.
        const t = this.spec.taper;
        const nv = Math.max(t.min, Math.min(t.max, t.value - my * 0.2));
        this.input.value = formatCanvasValue(nv, 'angle', this.ctx);
        t.onChange(nv);
        return;
      }
      let delta: number;
      if (d.screen) {
        // Nothing world-aligned to project (e.g. a fillet radius): a vertical
        // drag changes the value at the scale of the view.
        const perPx = this.spec.kind === 'angle' ? 0.5 : this.app.renderer.camera.pixelSize;
        delta = -my * perPx;
      } else delta = (mx * d.dx + my * d.dy) / d.len2;
      this.apply(d.start + delta);
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      this.setDragging(false);
      if (this.pending !== null) this.apply(this.pending, true);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  private bind(grip: HTMLElement) {
    this.bindDrag(grip);
    this.bindDrag(this.dot);

    this.input.addEventListener('compositionstart', () => { this.composing = true; });
    this.input.addEventListener('compositionend', () => { this.composing = false; });
    this.input.addEventListener('focus', () => {
      this.valueAtFocus = this.spec.value;
      this.input.select();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.commitTyped();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.writeValue(this.valueAtFocus);
        this.spec = { ...this.spec, value: this.valueAtFocus };
        this.input.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const step = this.spec.kind === 'angle' ? 1 : UNIT_SYSTEMS[this.ctx.units].scale;
        const base = this.parse(this.input.value) ?? this.spec.value;
        this.apply(base + (e.key === 'ArrowUp' ? step : -step), true);
      }
    });
    this.input.addEventListener('change', () => {
      // Mobile keyboards commit with a "done" that only fires change.
      if (!this.composing) this.commitTyped();
    });
    this.input.addEventListener('blur', () => {
      if (!this.composing && this.parse(this.input.value) !== null) this.commitTyped();
      else this.writeValue(this.spec.value);
    });

    this.menuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const items = this.spec.menu?.() ?? [];
      if (!items.length) return;
      const r = this.menuBtn.getBoundingClientRect();
      this.menuBtn.setAttribute('aria-expanded', 'true');
      openMenu(items, r.left - 130, r.bottom + 2, { anchor: this.menuBtn, label: tr("Value options"), onClose: () => this.menuBtn.setAttribute('aria-expanded', 'false') });
    });
  }

  private setDragging(on: boolean) {
    this.el.classList.toggle('dragging', on);
    this.app.viewport.canvas.style.cursor = on ? 'grabbing' : '';
  }

  private parse(text: string): number | null {
    return parseCanvasValue(text, this.spec.kind, this.ctx);
  }

  private commitTyped() {
    const v = this.parse(this.input.value);
    if (v === null) {
      this.input.classList.add('invalid');
      this.writeValue(this.spec.value);
      return;
    }
    this.input.classList.remove('invalid');
    // change fires before blur with the same text: one rebuild is enough.
    if (Math.abs(v - this.spec.value) <= 1e-9) { this.writeValue(this.spec.value); return; }
    this.apply(v, true);
  }
}
