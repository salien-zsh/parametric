// Drawing sheets: sizes, scales, standard view directions, automatic layout
// and a display list (lines, paths, text) that renders identically to SVG
// (on screen and export) and PDF.

import type { ProjectionResult } from '../kernel/protocol';
import { type Vec3, cross, normalize } from '../math/vec';
import type { DrawingDoc, DrawingView, DrawingViewKind, SheetSize } from '../model/types';
import { PdfPage, textWidth } from './pdf';
import { tr } from '../i18n';

/** Portrait sizes in millimetres. */
export const SHEETS: Record<SheetSize, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8],
};

export const SHEET_LABELS: Record<SheetSize, string> = {
  A4: tr("A4 (297 x 210 mm)"), A3: tr("A3 (420 x 297 mm)"), A2: tr("A2 (594 x 420 mm)"), A1: tr("A1 (841 x 594 mm)"),
  Letter: tr("Letter (11 x 8.5 in)"), Tabloid: tr("Tabloid (17 x 11 in)"),
};

export function sheetDims(d: Pick<DrawingDoc, 'sheet' | 'landscape'>): { w: number; h: number } {
  const [a, b] = SHEETS[d.sheet];
  return d.landscape ? { w: b, h: a } : { w: a, h: b };
}

export const STANDARD_SCALES = [20, 10, 5, 4, 2, 1, 1 / 2, 1 / 4, 1 / 5, 1 / 10, 1 / 20, 1 / 25, 1 / 50, 1 / 100, 1 / 200];

export function scaleLabel(s: number): string {
  if (s >= 1) return `${Number(s.toFixed(3))}:1`;
  return `1:${Number((1 / s).toFixed(3))}`;
}

const isoDir = normalize([1, 1, 1]);

/** Direction toward the viewer and paper x axis of each standard view. */
export const VIEW_DIRS: Record<DrawingViewKind, { dir: Vec3; x: Vec3 }> = {
  front: { dir: [0, 0, 1], x: [1, 0, 0] },
  back: { dir: [0, 0, -1], x: [-1, 0, 0] },
  top: { dir: [0, 1, 0], x: [1, 0, 0] },
  bottom: { dir: [0, -1, 0], x: [1, 0, 0] },
  right: { dir: [1, 0, 0], x: [0, 0, -1] },
  left: { dir: [-1, 0, 0], x: [0, 0, 1] },
  isometric: { dir: isoDir, x: normalize(cross([0, 1, 0], isoDir)) },
  // Section views compute their direction from the cut axis; this is only a placeholder.
  section: { dir: [0, 0, 1], x: [1, 0, 0] },
  // Detail views reuse their source view's projection.
  detail: { dir: [0, 0, 1], x: [1, 0, 0] },
  // Auxiliary views supply their own direction from a planar face.
  auxiliary: { dir: [0, 0, 1], x: [1, 0, 0] },
};

export const VIEW_LABELS: Record<DrawingViewKind, string> = {
  front: tr("Front"), back: tr("Back"), top: tr("Top"), bottom: tr("Bottom"), right: tr("Right"), left: tr("Left"), isometric: tr("Isometric"),
  section: tr("Section"),
  detail: tr("Detail"),
  auxiliary: tr("Auxiliary"),
};

/** Size of a view of a box, in model units (paper width, height). */
export function projectedSize(kind: DrawingViewKind, min: Vec3, max: Vec3): [number, number] {
  const { dir, x } = VIEW_DIRS[kind];
  const y = cross(dir, x);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p: Vec3 = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
    const u = p[0] * x[0] + p[1] * x[1] + p[2] * x[2];
    const v = p[0] * y[0] + p[1] * y[1] + p[2] * y[2];
    x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
  }
  return [x1 - x0, y1 - y0];
}

export const MARGIN = 10;
export const TITLE_W = 170;
export const TITLE_H = 32;

/**
 * Standard three views (third-angle: top above front, right to the right)
 * plus an isometric view, at the largest standard scale that fits.
 */
