// Drawing workspace: a paper sheet with projected views of the part (hidden
// lines dashed), overall dimensions and a title block. Views can be dragged,
// added and removed; the sheet exports to PDF and SVG.

import type { ProjectionResult } from '../kernel/protocol';
import type { DrawingDoc, DrawingView, DrawingViewKind, FaceRef, SectionAxis, SheetSize } from '../model/types';
import type { Vec3 } from '../math/vec';
import { UNIT_SYSTEMS, formatNumber } from '../model/units';
import { SHEET_LABELS, STANDARD_SCALES, VIEW_DIRS, VIEW_LABELS, buildSheet, projectedSize, scaleLabel, sheetDims, standardLayout, toPdf, toSvg, type ViewAnnotations, type ViewFrame } from '../drawing/sheet';
import { cross, dot, normalize } from '../math/vec';
import { componentInstanceCount } from '../model/assembly';
import { toDxf } from '../drawing/dxf';
import { download, safeName } from '../platform/files';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { toast } from '../ui/overlay';
import type { App } from './app';
import { PropertyPanel, checkbox, numberField, section, selectField } from './pm';
import { tr } from '../i18n';

/**
 * Where a drawing view looks from, and for a section view the plane it cuts at.
 * `center` is the middle of the model, so the section offset reads from there.
 */
function viewRequest(
  v: DrawingView,
  center: Vec3,
  face?: { type: string; normal?: Vec3; frame?: { x: Vec3 } } | null,
): { dir: Vec3; x: Vec3; cut?: { p: Vec3; n: Vec3 } } {
  // An auxiliary view looks square on at a planar face.
  if (v.kind === 'auxiliary' && face?.normal) {
    const dir = face.normal;
    const fx = face.frame?.x;
    // A paper x axis in the face plane: the face frame unless it is parallel to the normal.
    const perp = fx && Math.abs(dot(fx, dir)) < 0.999 ? fx : (Math.abs(dir[0]) > 0.9 ? [0, 1, 0] as Vec3 : [1, 0, 0] as Vec3);
    const x = normalize(cross(perp, dir));
    return { dir, x };
  }
  if (v.kind !== 'section') return VIEW_DIRS[v.kind];
  const s = v.section ?? { axis: 'z' as SectionAxis, offset: 0, flip: false };
  const axis: Vec3 = s.axis === 'x' ? [1, 0, 0] : s.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
  const sign = s.flip ? -1 : 1;
  const dir: Vec3 = [axis[0] * sign, axis[1] * sign, axis[2] * sign];
  const x: Vec3 = s.axis === 'x' ? [0, 1, 0] : [1, 0, 0];
  const p: Vec3 = [center[0] + axis[0] * s.offset, center[1] + axis[1] * s.offset, center[2] + axis[2] * s.offset];
  return { dir, x, cut: { p, n: dir } };
}

/** What a view's projection depends on, besides the model version. */
const viewSig = (v: DrawingView) => v.kind === 'section'
  ? JSON.stringify(v.section ?? { axis: 'z', offset: 0, flip: false })
  : v.kind === 'auxiliary' ? JSON.stringify(v.auxiliary ?? null) : '';

/** YYYY-MM-DD in the user's time zone (toISOString gives the UTC day, a day off in the evening or morning). */
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class DrawingWorkspace {
  readonly el: HTMLElement;
  private host: HTMLElement;
  private paper: HTMLElement;
  private selBox: HTMLElement;
  active = false;
  selected: string | null = null;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private cache = new Map<string, { kind: DrawingViewKind; version: number; sig: string; result: ProjectionResult }>();
  private frames: ViewFrame[] = [];
  private pending = false;
  /** A refresh was asked for while views were being projected. */
  private refreshAgain = false;
  /** What the drawing PropertyManager shows, to rebuild it only when that changes. */
  private panelKey = '';
  private panelChanging = false;
  private layoutPending = false;
  private sheetW = 297;
  private sheetH = 210;

  constructor(private app: App) {
    this.paper = h('div', { class: 'paper', role: 'img', 'aria-label': tr("Drawing sheet") });
    this.selBox = h('div', { class: 'view-sel', hidden: true });
    this.host = h('div', { class: 'sheet-host' }, this.paper, this.selBox);
    this.el = h('div', { class: 'drawing-ws', hidden: true, tabindex: '0', 'aria-label': tr("Drawing. Drag views to move them, use the wheel to zoom. Arrow keys move the selected view and Delete removes it.") }, this.host,
      h('div', { class: 'drawing-empty', hidden: true }, tr("There is no solid to draw yet. Build the part in the Model tab first.")));
    app.shell.viewport.append(this.el);
    this.bind();
    // A drawing made before the part had a solid is laid out when the solid exists, even
    // if the drawing was left meanwhile; not once another document replaced that part.
    app.store.on((reason) => { if (reason === 'load') this.layoutPending = false; });
  }

  get doc(): DrawingDoc | null {
    return this.app.store.doc.drawing ?? null;
  }

  // ---------- lifecycle ----------

  open() {
    if (!this.doc) this.create();
    this.active = true;
    this.el.hidden = false;
    void this.refresh();
    requestAnimationFrame(() => this.fit());
  }

  close() {
    this.refreshAgain = false;
    this.panelKey = '';
    this.active = false;
    this.el.hidden = true;
  }

  /** Creates a drawing with the standard views laid out on an A4 (or, for inch parts, Letter) sheet. */
  create() {
    const b = this.app.bbox;
    const size: SheetSize = this.app.store.doc.units === 'IPS' ? 'Letter' : 'A4';
    const bom = this.bomRows();
    const layout = b ? standardLayout(sheetDims({ sheet: size, landscape: true }), b.min, b.max, bomReserve(bom.length)) : { scale: 1, views: [] };
    // Opened before the first rebuild finished: lay out once the solid exists.
    this.layoutPending = !b;
    this.app.store.change(tr("Create drawing"), (d) => {
      d.drawing = {
        sheet: size, landscape: true, scale: layout.scale,
        views: layout.views.map((v, i) => ({ ...v, id: `v${i + 1}` })), title: '', drawnBy: '', notes: '',
      };
    });
  }

  /** Re-lays out the standard views (keeps sheet settings). */
  relayout() {
    const b = this.app.bbox;
    const d = this.doc;
    if (!b || !d) return;
    const layout = standardLayout(sheetDims(d), b.min, b.max, bomReserve(this.bomRows().length));
    this.app.store.change(tr("Arrange views"), (doc) => {
      doc.drawing!.scale = layout.scale;
      doc.drawing!.views = layout.views.map((v, i) => ({ ...v, id: `v${i + 1}` }));
    });
  }

  update(fn: (d: DrawingDoc) => void, label = tr("Edit drawing")) {
    this.app.store.change(label, (doc) => { if (doc.drawing) fn(doc.drawing); });
  }

  /**
   * A change made with a control of the drawing PropertyManager, which already
   * shows it: the panel is not rebuilt, so focus stays (Tab moves on normally).
   */
  updateFromPanel(fn: (d: DrawingDoc) => void, label: string) {
    this.panelChanging = true;
    try {
      this.update(fn, label);
    } finally {
      this.panelChanging = false;
    }
  }

  /** Rebuilds the PropertyManager if what it shows changed (not when a view only moved). */
  private syncPanel() {
    const d = this.doc;
    const key = d ? JSON.stringify([this.selected, this.app.store.doc.name, d.sheet, d.landscape, d.scale, d.title, d.drawnBy, d.notes, d.views.map((v) => [v.id, v.kind, v.hidden, v.dims, v.scale, v.section, v.detail, v.auxiliary, v.centers, v.balloons])]) : '';
    if (key === this.panelKey) return;
    this.panelKey = key;
    if (this.panelChanging) return;
    // Keyboard focus in the panel stays on the same control in the rebuilt one; from a
    // deleted view's row it moves to the row that took its place, else the one above, else Add view.
    const body = this.app.shell.lpBody;
    const was = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement : null;
    const name = (el: Element) => el.getAttribute('aria-label') ?? el.textContent;
    const row = was ? [...body.querySelectorAll('.relations-list > *')].findIndex((r) => r.contains(was)) : -1;
    this.app.refreshPanel();
    if (!was || was.isConnected) return;
    const rows = body.querySelectorAll('.relations-list > *');
    const controls = [...body.querySelectorAll<HTMLElement>('button, input, select')];
    const same = controls.find((el) => name(el) === name(was));
    const near = row >= 0 ? rows[Math.min(row, rows.length - 1)]?.querySelector<HTMLElement>('button[aria-label^="Delete"]') ?? controls.find((el) => name(el) === 'Add view') : null;
    (same ?? near ?? body.querySelector<HTMLElement>('.pm-head .title'))?.focus();
  }

  // ---------- projections and rendering ----------

  /** Projects missing or outdated views, then renders. */
  async refresh() {
    if (!this.active) return;
    if (this.pending) { this.refreshAgain = true; return; }
    const d = this.doc;
    if (!d) return;
    if (this.layoutPending && this.app.bbox) {
      this.layoutPending = false;
      if (!d.views.length) { this.relayout(); return; }
    }
    const version = this.app.buildVersion;
    // Detail views reuse their source view's projection: nothing to project.
    const need = d.views.filter((v) => {
      if (v.kind === 'detail') return false;
      const c = this.cache.get(v.id);
      return !c || c.kind !== v.kind || c.version !== version || c.sig !== viewSig(v);
    });
    if (need.length && this.app.bbox) {
      this.pending = true;
      try {
        const b = this.app.bbox;
        const center: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
        const res = await this.app.kernel.project(need.map((v) => {
          const face = v.kind === 'auxiliary' && v.auxiliary
            ? this.app.faces.find((f) => f.name === v.auxiliary!.face.name) ?? null : null;
          return { id: v.id, ...viewRequest(v, center, face) };
        }));
        for (const r of res) {
          const v = need.find((x) => x.id === r.id)!;
          this.cache.set(r.id, { kind: v.kind, version, sig: viewSig(v), result: r });
        }
      } catch (e) {
        toast({ kind: 'error', title: tr("Could not project the views"), message: (e as Error).message });
      } finally {
        this.pending = false;
      }
      // The model or the views may have changed while projecting.
      if (version !== this.app.buildVersion || this.refreshAgain) { this.refreshAgain = false; void this.refresh(); return; }
    }
    this.render();
  }

  private info() {
    const doc = this.app.store.doc;
    const u = UNIT_SYSTEMS[doc.units];
    return {
      partName: doc.name,
      material: doc.material?.name ?? tr("Not specified"),
      units: u.length,
      date: localDate(doc.modified || Date.now()),
      formatLength: (mm: number) => formatNumber(mm / u.scale, doc.decimals),
      bom: this.bomRows(),
    };
  }

  /** Visible components grouped for the bill of materials, with their ids. */
  private bomGroups(): { part: string; material: string; components: string[]; quantity: number; description?: string }[] {
    const doc = this.app.store.doc;
    if (doc.kind !== 'assembly') return [];
    const groups = new Map<string, { part: string; material: string; components: string[]; quantity: number; description?: string }>();
    for (const component of doc.components ?? []) {
      if (!component.visible || component.suppressed) continue;
      const material = component.part.material?.name ?? tr("Not specified");
      const key = JSON.stringify([component.part.name, material]);
      // Pattern copies count towards the quantity, like separate instances.
      const copies = componentInstanceCount(doc.componentPatterns, component.id);
      const row = groups.get(key);
      if (row) { row.components.push(component.id); row.quantity += copies; }
      else groups.set(key, { part: component.part.name, material, components: [component.id], quantity: copies, description: component.part.drawing?.title ?? '' });
    }
    return [...groups.values()];
  }

  /** Aggregated assembly components for the drawing's bill of materials. */
  private bomRows() {
    return this.bomGroups().map((group, i) => ({ item: i + 1, part: group.part, description: group.description ?? '', quantity: group.quantity, material: group.material }));
  }

  /** Centre marks and balloons for each view, in that view's model space. */
  private annotations(d: DrawingDoc, projections: Map<string, ProjectionResult>): Map<string, ViewAnnotations> {
    const out = new Map<string, ViewAnnotations>();
    const b = this.app.bbox;
    if (!b) return out;
    const center: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const groups = this.bomGroups();
    for (const v of d.views) {
      if (v.kind === 'detail' || v.kind === 'auxiliary') continue;
      const pr = projections.get(v.id);
      if (!pr?.bounds) continue;
      const { dir, x } = viewRequest(v, center);
      const u = normalize(x);
      const up = cross(dir, u);
      const bounds = pr.bounds;
      const near = (p: [number, number]) => p[0] >= bounds[0] - 8 && p[0] <= bounds[2] + 8 && p[1] >= bounds[1] - 8 && p[1] <= bounds[3] + 8;
      const circles: ViewAnnotations['circles'] = [];
      // Existing drawings without the flag still get centre marks (the checkbox shows them on).
      if (v.centers !== false) {
        for (const e of this.app.edges) {
          if (e.type !== 'circle' || !e.center || !e.axis || !e.radius) continue;
          if (Math.abs(dot(e.axis, dir)) < 0.999) continue;
          const p: [number, number] = [dot(e.center, u), -dot(e.center, up)];
          if (near(p)) circles.push({ x: p[0], y: p[1], r: e.radius });
        }
      }
      const balloons: ViewAnnotations['balloons'] = [];
      if (v.balloons && groups.length) {
        groups.forEach((group, index) => {
          // The first visible component of the group stands for the whole group.
          const componentId = group.components[0];
          let sum: Vec3 = [0, 0, 0];
          let count = 0;
          for (const f of this.app.faces) {
            const owner = f.component?.split('/')[0];
            if (owner !== componentId) continue;
            sum = [sum[0] + f.center[0], sum[1] + f.center[1], sum[2] + f.center[2]];
            count++;
          }
          if (!count) return;
          const world: Vec3 = [sum[0] / count, sum[1] / count, sum[2] / count];
          const p: [number, number] = [dot(world, u), -dot(world, up)];
          if (!near(p)) return;
          balloons.push({ x: p[0], y: p[1], item: index + 1 });
        });
      }
      if (circles.length || balloons.length) out.set(v.id, { circles, balloons });
    }
    return out;
  }

  private sheet() {
    const d = this.doc!;
    const projections = new Map<string, ProjectionResult>();
    for (const v of d.views) {
      const c = this.cache.get(v.id);
      if (this.app.bbox && c?.version === this.app.buildVersion && c.kind === v.kind) projections.set(v.id, c.result);
    }
    return buildSheet(d, projections, { ...this.info(), annotations: this.annotations(d, projections) });
  }

  render() {
    const d = this.doc;
    if (!d || !this.active) return;
    const s = this.sheet();
    this.frames = s.frames;
    // A new sheet size or orientation is refitted, or only part of it shows.
    const resized = s.w !== this.sheetW || s.h !== this.sheetH;
    this.sheetW = s.w;
    this.sheetH = s.h;
    this.paper.innerHTML = toSvg(s.items, s.w, s.h);
    const svg = this.paper.firstElementChild as SVGSVGElement | null;
    if (svg) {
      svg.setAttribute('width', `${s.w}`);
      svg.setAttribute('height', `${s.h}`);
    }
    this.paper.style.width = `${s.w}px`;
    this.paper.style.height = `${s.h}px`;
    (this.el.querySelector('.drawing-empty') as HTMLElement).hidden = !!this.app.bbox;
    if (resized) this.fit();
    else this.applyTransform();
    this.drawSelection();
    this.syncPanel();
  }

  private applyTransform() {
    this.host.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
  }

  private drawSelection() {
    const f = this.frames.find((x) => x.id === this.selected);
    this.selBox.hidden = !f;
    if (!f) return;
    const pad = 3;
    Object.assign(this.selBox.style, { left: `${f.x0 - pad}px`, top: `${f.y0 - pad}px`, width: `${f.x1 - f.x0 + 2 * pad}px`, height: `${f.y1 - f.y0 + 2 * pad}px` });
  }

  /** Fits the sheet into the visible area. */
  fit() {
    const r = this.el.getBoundingClientRect();
    if (!r.width) return;
    // The document's sheet, which the views being projected may not have rendered yet.
    if (this.doc) ({ w: this.sheetW, h: this.sheetH } = sheetDims(this.doc));
    const m = 24;
    this.zoom = Math.min((r.width - 2 * m) / this.sheetW, (r.height - 2 * m) / this.sheetH);
    this.pan = { x: (r.width - this.sheetW * this.zoom) / 2, y: (r.height - this.sheetH * this.zoom) / 2 };
    this.applyTransform();
  }

  // ---------- interaction ----------

  private toSheet(clientX: number, clientY: number): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [(clientX - r.left - this.pan.x) / this.zoom, (clientY - r.top - this.pan.y) / this.zoom];
  }

  private viewAt(x: number, y: number): string | null {
    for (const f of [...this.frames].reverse()) if (x >= f.x0 - 3 && x <= f.x1 + 3 && y >= f.y0 - 3 && y <= f.y1 + 3) return f.id;
    return null;
  }

  private bind() {
    let drag: { kind: 'pan' | 'view'; sx: number; sy: number; ox: number; oy: number; id?: string; moved: boolean } | null = null;
    // Two fingers pinch to zoom and pan (touch screens have no wheel).
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; sx: number; sy: number; zoom: number } | null = null;
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      const r = this.el.getBoundingClientRect();
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        // A second finger ends any drag (closing its undo step) and starts a pinch.
        if (drag?.kind === 'view' && drag.moved) this.app.store.endBatch();
        drag = null;
        if (pointers.size === 2) {
          const p = pinchState();
          pinch = { d: p.d, sx: (p.mx - this.pan.x) / this.zoom, sy: (p.my - this.pan.y) / this.zoom, zoom: this.zoom };
        }
        this.el.setPointerCapture(e.pointerId);
        return;
      }
      this.el.focus({ preventScroll: true });
      const [x, y] = this.toSheet(e.clientX, e.clientY);
      const id = e.button === 0 ? this.viewAt(x, y) : null;
      this.el.setPointerCapture(e.pointerId);
      if (id) {
        const v = this.doc!.views.find((q) => q.id === id)!;
        this.selected = id;
        this.drawSelection();
        this.syncPanel();
        drag = { kind: 'view', sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, id, moved: false };
      } else {
        if (e.button === 0 && this.selected) { this.selected = null; this.drawSelection(); this.syncPanel(); }
        drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: this.pan.x, oy: this.pan.y, moved: false };
      }
    });
    this.el.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        if (pointers.size < 2) return;
        // Keep the sheet point first under the fingers' midpoint under it.
        const p = pinchState();
        this.zoom = Math.max(0.1, Math.min(40, (pinch.zoom * p.d) / pinch.d));
        this.pan = { x: p.mx - pinch.sx * this.zoom, y: p.my - pinch.sy * this.zoom };
        this.applyTransform();
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!drag.moved && drag.kind === 'view') this.app.store.beginBatch('Move view', () => { drag = null; });
      drag.moved = true;
      if (drag.kind === 'pan') {
        this.pan = { x: drag.ox + dx, y: drag.oy + dy };
        this.applyTransform();
      } else {
        const id = drag.id!, nx = drag.ox + dx / this.zoom, ny = drag.oy + dy / this.zoom;
        // The change re-renders the sheet (App refreshes the drawing on every document change).
        this.update((d) => { const v = d.views.find((q) => q.id === id); if (v) { v.x = nx; v.y = ny; } }, 'Move view');
      }
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; return; }
      if (drag?.kind === 'view' && drag.moved) this.app.store.endBatch();
      drag = null;
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('lostpointercapture', end);
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      const f = Math.exp(-Math.max(-0.5, Math.min(0.5, e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const nz = Math.max(0.1, Math.min(40, this.zoom * f));
      this.pan = { x: mx - ((mx - this.pan.x) * nz) / this.zoom, y: my - ((my - this.pan.y) * nz) / this.zoom };
      this.zoom = nz;
      this.applyTransform();
    }, { passive: false });
    // A held arrow key is one undo step: its auto-repeats join the step of the first press
    // (one step each filled the bounded history within seconds and dropped older steps).
    let nudge: { id: string; mark: number; last: number } | null = null;
    this.el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      const move = (dx: number, dy: number) => {
        const id = this.selected;
        if (!id) return;
        e.preventDefault();
        const store = this.app.store;
        const join = e.repeat && nudge?.id === id && nudge.last === store.undoMark ? nudge : null;
        const mark = join ? join.mark : store.undoMark;
        this.update((d) => { const v = d.views.find((q) => q.id === id); if (v) { v.x += dx; v.y += dy; } }, 'Move view');
        if (join) store.squash(mark, 'Move view');
        nudge = { id, mark, last: store.undoMark };
      };
      if (e.key === 'ArrowLeft') move(-step, 0);
      else if (e.key === 'ArrowRight') move(step, 0);
      else if (e.key === 'ArrowUp') move(0, -step);
      else if (e.key === 'ArrowDown') move(0, step);
    });
    new ResizeObserver(() => { if (this.active) this.applyTransform(); }).observe(this.el);
  }

  /** Selects a view from the keyboard (the Views list) and focuses the sheet so arrow keys move it. */
  select(id: string) {
    this.selected = id;
    this.drawSelection();
    this.syncPanel();
    this.el.focus({ preventScroll: true });
  }

  deleteSelected(): boolean {
    const id = this.selected;
    if (!id) return false;
    this.selected = null;
    this.update((d) => { d.views = d.views.filter((v) => v.id !== id); }, tr("Delete view"));
    return true;
  }

  addView(kind: DrawingViewKind) {
    const d = this.doc;
    const b = this.app.bbox;
    if (!d || !b) return;
    if (kind === 'detail') {
      this.addDetailView();
      return;
    }
    if (kind === 'auxiliary') {
      const faces = this.app.faces.filter((f) => f.type === 'plane' && f.normal && f.frame);
      const face = faces[Math.min(faces.length - 1, 0)];
      if (!face) {
        toast({ kind: 'warning', message: tr("Build a planar face before adding an auxiliary view.") });
        return;
      }
      const sheet = sheetDims(d);
      let n = d.views.length + 1;
      while (d.views.some((v) => v.id === `v${n}`)) n++;
      const id = `v${n}`;
      const ref: FaceRef = { name: face.name, sig: { type: face.type, c: face.center, n: face.normal, area: face.area } };
      this.selected = id;
      this.update((dd) => {
        dd.views.push({ id, kind: 'auxiliary', x: Math.min(sheet.w - 40, 120), y: Math.max(70, sheet.h * 0.6), hidden: false, dims: false, auxiliary: { face: ref } });
      }, tr("Add auxiliary view"));
      return;
    }
    // A new section cuts across Z through the middle until it is moved.
    const section = kind === 'section' ? { axis: 'z' as SectionAxis, offset: 0, flip: false } : undefined;
    const sized = kind === 'section' ? 'front' : kind;
    const [w, hh] = projectedSize(sized, b.min, b.max);
    const sheet = sheetDims(d);
    // Place it in the first free spot along the top row.
    let x = 40 + (w * d.scale) / 2, y = 30 + (hh * d.scale) / 2;
    for (let tries = 0; tries < 20 && this.frames.some((f) => x + (w * d.scale) / 2 > f.x0 && x - (w * d.scale) / 2 < f.x1 && y + (hh * d.scale) / 2 > f.y0 && y - (hh * d.scale) / 2 < f.y1); tries++) {
      x += 30;
      if (x > sheet.w - 30) { x = 40; y += 30; }
    }
    let n = d.views.length + 1;
    while (d.views.some((v) => v.id === `v${n}`)) n++;
    const id = `v${n}`;
    this.selected = id;
    this.update((dd) => {
      dd.views.push({ id, kind, x, y, hidden: kind !== 'isometric' && kind !== 'section', dims: kind !== 'isometric', centers: kind !== 'isometric', ...(section ? { section } : {}) });
    }, tr("Add view"));
  }

  /** A magnified circular window onto another view, placed beside it. */
  addDetailView() {
    const d = this.doc;
    const b = this.app.bbox;
    if (!d || !b) return;
    const sources = d.views.filter((v) => v.kind !== 'detail');
    if (!sources.length) {
      toast({ kind: 'warning', message: tr("Add a view before a detail view.") });
      return;
    }
    const source = sources.find((v) => v.kind === 'front') ?? sources[0];
    const bounds = this.cache.get(source.id)?.result.bounds ?? [b.min[0], b.min[1], b.max[0], b.max[1]];
    // Centre the window on a hole when the view has one: there is geometry to
    // show, unlike the middle of a plain face.
    const modelCentre: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const dir = viewRequest(source, modelCentre).dir;
    const u = normalize(viewRequest(source, modelCentre).x);
    const up = cross(dir, u);
    const holes = this.app.edges
      .filter((e) => e.type === 'circle' && e.center && e.axis && Math.abs(dot(e.axis, dir)) > 0.999)
      .map((e) => ({ x: dot(e.center!, u), y: -dot(e.center!, up), r: e.radius ?? 0 }))
      .filter((hole) => hole.x >= bounds[0] && hole.x <= bounds[2] && hole.y >= bounds[1] && hole.y <= bounds[3]);
    const centre = holes[0];
    const cx = centre ? centre.x : (bounds[0] + bounds[2]) / 2;
    const cy = centre ? centre.y : (bounds[1] + bounds[3]) / 2;
    const radius = centre ? Math.max(6, centre.r * 2.5) : Math.max(4, Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 0.25);
    const magnification = 2;
    const size = radius * 2 * (source.scale ?? d.scale) * magnification;
    const frame = this.frames.find((f) => f.id === source.id);
    const sheet = sheetDims(d);
    const x = frame ? Math.min(sheet.w - 25 - size / 2, frame.x1 + 14 + size / 2) : 40 + size / 2;
    const y = frame ? Math.max(25 + size / 2, frame.y0 + size / 2) : 40 + size / 2;
    let n = d.views.length + 1;
    while (d.views.some((v) => v.id === `v${n}`)) n++;
    const id = `v${n}`;
    this.selected = id;
    this.update((dd) => {
      dd.views.push({
        id, kind: 'detail', x, y, hidden: false, dims: false,
        detail: { source: source.id, x: cx, y: cy, radius, scale: magnification },
      });
    }, tr("Add detail view"));
  }

  // ---------- export ----------

  /** Waits for both queued model edits and their projections before exporting. */
  private async projected(): Promise<boolean> {
    const drawing = this.doc;
    const stillOpen = () => this.active && this.doc === drawing;
    if (!drawing || !stillOpen()) return false;
    for (;;) {
      await this.app.whenBuilt();
      if (!stillOpen()) return false;
      const version = this.app.buildVersion;
      await this.refresh();
      while (this.pending || this.refreshAgain) {
        await new Promise((r) => setTimeout(r, 50));
        if (!stillOpen()) return false;
      }
      // Another edit may have arrived while the projection was running.
      await this.app.whenBuilt();
      if (!stillOpen()) return false;
      if (version === this.app.buildVersion) return true;
    }
  }

  async exportPdf() {
    if (!(await this.projected())) return;
    const s = this.sheet();
    download(toPdf(s.items, s.w, s.h, this.app.store.doc.name) as BlobPart, `${safeName(this.app.store.doc.name)}.pdf`, 'application/pdf');
  }

  async exportSvg() {
    if (!(await this.projected())) return;
    const s = this.sheet();
    download(toSvg(s.items, s.w, s.h), `${safeName(this.app.store.doc.name)}.svg`, 'image/svg+xml');
  }

  async exportDxf() {
    if (!(await this.projected())) return;
    const s = this.sheet();
    download(toDxf(s.items, s.w, s.h), `${safeName(this.app.store.doc.name)}.dxf`, 'application/dxf');
  }
}