export function standardLayout(sheet: { w: number; h: number }, min: Vec3, max: Vec3, bottomReserve = 0): { scale: number; views: Omit<DrawingView, 'id'>[] } {
  const f = projectedSize('front', min, max), t = projectedSize('top', min, max), r = projectedSize('right', min, max), i = projectedSize('isometric', min, max);
  const c1 = Math.max(f[0], t[0]), c2 = Math.max(r[0], i[0]);
  const r1 = Math.max(t[1], i[1]), r2 = Math.max(f[1], r[1]);
  // Room around each view for its dimensions and label: left of a view for
  // its height dimension, below it for its width dimension and label (the
  // top row needs that room as much as the bottom one).
  const gap = 15;
  const top = 5, below = (3 * gap - top) / 2;
  const availW = sheet.w - 2 * MARGIN - 3 * gap;
  const availH = sheet.h - 2 * MARGIN - TITLE_H - bottomReserve - 3 * gap;
  const fit = Math.min(availW / Math.max(c1 + c2, 1e-6), availH / Math.max(r1 + r2, 1e-6));
  const scale = STANDARD_SCALES.find((s) => s <= fit) ?? STANDARD_SCALES[STANDARD_SCALES.length - 1];
  const x1 = MARGIN + gap + (c1 * scale) / 2;
  const x2 = MARGIN + 2 * gap + c1 * scale + (c2 * scale) / 2;
  const y1 = MARGIN + top + (r1 * scale) / 2;
  const y2 = MARGIN + top + below + r1 * scale + (r2 * scale) / 2;
  return {
    scale,
    views: [
      { kind: 'front', x: x1, y: y2, hidden: true, dims: true },
      { kind: 'top', x: x1, y: y1, hidden: true, dims: true },
      { kind: 'right', x: x2, y: y2, hidden: true, dims: true },
      { kind: 'isometric', x: x2, y: y1, hidden: false, dims: false },
    ],
  };
}

// ---------- display list ----------

export type Item =
  | { t: 'path'; d: string; tx: number; ty: number; s: number; w: number; dash?: number[]; view?: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; dash?: number[] }
  | { t: 'rect'; x: number; y: number; w: number; h: number; sw: number }
  | { t: 'circle'; x: number; y: number; r: number; sw: number }
  | { t: 'tri'; a: [number, number]; b: [number, number]; c: [number, number] }
  | { t: 'text'; s: string; x: number; y: number; size: number; bold?: boolean; anchor?: 'start' | 'middle' | 'end'; rotate?: number };

/** Per-view 2D annotations in model space, ready to be placed with the view. */
export interface ViewAnnotations {
  /** Circular edges facing the view: centre and radius in model millimetres. */
  circles: { x: number; y: number; r: number }[];
  /** Assembly balloons: the point to lead to, and the bill-of-materials item. */
  balloons: { x: number; y: number; item: number }[];
}

export interface SheetInfo {
  partName: string;
  material: string;
  units: string;
  date: string;
  formatLength: (mm: number) => string;
  bom?: { item: number; part: string; description?: string; quantity: number; material: string }[];
  /** Annotations per view id (centre marks, balloons). */
  annotations?: Map<string, ViewAnnotations>;
  /** The assembly is shown exploded, so its isometric view says so. */
  exploded?: boolean;
}

export interface ViewFrame {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MIN_TEXT = 1.8;
const VISIBLE_W = 0.35;
const HIDDEN_W = 0.18;
const THIN = 0.18;

/** Builds the sheet's display list. Also returns each view's frame on the sheet. */
export function buildSheet(d: DrawingDoc, projections: Map<string, ProjectionResult>, info: SheetInfo): { items: Item[]; frames: ViewFrame[]; w: number; h: number } {
  const { w, h } = sheetDims(d);
  const items: Item[] = [];
  const frames: ViewFrame[] = [];
  items.push({ t: 'rect', x: MARGIN, y: MARGIN, w: w - 2 * MARGIN, h: h - 2 * MARGIN, sw: 0.5 });
  // Each view's paper scale: a detail view enlarges its source view's scale.
  const scales = new Map<string, number>();
  for (const v of d.views) {
    if (v.kind === 'detail' && v.detail) {
      const source = d.views.find((q) => q.id === v.detail!.source);
      const sourceScale = source ? (source.scale ?? d.scale) : d.scale;
      scales.set(v.id, sourceScale * Math.max(0.1, v.detail.scale || 1));
    } else {
      scales.set(v.id, v.scale ?? d.scale);
    }
  }
  // A detail view has no projection of its own: it clips and enlarges the
  // source view's projected curves around the detail circle.
  const detailProjections = new Map<string, ProjectionResult>();
  for (const v of d.views) {
    const detail = v.detail;
    if (v.kind !== 'detail' || !detail) continue;
    const source = projections.get(detail.source);
    if (!source?.bounds) continue;
    const visible = clipPathsToCircle(source.visible, detail.x, detail.y, detail.radius);
    const hidden = clipPathsToCircle(source.hidden, detail.x, detail.y, detail.radius);
    detailProjections.set(v.id, { id: v.id, visible: visible.paths, hidden: hidden.paths, bounds: visible.bounds });
  }
  const placed: { v: DrawingView; pr: ProjectionResult; tx: number; ty: number; f: ViewFrame; scale: number }[] = [];
  for (const v of d.views) {
    const pr = projections.get(v.id) ?? detailProjections.get(v.id);
    if (!pr || !pr.bounds) continue;
    const s = scales.get(v.id) ?? (v.scale ?? d.scale);
    const [bx0, by0, bx1, by1] = pr.bounds;
    const tx = v.x - (s * (bx0 + bx1)) / 2;
    const ty = v.y - (s * (by0 + by1)) / 2;
    const f = { id: v.id, x0: tx + bx0 * s, y0: ty + by0 * s, x1: tx + bx1 * s, y1: ty + by1 * s };
    frames.push(f);
    placed.push({ v, pr, tx, ty, f, scale: s });
  }
  // What a view label must stay clear of: every view with its dimensions,
  // the labels already placed and the title block.
  const taken: Box[] = placed.map(({ v, f }) => (hasDims(v) ? [f.x0 - DIM_LEFT, f.y0, f.x1, f.y1 + DIM_BELOW] : [f.x0, f.y0, f.x1, f.y1]));
  taken.push([w - MARGIN - TITLE_W, h - MARGIN - TITLE_H, w - MARGIN, h - MARGIN]);
  // Section views are lettered in the order they appear: A-A, B-B, ...
  let sectionLetter = 0;
  let detailLetter = 0;
  let auxLetter = 0;
  const letters = new Map<string, string>();
  for (const v of d.views) {
    if (v.kind === 'section') letters.set(v.id, String.fromCharCode(65 + sectionLetter++));
    else if (v.kind === 'detail') letters.set(v.id, String.fromCharCode(65 + detailLetter++));
    else if (v.kind === 'auxiliary') letters.set(v.id, String.fromCharCode(65 + auxLetter++));
  }
  for (const [i, { v, pr, tx, ty, f, scale }] of placed.entries()) {
    const [bx0, by0, bx1, by1] = pr.bounds!;
    if (v.hidden) for (const p of pr.hidden) items.push({ t: 'path', d: p, tx, ty, s: scale, w: HIDDEN_W, dash: [1.6, 0.8], view: v.id });
    for (const p of pr.visible) items.push({ t: 'path', d: p, tx, ty, s: scale, w: VISIBLE_W, view: v.id });
    // The cut face of a section view is hatched; its outline is already drawn.
    if (v.kind === 'detail' && v.detail) {
      items.push({ t: 'circle', x: v.x, y: v.y, r: v.detail.radius * (scales.get(v.id) ?? d.scale), sw: 0.25 });
    }
    if (v.kind === 'section' && pr.section?.length) {
      const loops = parseLoops(pr.section).map((loop) => loop.map(([x, y]) => [tx + x * scale, ty + y * scale] as [number, number]));
      hatchLoops(items, loops, Math.max(1.6, 2.4 / Math.max(0.25, scale)));
    }
    const { x0: fx0, x1: fx1, y0: fy0, y1: fy1 } = f;
    const letter = letters.get(v.id);
    const base = v.kind === 'section' && letter
      ? `${tr("SECTION")} ${letter}-${letter}`
      : v.kind === 'detail' && letter ? `${tr("DETAIL")} ${letter}`
        : v.kind === 'auxiliary' && letter ? `${tr("AUXILIARY")} ${letter}` : VIEW_LABELS[v.kind].toUpperCase();
    // An exploded assembly drawing marks the viewpoint that shows it.
    const shown = info.exploded && v.kind === 'isometric' ? `${base} (${tr("EXPLODED")})` : base;
    const scaled = v.kind === 'detail' && v.detail
      ? `${shown} (${scaleLabel(v.detail.scale)})`
      : v.scale != null && v.scale !== d.scale ? `${shown} (${scaleLabel(v.scale)})` : shown;
    const label = viewLabel(scaled, f, hasDims(v), taken.filter((_, j) => j !== i), w, h);
    items.push(label.item);
    taken.push(label.box);
    // Centre marks and balloons ride with the view's own scale and position.
    const annotations = info.annotations?.get(v.id);
    if (annotations?.circles.length) {
      for (const c of annotations.circles) {
        const cx = tx + c.x * scale;
        const cy = ty + c.y * scale;
        centerMark(items, cx, cy, c.r * scale);
      }
    }
    if (annotations?.balloons.length) balloon(items, annotations.balloons, tx, ty, scale, f, w, h);
    if (hasDims(v)) {
      dimension(items, [fx0, fy1], [fx1, fy1], 'below', info.formatLength(bx1 - bx0));
      dimension(items, [fx0, fy0], [fx0, fy1], 'left', info.formatLength(by1 - by0));
    }
    // Manual linear dimensions: true model lengths, placed at their offset.
    for (const dim of d.dimensions ?? []) {
      if (dim.view !== v.id) continue;
      const p1: [number, number] = [tx + dim.a[0] * scale, ty + dim.a[1] * scale];
      const p2: [number, number] = [tx + dim.b[0] * scale, ty + dim.b[1] * scale];
      const length = Math.hypot(dim.b[0] - dim.a[0], dim.b[1] - dim.a[1]);
      linearDimension(items, p1, p2, dim.offset, info.formatLength(length));
    }
  }
  const notesLines = d.notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // One note fits the title block cell; several become a notes list at the top left.
  if (notesLines.length > 1) notesBlock(items, d);
  bomTable(items, w, h, info.bom ?? []);
  titleBlock(items, w, h, d, info);
  return { items, frames, w, h };
}

type Box = [x0: number, y0: number, x1: number, y1: number];

/** An aligned linear dimension with arrows, extension lines and its value. */
function linearDimension(items: Item[], p1: [number, number], p2: [number, number], offset: number, text: string) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const q1: [number, number] = [p1[0] + nx * offset, p1[1] + ny * offset];
  const q2: [number, number] = [p2[0] + nx * offset, p2[1] + ny * offset];
  const w = 0.18;
  // Extension lines run just past the dimension line.
  const over = 1.5 * Math.sign(offset || 1);
  items.push({ t: 'line', x1: p1[0], y1: p1[1], x2: q1[0] + nx * over, y2: q1[1] + ny * over, w });
  items.push({ t: 'line', x1: p2[0], y1: p2[1], x2: q2[0] + nx * over, y2: q2[1] + ny * over, w });
  items.push({ t: 'line', x1: q1[0], y1: q1[1], x2: q2[0], y2: q2[1], w });
  const arrow = (at: [number, number], sign: 1 | -1) => {
    const tip: [number, number] = at;
    const back = 2.2;
    const base: [number, number] = [at[0] + ux * sign * back, at[1] + uy * sign * back];
    items.push({
      t: 'tri',
      a: tip,
      b: [base[0] + nx * 0.7, base[1] + ny * 0.7],
      c: [base[0] - nx * 0.7, base[1] - ny * 0.7],
    });
  };
  arrow(q1, 1);
  arrow(q2, -1);
  const mid: [number, number] = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2];
  const lift = offset >= 0 ? -1.6 : 1.6;
  items.push({ t: 'text', s: text, x: mid[0] + nx * lift, y: mid[1] + ny * lift + 0.9, size: 2.6, anchor: 'middle' });
}