const bomReserve = (rows: number) => rows ? 8 + Math.min(rows, 10) * 4 : 0;

/** PropertyManager for the drawing: sheet, scale, views and title block. */
export class DrawingPanel extends PropertyPanel {
  title = tr("Drawing");
  icon = 'file';
  confirm = false;

  constructor(private app: App, private ws: DrawingWorkspace) {
    super();
    this.closeLabel = tr("Back to Model");
    this.onCloseClick = () => app.closeDrawing();
  }

  ok() {
    return true;
  }

  render(): HTMLElement[] {
    const ws = this.ws;
    const d = ws.doc;
    if (!d) return [];
    const sheet = selectField<SheetSize>(tr("Sheet size"), d.sheet, (Object.keys(SHEET_LABELS) as SheetSize[]).map((k) => ({ value: k, label: SHEET_LABELS[k] })), (v) => ws.updateFromPanel((x) => { x.sheet = v; }, tr("Sheet size")));
    const scales = STANDARD_SCALES.map((s) => ({ value: String(s), label: scaleLabel(s) }));
    if (!scales.some((s) => Number(s.value) === d.scale)) scales.push({ value: String(d.scale), label: scaleLabel(d.scale) });
    const scale = selectField(tr("Scale"), String(d.scale), scales, (v) => ws.updateFromPanel((x) => { x.scale = Number(v); }, tr("Sheet scale")));
    const views = h('div', { class: 'relations-list' });
    for (const v of d.views) views.append(this.viewRow(v));
    const addSel = h('select', { class: 'input', 'aria-label': tr("View to add") }) as HTMLSelectElement;
    for (const k of Object.keys(VIEW_LABELS) as DrawingViewKind[]) addSel.append(h('option', { value: k }, VIEW_LABELS[k]));
    const add = h('button', { class: 'btn small', type: 'button' }, icon('plus', 14), tr("Add view"));
    add.addEventListener('click', () => ws.addView(addSel.value as DrawingViewKind));
    const field = (label: string, value: string, set: (v: string) => void) => {
      const input = h('input', { class: 'input', value, 'aria-label': label }) as HTMLInputElement;
      input.addEventListener('change', () => set(input.value));
      return h('div', {}, h('div', { class: 'field-label' }, label), input);
    };
    return [
      section(tr("Sheet"), [
        sheet,
        checkbox(tr("Landscape"), d.landscape, (v) => ws.updateFromPanel((x) => { x.landscape = v; }, tr("Sheet orientation"))),
        scale,
        h('button', { class: 'btn small', type: 'button', onclick: () => ws.relayout() }, icon('reset', 14), tr("Arrange standard views")),
      ]),
      section(tr("Views"), [views, h('div', { class: 'row' }, h('div', { class: 'grow' }, addSel), add)]),
      section(tr("Title Block"), [
        field(tr("Title"), d.title || this.app.store.doc.name, (v) => ws.updateFromPanel((x) => { x.title = v; }, tr("Title"))),
        field(tr("Drawn by"), d.drawnBy, (v) => ws.updateFromPanel((x) => { x.drawnBy = v; }, tr("Drawn by"))),
        field(tr("Notes"), d.notes, (v) => ws.updateFromPanel((x) => { x.notes = v; }, tr("Notes"))),
        field(tr("DWG NO"), d.number ?? '', (v) => ws.updateFromPanel((x) => { x.number = v; }, tr("DWG NO"))),
        field(tr("REV"), d.revision ?? '', (v) => ws.updateFromPanel((x) => { x.revision = v; }, tr("REV"))),
      ]),
      section(tr("Export"), [
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: () => void ws.exportPdf() }, icon('download', 14), 'PDF'),
          h('button', { class: 'btn small', type: 'button', onclick: () => void ws.exportSvg() }, icon('download', 14), 'SVG'),
          h('button', { class: 'btn small', type: 'button', onclick: () => void ws.exportDxf() }, icon('download', 14), 'DXF')),
      ]),
    ];
  }

  private viewRow(v: DrawingView): HTMLElement {
    const ws = this.ws;
    const del = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${VIEW_LABELS[v.kind]} view` }, icon('trash', 14));
    del.addEventListener('click', () => { ws.selected = v.id; ws.deleteSelected(); });
    const hidden = h('input', { type: 'checkbox', 'aria-label': `Hidden lines in ${VIEW_LABELS[v.kind]} view` }) as HTMLInputElement;
    hidden.checked = v.hidden;
    hidden.addEventListener('change', () => ws.updateFromPanel((d) => { const x = d.views.find((q) => q.id === v.id); if (x) x.hidden = hidden.checked; }, 'Hidden lines'));
    const dims = h('input', { type: 'checkbox', 'aria-label': `Dimensions in ${VIEW_LABELS[v.kind]} view` }) as HTMLInputElement;
    dims.checked = v.dims;
    dims.addEventListener('change', () => ws.updateFromPanel((d) => { const x = d.views.find((q) => q.id === v.id); if (x) x.dims = dims.checked; }, 'Dimensions'));
    const name = h('button', {
      class: 'grow', type: 'button', 'aria-pressed': String(ws.selected === v.id), title: tr("Select the view; arrow keys then move it"),
      style: { background: 'none', border: '0', padding: '0', textAlign: 'left' },
    }, VIEW_LABELS[v.kind]);
    name.addEventListener('click', () => ws.select(v.id));
    const row = h('div', { class: `rel-btn${ws.selected === v.id ? ' on' : ''}`, style: { cursor: 'default' } },
      name,
      h('label', { class: 'check', title: tr("Hidden lines") }, hidden, h('span', { class: 'field-label' }, tr("Hidden"))),
      h('label', { class: 'check', title: tr("Overall dimensions") }, dims, h('span', { class: 'field-label' }, tr("Dims"))),
      del);
    // Only the selected view opens its own controls, so the list stays short.
    const extra = ws.selected === v.id ? h('div', { class: 'rel-extra' }) : null;
    if (extra && v.kind === 'detail' && v.detail) {
      const det = v.detail;
      const sources = ws.doc?.views.filter((q) => q.kind !== 'detail') ?? [];
      const source = selectField<string>(tr("Detail source"), det.source, sources.map((q) => ({ value: q.id, label: VIEW_LABELS[q.kind] })), (value) => ws.updateFromPanel((x) => {
        const q = x.views.find((r) => r.id === v.id);
        if (q?.detail) q.detail.source = value;
      }, tr("Detail source")));
      const centerX = numberField({ label: tr("Centre X"), value: det.x, kind: 'length', ctx: this.app.unitContext(), onChange: (value) => { if (typeof value === 'number') ws.updateFromPanel((x) => { const q = x.views.find((r) => r.id === v.id); if (q?.detail) q.detail.x = value; }, tr("Detail centre")); } });
      const centerY = numberField({ label: tr("Centre Y"), value: det.y, kind: 'length', ctx: this.app.unitContext(), onChange: (value) => { if (typeof value === 'number') ws.updateFromPanel((x) => { const q = x.views.find((r) => r.id === v.id); if (q?.detail) q.detail.y = value; }, tr("Detail centre")); } });
      const radius = numberField({ label: tr("Detail radius"), value: det.radius, kind: 'length', ctx: this.app.unitContext(), min: 0.1, onChange: (value) => { if (typeof value === 'number') ws.updateFromPanel((x) => { const q = x.views.find((r) => r.id === v.id); if (q?.detail) q.detail.radius = Math.max(0.1, value); }, tr("Detail radius")); } });
      const magnification = selectField<string>(tr("Magnification"), String(det.scale), ['1.5', '2', '3', '4', '5'].map((value) => ({ value, label: scaleLabel(Number(value)) })), (value) => ws.updateFromPanel((x) => {
        const q = x.views.find((r) => r.id === v.id);
        if (q?.detail) q.detail.scale = Number(value);
      }, tr("Magnification")));
      extra.append(source, centerX, centerY, radius, magnification);
    }
    if (extra && v.kind === 'section') {
      const sec = v.section ?? { axis: 'z' as SectionAxis, offset: 0, flip: false };
      const axis = selectField<SectionAxis>(tr("Cut along"), sec.axis, [
        { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
      ], (value) => ws.updateFromPanel((x) => { const q = x.views.find((r) => r.id === v.id); if (q) q.section = { ...sec, axis: value }; }, tr("Section axis")));
      const offsetInput = h('input', { class: 'input', value: String(sec.offset), 'aria-label': tr("Section offset") }) as HTMLInputElement;
      offsetInput.addEventListener('change', () => {
        const value = Number(offsetInput.value);
        if (!Number.isFinite(value)) return;
        ws.updateFromPanel((x) => { const q = x.views.find((r) => r.id === v.id); if (q?.section) q.section.offset = value; }, tr("Section offset"));
      });
      const offsetRow = h('div', { class: 'rel-field' },
        h('div', { class: 'field-label' }, tr("Section offset")), offsetInput);
      const flip = checkbox(tr("Look from the other side"), !!sec.flip, (value) => ws.updateFromPanel((x) => { const q = x.views.find((r) => r.id === v.id); if (q?.section) q.section.flip = value; }, tr("Section side")));
      extra.append(axis, offsetRow, flip);
    }
    if (extra) {
      const scaleSel = h('select', { class: 'input', 'aria-label': tr("View scale") }) as HTMLSelectElement;
      scaleSel.append(h('option', { value: '' }, tr("Sheet scale")));
      for (const sc of STANDARD_SCALES) scaleSel.append(h('option', { value: String(sc) }, scaleLabel(sc)));
      if (v.scale != null && !STANDARD_SCALES.some((sc) => String(sc) === String(v.scale))) {
        scaleSel.append(h('option', { value: String(v.scale) }, scaleLabel(v.scale)));
      }
      scaleSel.value = v.scale == null ? '' : String(v.scale);
      scaleSel.addEventListener('change', () => ws.updateFromPanel((x) => {
        const q = x.views.find((r) => r.id === v.id);
        if (!q) return;
        if (scaleSel.value === '') delete q.scale;
        else q.scale = Number(scaleSel.value);
      }, tr("View scale")));
      const centers = checkbox(tr("Center marks"), v.centers !== false, (value) => ws.updateFromPanel((x) => {
        const q = x.views.find((r) => r.id === v.id);
        if (q) q.centers = value;
      }, tr("Center marks")));
      extra.append(centers);
      if (this.app.store.doc.kind === 'assembly') {
        const balloons = checkbox(tr("Balloons"), !!v.balloons, (value) => ws.updateFromPanel((x) => {
          const q = x.views.find((r) => r.id === v.id);
          if (q) q.balloons = value;
        }, tr("Balloons")));
        extra.append(balloons);
      }
      extra.append(h('div', { class: 'rel-field' }, h('div', { class: 'field-label' }, tr("View scale")), scaleSel));
      row.append(extra);
    }
    return row;
  }
}