const LABEL_SIZE = 2.6;
/** How far a view's dimensions reach left of and below its outline. */
const DIM_LEFT = 12;
const DIM_BELOW = 10.5;

const hasDims = (v: DrawingView) => v.dims && v.kind !== 'isometric';

/**
 * A view's label: centred below the view (past its width dimension) unless
 * something else is there, then above it, then to its right; below when
 * nothing is free, as before.
 */
function viewLabel(s: string, f: ViewFrame, dims: boolean, taken: Box[], w: number, h: number): { item: Item; box: Box } {
  const half = textWidth(s, LABEL_SIZE) / 2;
  const cx = (f.x0 + f.x1) / 2;
  // Each candidate's text box allows 1 mm of air around the capitals.
  const at = (x: number, y: number, anchor: 'start' | 'middle') => {
    const x0 = anchor === 'start' ? x : x - half;
    const box: Box = [x0 - 1, y - LABEL_SIZE * 0.75 - 1, x0 + 2 * half + 1, y + 1];
    return { item: { t: 'text', s, x, y, size: LABEL_SIZE, anchor } as Item, box };
  };
  const below = at(cx, f.y1 + (dims ? 16 : 7), 'middle');
  const candidates = [below, at(cx, f.y0 - 3, 'middle'), at(f.x1 + 4, (f.y0 + f.y1) / 2 + LABEL_SIZE * 0.375, 'start')];
  const free = (b: Box) =>
    b[0] >= MARGIN && b[1] >= MARGIN && b[2] <= w - MARGIN && b[3] <= h - MARGIN &&
    !taken.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  return candidates.find((c) => free(c.box)) ?? below;
}

/** The part of a segment inside the circle, or null when it misses it. */
export function clipSegment(
  a: [number, number], b: [number, number], cx: number, cy: number, r: number,
): [[number, number], [number, number]] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - cx, fy = a[1] - cy;
  const qa = dx * dx + dy * dy;
  if (qa < 1e-12) return Math.hypot(fx, fy) <= r ? [a, b] : null;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - r * r;
  const disc = qb * qb - 4 * qa * qc;
  let t0 = 0, t1 = 1;
  if (disc < 0) {
    // No crossing: the whole segment is inside or outside.
    return qc <= 0 ? [a, b] : null;
  }
  const sq = Math.sqrt(disc);
  t0 = Math.max(t0, (-qb - sq) / (2 * qa));
  t1 = Math.min(t1, (-qb + sq) / (2 * qa));
  if (t1 - t0 < 1e-9) return null;
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

/**
 * Cuts projected polylines down to what falls inside a circle (a detail
 * view), returning runs of space-separated path data and the circle's bounds.
 */
export function clipPathsToCircle(
  paths: string[], cx: number, cy: number, r: number,
): { paths: string[]; bounds: [number, number, number, number] } {
  const out: string[] = [];
  for (const d of paths) {
    for (const loop of parseLoops([d])) {
      let run: [number, number][] = [];
      const flush = () => {
        if (run.length >= 2) out.push('M ' + run.map((p, i) => `${i ? 'L ' : ''}${p[0].toFixed(4)} ${p[1].toFixed(4)}`).join(' '));
        run = [];
      };
      for (let i = 1; i < loop.length; i++) {
        const cut = clipSegment(loop[i - 1], loop[i], cx, cy, r);
        if (!cut) { flush(); continue; }
        const [c0, c1] = cut;
        if (!run.length) run.push(c0);
        else {
          const last = run[run.length - 1];
          if (Math.hypot(last[0] - c0[0], last[1] - c0[1]) > 1e-6) { flush(); run.push(c0); }
        }
        run.push(c1);
        if (Math.hypot(loop[i][0] - cx, loop[i][1] - cy) > r) flush();
      }
      flush();
    }
  }
  return { paths: out, bounds: [cx - r, cy - r, cx + r, cy + r] };
}

/**
 * Polyline loops from projected SVG paths (M/L/Z, absolute or relative).
 * Other commands are skipped, which loses curved segments but never the shape.
 */
export function parseLoops(paths: string[]): [number, number][][] {
  const out: [number, number][][] = [];
  for (const d of paths) {
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
    if (!tokens) continue;
    let i = 0;
    let cmd = '';
    let cur: [number, number] = [0, 0];
    let start: [number, number] = [0, 0];
    let loop: [number, number][] = [];
    const num = () => Number(tokens[i++]);
    const finish = () => {
      if (loop.length >= 3) out.push(loop);
      loop = [];
    };
    while (i < tokens.length) {
      if (/^[a-zA-Z]$/.test(tokens[i])) {
        cmd = tokens[i++];
        if (cmd === 'Z' || cmd === 'z') {
          if (loop.length) loop.push([start[0], start[1]]);
          finish();
          continue;
        }
      }
      switch (cmd) {
        case 'M': finish(); cur = [num(), num()]; start = [...cur]; loop = [[...cur]]; cmd = 'L'; break;
        case 'm': finish(); cur = [cur[0] + num(), cur[1] + num()]; start = [...cur]; loop = [[...cur]]; cmd = 'l'; break;
        case 'L': cur = [num(), num()]; loop.push([...cur]); break;
        case 'l': cur = [cur[0] + num(), cur[1] + num()]; loop.push([...cur]); break;
        case 'H': cur = [num(), cur[1]]; loop.push([...cur]); break;
        case 'h': cur = [cur[0] + num(), cur[1]]; loop.push([...cur]); break;
        case 'V': cur = [cur[0], num()]; loop.push([...cur]); break;
        case 'v': cur = [cur[0], cur[1] + num()]; loop.push([...cur]); break;
        default: i++; break;
      }
    }
    finish();
  }
  return out;
}

/**
 * 45 degree section hatching inside the loops (even-odd, so holes stay clear),
 * as thin lines in sheet millimetres.
 */
export function hatchLoops(items: Item[], loops: [number, number][][], spacing = 2.4) {
  if (!loops.length) return;
  const a = Math.PI / 4;
  const cos = Math.cos(a), sin = Math.sin(a);
  const rot = ([x, y]: [number, number]): [number, number] => [x * cos + y * sin, -x * sin + y * cos];
  const back = ([x, y]: [number, number]): [number, number] => [x * cos - y * sin, x * sin + y * cos];
  const poly = loops.map((loop) => loop.map(rot));
  let minY = Infinity, maxY = -Infinity;
  for (const loop of poly) for (const [, y] of loop) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  for (let y = Math.ceil(minY / spacing) * spacing; y < maxY; y += spacing) {
    const xs: number[] = [];
    for (const loop of poly) {
      for (let i = 0; i < loop.length; i++) {
        const [x1, y1] = loop[i];
        const [x2, y2] = loop[(i + 1) % loop.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const p1 = back([xs[i], y]);
      const p2 = back([xs[i + 1], y]);
      items.push({ t: 'line', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], w: 0.13 });
    }
  }
}

/** A centre mark: a small cross plus dashed centre lines across the circle. */
function centerMark(items: Item[], x: number, y: number, radius: number) {
  const arm = 3;
  items.push({ t: 'line', x1: x - arm, y1: y, x2: x + arm, y2: y, w: THIN });
  items.push({ t: 'line', x1: x, y1: y - arm, x2: x, y2: y + arm, w: THIN });
  const reach = Math.max(radius + 2, arm + 2);
  if (reach > arm) {
    items.push({ t: 'line', x1: x - reach, y1: y, x2: x - arm - 1, y2: y, w: THIN, dash: [2, 1] });
    items.push({ t: 'line', x1: x + arm + 1, y1: y, x2: x + reach, y2: y, w: THIN, dash: [2, 1] });
    items.push({ t: 'line', x1: x, y1: y - reach, x2: x, y2: y - arm - 1, w: THIN, dash: [2, 1] });
    items.push({ t: 'line', x1: x, y1: y + arm + 1, x2: x, y2: y + reach, w: THIN, dash: [2, 1] });
  }
}

/**
 * Balloons for an assembly drawing: a numbered circle just outside each part's
 * projected centre, with a short leader back to it. The circle is placed away
 * from the view centre so the leaders fan out instead of piling up.
 */
function balloon(
  items: Item[],
  parts: { x: number; y: number; item: number }[],
  tx: number,
  ty: number,
  scale: number,
  frame: ViewFrame,
  w: number,
  h: number,
) {
  const r = 3;
  const cx = (frame.x0 + frame.x1) / 2;
  const cy = (frame.y0 + frame.y1) / 2;
  parts.forEach((part, i) => {
    const px = tx + part.x * scale;
    const py = ty + part.y * scale;
    if (px < frame.x0 || px > frame.x1 || py < frame.y0 || py > frame.y1) return;
    const away = 12 + (i % 3) * 5;
    const ox = px >= cx ? 1 : -1;
    const oy = py >= cy ? 1 : -1;
    const bx = Math.max(MARGIN + r, Math.min(w - MARGIN - r, px + ox * away));
    const by = Math.max(MARGIN + r, Math.min(h - MARGIN - r, py + oy * away));
    const dx = bx - px, dy = by - py;
    const len = Math.hypot(dx, dy) || 1;
    items.push({ t: 'line', x1: bx - (dx / len) * r, y1: by - (dy / len) * r, x2: px, y2: py, w: THIN });
    items.push({ t: 'circle', x: bx, y: by, r, sw: 0.3 });
    items.push({ t: 'text', s: String(part.item), x: bx, y: by + 0.9, size: 2.6, anchor: 'middle' });
  });
}

/** Overall dimension between two points (horizontal below, vertical left). */
function dimension(items: Item[], a: [number, number], b: [number, number], side: 'below' | 'left', label: string) {
  const off = 8, ext = 2, arrow = 2.4, aw = 0.8;
  if (side === 'below') {
    const y = a[1] + off;
    items.push({ t: 'line', x1: a[0], y1: a[1] + 1, x2: a[0], y2: y + ext, w: THIN });
    items.push({ t: 'line', x1: b[0], y1: b[1] + 1, x2: b[0], y2: y + ext, w: THIN });
    items.push({ t: 'line', x1: a[0], y1: y, x2: b[0], y2: y, w: THIN });
    items.push({ t: 'tri', a: [a[0], y], b: [a[0] + arrow, y - aw], c: [a[0] + arrow, y + aw] });
    items.push({ t: 'tri', a: [b[0], y], b: [b[0] - arrow, y - aw], c: [b[0] - arrow, y + aw] });
    items.push({ t: 'text', s: label, x: (a[0] + b[0]) / 2, y: y - 1.2, size: 3, anchor: 'middle' });
  } else {
    const x = a[0] - off;
    items.push({ t: 'line', x1: a[0] - 1, y1: a[1], x2: x - ext, y2: a[1], w: THIN });
    items.push({ t: 'line', x1: b[0] - 1, y1: b[1], x2: x - ext, y2: b[1], w: THIN });
    items.push({ t: 'line', x1: x, y1: a[1], x2: x, y2: b[1], w: THIN });
    items.push({ t: 'tri', a: [x, a[1]], b: [x - aw, a[1] + arrow], c: [x + aw, a[1] + arrow] });
    items.push({ t: 'tri', a: [x, b[1]], b: [x - aw, b[1] - arrow], c: [x + aw, b[1] - arrow] });
    items.push({ t: 'text', s: label, x: x - 1.2, y: (a[1] + b[1]) / 2, size: 3, anchor: 'middle', rotate: -90 });
  }
}

/** Free notes at the top left of the sheet, one line each (up to ten). */
function notesBlock(items: Item[], d: DrawingDoc) {
  const lines = d.notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 10);
  if (!lines.length) return;
  const x = MARGIN + 6;
  let y = MARGIN + 8;
  items.push({ t: 'text', s: tr("NOTES"), x, y, size: 3, bold: true });
  y += 5.5;
  for (const line of lines) {
    items.push({ t: 'text', s: line, x, y, size: 3 });
    y += 4.5;
  }
}

function titleBlock(items: Item[], w: number, h: number, d: DrawingDoc, info: SheetInfo) {
  const notesLines = d.notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const x = w - MARGIN - TITLE_W, y = h - MARGIN - TITLE_H;
  const row = TITLE_H / 3;
  items.push({ t: 'rect', x, y, w: TITLE_W, h: TITLE_H, sw: 0.5 });
  items.push({ t: 'line', x1: x, y1: y + row, x2: x + TITLE_W, y2: y + row, w: 0.25 });
  items.push({ t: 'line', x1: x, y1: y + 2 * row, x2: x + TITLE_W, y2: y + 2 * row, w: 0.25 });
  const c1 = x + 110, c2 = x + 56;
  items.push({ t: 'line', x1: c1, y1: y, x2: c1, y2: y + TITLE_H, w: 0.25 });
  items.push({ t: 'line', x1: c2, y1: y + row, x2: c2, y2: y + TITLE_H, w: 0.25 });
  const label = (s: string, lx: number, ly: number) => items.push({ t: 'text', s, x: lx + 1.5, y: ly + 3, size: 1.8 });
  // Long values shrink to fit their cell, down to a legible minimum, then are cut short.
  const value = (s: string, lx: number, ly: number, cellW: number, size = 3.2, bold = false) => {
    const room = cellW - 3;
    let fitted = s;
    const w = textWidth(s, size, bold);
    if (w > room) {
      size = Math.max(MIN_TEXT, (size * room) / w);
      if (textWidth(s, size, bold) > room + 1e-9) {
        let n = s.length;
        while (n > 0 && textWidth(`${s.slice(0, n).trimEnd()}\u2026`, size, bold) > room) n--;
        fitted = `${s.slice(0, n).trimEnd()}\u2026`;
      }
    }
    items.push({ t: 'text', s: fitted, x: lx + 1.5, y: ly + row - 2, size, bold });
  };
  const right = x + TITLE_W;
  label(tr("TITLE"), x, y); value(d.title || info.partName, x, y, c1 - x, 4, true);
  label(tr("SCALE"), c1, y); value(scaleLabel(d.scale), c1, y, right - c1);
  label(tr("MATERIAL"), x, y + row); value(info.material, x, y + row, c2 - x, 2.8);
  label(tr("UNITS"), c2, y + row); value(info.units, c2, y + row, c1 - c2, 2.8);
  label(tr("DATE"), c1, y + row); value(info.date, c1, y + row, right - c1, 2.8);
  label(tr("DRAWN BY"), x, y + 2 * row); value(d.drawnBy || '', x, y + 2 * row, c2 - x, 2.8);
  label(tr("DWG NO"), c2, y + 2 * row); value(d.number || '', c2, y + 2 * row, c1 - c2, 2.8);
  label(tr("REV"), c1, y + 2 * row); value(d.revision || '', c1, y + 2 * row, right - c1, 2.8);
  label(tr("SHEET"), c2, y + 2 * row); value(`${d.sheet}${d.landscape ? '' : tr(" portrait")}`, c2, y + 2 * row, c1 - c2, 2.8);
  label(tr("NOTES"), c1, y + 2 * row); value(notesLines.length > 1 ? '' : d.notes || '', c1, y + 2 * row, right - c1, 2.4);
}

/** Compact assembly bill of materials immediately above the title block. */
function bomTable(items: Item[], w: number, h: number, rows: NonNullable<SheetInfo['bom']>) {
  if (!rows.length) return;
  const rowH = 4;
  // The layout reserves space for at most ten rows (bomReserve), so never draw
  // more than that or the table climbs into the views above it.
  const room = Math.max(1, Math.floor((h - 2 * MARGIN - TITLE_H - 35) / rowH));
  const shown = rows.slice(0, Math.min(10, room));
  const bottom = h - MARGIN - TITLE_H - 4;
  const top = bottom - (shown.length + 1) * rowH;
  const tableW = Math.min(165, w - 2 * MARGIN - 6);
  const descW = 42;
  const cols = [12, tableW - 12 - 15 - 42 - descW, 15, 42, descW];
  const xs = [MARGIN];
  for (const c of cols) xs.push(xs[xs.length - 1] + c);
  for (let i = 0; i <= shown.length + 1; i++) {
    const y = top + i * rowH;
    items.push({ t: 'line', x1: xs[0], y1: y, x2: xs[5], y2: y, w: 0.22 });
  }
  for (const x of xs) items.push({ t: 'line', x1: x, y1: top, x2: x, y2: bottom, w: 0.22 });
  const cell = (text: string, col: number, row: number, bold = false) => {
    const x = xs[col] + 1.2;
    let size = 2.2;
    const roomW = cols[col] - 2.4;
    const textW = textWidth(text, size, bold);
    if (textW > roomW) size = Math.max(1.6, size * roomW / textW);
    items.push({ t: 'text', s: text, x, y: top + row * rowH + rowH - 1.2, size, bold });
  };
  cell(tr("ITEM"), 0, 0, true);
  cell(tr("PART"), 1, 0, true);
  cell(tr("DESCRIPTION"), 2, 0, true);
  cell(tr("QTY"), 3, 0, true);
  cell(tr("MATERIAL"), 4, 0, true);
  for (const [i, row] of shown.entries()) {
    cell(String(row.item), 0, i + 1);
    cell(row.part, 1, i + 1);
    cell(row.description ?? '', 2, i + 1);
    cell(String(row.quantity), 3, i + 1);
    cell(row.material, 4, i + 1);
  }
}

// ---------- renderers ----------

/**
 * Text for XML: markup characters escaped, and characters XML 1.0 forbids
 * (control characters, lone surrogates, U+FFFE/U+FFFF) dropped, since one of
 * them in a title or note makes the whole SVG fail to open.
 */
const esc = (s: string) =>
  s
    .replace(/[\ud800-\udbff][\udc00-\udfff]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/g, (c) => (c.length === 2 ? c : ''))
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** SVG document (millimetre units). */
export function toSvg(items: Item[], w: number, h: number, opts: { background?: string; ink?: string } = {}): string {
  const ink = opts.ink ?? '#000';
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif">`);
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${opts.background ?? '#fff'}"/>`);
  let view: string | undefined;
  for (const it of items) {
    const v = it.t === 'path' ? it.view : undefined;
    if (v !== view) {
      if (view) parts.push('</g>');
      if (v) parts.push(`<g data-view="${esc(v)}">`);
      view = v;
    }
    switch (it.t) {
      case 'path':
        parts.push(`<path d="${it.d}" transform="translate(${it.tx.toFixed(4)} ${it.ty.toFixed(4)}) scale(${it.s})" fill="none" stroke="${ink}" stroke-width="${(it.w / it.s).toFixed(5)}" stroke-linecap="round" stroke-linejoin="round"${it.dash ? ` stroke-dasharray="${it.dash.map((x) => (x / it.s).toFixed(4)).join(' ')}"` : ''}/>`);
        break;
      case 'line':
        parts.push(`<line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="${ink}" stroke-width="${it.w}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''}/>`);
        break;
      case 'rect':
        parts.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="${ink}" stroke-width="${it.sw}"/>`);
        break;
      case 'tri':
        parts.push(`<path d="M${it.a[0]} ${it.a[1]}L${it.b[0]} ${it.b[1]}L${it.c[0]} ${it.c[1]}Z" fill="${ink}"/>`);
        break;
      case 'circle':
        parts.push(`<circle cx="${it.x}" cy="${it.y}" r="${it.r}" fill="none" stroke="${ink}" stroke-width="${it.sw}"/>`);
        break;
      case 'text': {
        const anchor = it.anchor === 'middle' ? 'middle' : it.anchor === 'end' ? 'end' : 'start';
        const rot = it.rotate ? ` transform="rotate(${it.rotate} ${it.x} ${it.y})"` : '';
        parts.push(`<text x="${it.x}" y="${it.y}" font-size="${it.size}" text-anchor="${anchor}"${it.bold ? ' font-weight="bold"' : ''} fill="${ink}"${rot}>${esc(it.s)}</text>`);
        break;
      }
    }
  }
  if (view) parts.push('</g>');
  parts.push('</svg>');
  return parts.join('');
}

export function toPdf(items: Item[], w: number, h: number, title: string): Uint8Array {
  const pdf = new PdfPage(w, h);
  for (const it of items) {
    switch (it.t) {
      case 'path': pdf.path(it.d, it.tx, it.ty, it.s, { width: it.w, dash: it.dash }); break;
      case 'line': pdf.line(it.x1, it.y1, it.x2, it.y2, { width: it.w, dash: it.dash }); break;
      case 'rect': pdf.rect(it.x, it.y, it.w, it.h, { width: it.sw }); break;
      case 'tri': pdf.triangle(it.a, it.b, it.c); break;
      case 'circle': pdf.circle(it.x, it.y, it.r, { width: it.sw }); break;
      case 'text': pdf.text(it.s, it.x, it.y, it.size, { bold: it.bold, anchor: it.anchor, rotate: it.rotate ? -it.rotate : undefined }); break;
    }
  }
  return pdf.build(title);
}
